import React, { useState, useRef, useEffect, useMemo } from "react";
import axios from "axios";
import { useAuthCheck } from "../components/is_logined";

type CeleryState =
  | "PENDING"
  | "PROGRESS"
  | "SUCCESS"
  | "FAILURE"
  | "STARTED"
  | "UNKNOWN";

// interval 축소 버전
type IntervalKey = "1h" | "4h" | "1d" | "1w" | "1M";
const INTERVAL_ORDER: IntervalKey[] = ["1h", "4h", "1d", "1w", "1M"];

// --- 파이프라인 상태(엔진 4개) 타입 ---
type EngineStatusState = "WAIT" | "PROGRESS" | "FAIL" | "FAILURE" | "UNKNOWN";

interface EngineStatus {
  id: number;
  is_active: boolean;
  status: EngineStatusState;
  last_error?: string | null;
  updated_at?: string | null;
}

interface PipelineStatusApiResponse {
  is_active: boolean;
  websocket: EngineStatus;
  backfill: EngineStatus;
  rest_maintenance: EngineStatus;
  indicator: EngineStatus;
}

// --- /pipeline/backfill/progress 응답 타입 ---
interface BackfillIntervalApi {
  interval: IntervalKey;
  state: string; // CeleryState 혹은 "COMPLETE" 등 문자열
  pct_time: number;
  last_updated_iso: string | null;
}

interface BackfillSymbolApi {
  symbol: string;
  state: string;
  intervals: Record<string, BackfillIntervalApi>; // key: "1h", "4h" ...
}

interface BackfillProgressApiResponse {
  run_id: string | null;
  symbols: Record<string, BackfillSymbolApi>;
}

// --- (UI 상태를 위한 타입) ---
interface IntervalProgress {
  interval: IntervalKey;
  state: CeleryState;
  pct_time: number; // 0-100
  last_updated_iso?: string | null;
}

interface SymbolProgress {
  symbol: string;
  state: CeleryState; // "PROGRESS", "SUCCESS" 등
  status: string; // "수집 중...", "완료" 등
  intervals: Partial<Record<IntervalKey, IntervalProgress>>;
}
// ---------------------------------------------------

const API_URL = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:8080";
const POLLING_INTERVAL = 2000; // 2초
const api = axios.create({ baseURL: API_URL, timeout: 20000 });

// 0~100 사이로 값 고정
const clampPct = (v: any) => {
  const num = Number(v);
  if (!Number.isFinite(num) || isNaN(num)) return 0;
  return Math.max(0, Math.min(100, num));
};

// (심볼에 속한 모든 인터벌 진행률의 평균을 계산)
function computeOverallPct(p: SymbolProgress): number {
  const percentages = INTERVAL_ORDER
    .map((intv) => {
      const iv = p.intervals[intv];
      if (!iv) return undefined;

      // SUCCESS인데 pct_time이 덜 올라와 있으면 100으로 보정
      if (iv.state === "SUCCESS" && (!iv.pct_time || iv.pct_time < 100)) {
        return 100;
      }
      return iv.pct_time;
    })
    .filter((pct) => typeof pct === "number") as number[];

  if (percentages.length === 0) return 0;

  const sum = percentages.reduce((a, b) => a + b, 0);
  return Math.round(sum / percentages.length);
}

// 심볼에 대한 초기 상태 객체 (필요 시)
const createEmptySymbolProgress = (symbol: string): SymbolProgress => ({
  symbol,
  state: "PENDING",
  status: "대기 중...",
  intervals: {},
});

const AdminPage: React.FC = () => {
  const { isChecking, isValid } = useAuthCheck();

  const [registerMessage, setRegisterMessage] = useState("");
  const [loading, setLoading] = useState(false); // 버튼 로딩

  // 파이프라인 전체 ON/OFF 상태 (id=1)
  const [pipelineActive, setPipelineActive] = useState<boolean | null>(null);
  const [pipelineStatusMessage, setPipelineStatusMessage] = useState<string>("");

  // 엔진 4개 상태 + 에러 로그
  const [engineStatus, setEngineStatus] = useState<{
    websocket?: EngineStatus;
    backfill?: EngineStatus;
    rest_maintenance?: EngineStatus;
    indicator?: EngineStatus;
  }>({});

  // UI 표시에 사용되는 메인 상태 (심볼 기준)
  const [progressMap, setProgressMap] = useState<Record<string, SymbolProgress>>({});

  const backfillPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipelinePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  const isPipelineActive = pipelineActive === true;

  // Backfill 진행현황 모달 표시 여부
  const [showBackfillPanel, setShowBackfillPanel] = useState(false);

  const stopBackfillPolling = () => {
    if (backfillPollRef.current) {
      clearInterval(backfillPollRef.current);
      backfillPollRef.current = null;
    }
  };

  const stopPipelineStatusPolling = () => {
    if (pipelinePollRef.current) {
      clearInterval(pipelinePollRef.current);
      pipelinePollRef.current = null;
    }
  };

  // --- Backfill 진행률 폴링 (/pipeline/backfill/progress) ---
  const fetchBackfillProgress = async () => {
    try {
      const res = await api.get<BackfillProgressApiResponse>("/pipeline/backfill/progress");
      const data = res.data;

      if (!data.run_id || !data.symbols || Object.keys(data.symbols).length === 0) {
        // 진행 중인 run이 없으면 비워두거나 이전 상태 유지 선택 가능
        // 여기서는 그냥 비워버리자
        setProgressMap({});
        return;
      }

      const next: Record<string, SymbolProgress> = {};

      Object.values(data.symbols).forEach((sym) => {
        const intervals: Partial<Record<IntervalKey, IntervalProgress>> = {};
        const rawIntervals = sym.intervals || {};

        INTERVAL_ORDER.forEach((iv) => {
          const apiIv = rawIntervals[iv];
          if (!apiIv) return;

          const state = (apiIv.state as CeleryState) || "UNKNOWN";
          const pct = clampPct(apiIv.pct_time);

          intervals[iv] = {
            interval: iv,
            state,
            pct_time: pct,
            last_updated_iso: apiIv.last_updated_iso,
          };
        });

        const sp: SymbolProgress = {
          symbol: sym.symbol,
          state: (sym.state as CeleryState) || "UNKNOWN",
          status: "",
          intervals,
        };

        // 심볼 단위 상태/메시지 재계산
        const intervalList = INTERVAL_ORDER.map((iv) => intervals[iv]).filter(
          Boolean
        ) as IntervalProgress[];

        if (intervalList.length === 0) {
          sp.state = "UNKNOWN";
          sp.status = "수집 대기 중";
        } else if (intervalList.some((iv) => iv.state === "FAILURE")) {
          sp.state = "FAILURE";
          sp.status = "하나 이상의 인터벌 수집 실패";
        } else if (intervalList.every((iv) => iv.state === "SUCCESS")) {
          sp.state = "SUCCESS";
          sp.status = "모든 인터벌 수집 완료";
        } else if (
          intervalList.some((iv) => iv.state === "PROGRESS" || iv.state === "STARTED")
        ) {
          sp.state = "PROGRESS";
          sp.status = "데이터 수집 중...";
        } else if (intervalList.every((iv) => iv.state === "PENDING")) {
          sp.state = "PENDING";
          sp.status = "작업 대기 중...";
        } else {
          sp.state = "UNKNOWN";
          sp.status = "상태 확인 중...";
        }

        next[sym.symbol] = sp;
      });

      setProgressMap(next);
    } catch (err) {
      console.error("Backfill 진행률 조회 실패:", err);
      // 에러라고 해서 progressMap을 꼭 비울 필요는 없음 (이전 상태 유지)
    }
  };

  const startBackfillPolling = () => {
    stopBackfillPolling();
    // 즉시 1회
    void fetchBackfillProgress();
    // 주기적으로
    backfillPollRef.current = setInterval(() => {
      if (!document.hidden) {
        void fetchBackfillProgress();
      }
    }, POLLING_INTERVAL);
  };

  // --- 파이프라인 상태(4개 엔진 포함) 폴링 ---
  useEffect(() => {
    if (isChecking || !isValid) return;

    const fetchStatus = async () => {
      try {
        const res = await api.get<PipelineStatusApiResponse>("/pipeline/status");
        setPipelineActive(res.data.is_active);
        setPipelineStatusMessage(
          res.data.is_active ? "데이터 수집 파이프라인 활성화됨" : "파이프라인 비활성 상태"
        );
        setEngineStatus({
          websocket: res.data.websocket,
          backfill: res.data.backfill,
          rest_maintenance: res.data.rest_maintenance,
          indicator: res.data.indicator,
        });
      } catch (err) {
        console.error("파이프라인 상태 조회 실패:", err);
        setPipelineStatusMessage("파이프라인 상태 조회 실패");
      }
    };

    // 즉시 1회
    void fetchStatus();
    // 주기적 폴링
    pipelinePollRef.current = setInterval(() => {
      if (!document.hidden) {
        void fetchStatus();
      }
    }, POLLING_INTERVAL);

    return () => {
      stopPipelineStatusPolling();
    };
  }, [isChecking, isValid]);

  // 인증 끝났을 때 백필 진행률 폴링 시작
  useEffect(() => {
    if (!isChecking && isValid) {
      startBackfillPolling();
    }
  }, [isChecking, isValid]);

  // "1. 종목 정보 갱신"
  const handleRegisterSymbols = async () => {
    setLoading(true);
    setRegisterMessage("");
    try {
      const res = await api.post(`/get_symbol_info/register_symbols`);
      setRegisterMessage(res.data?.message || "종목 정보 갱신 완료");
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.detail || err.message || "종목 갱신 실패";
      setRegisterMessage(`실패: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // "데이터 수집 ON" → 파이프라인 ON
  const handleStartCollection = async () => {
    if (isPipelineActive) {
      // 이미 ON이면 무시
      return;
    }

    setLoading(true);
    try {
      const pipelineRes = await api.post(`/pipeline/on`, {});
      setPipelineActive(true);
      setPipelineStatusMessage(
        pipelineRes.data?.message || "파이프라인 활성화됨"
      );
      // 파이프라인 ON 이후에는 Celery가 알아서 WebSocket + Backfill 시작
      // 프론트는 /pipeline/backfill/progress 폴링만 하면 됨
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.detail || err.message || "수집 시작 실패";
      alert(`수집 시작 실패: ${errorMsg}`);
      setPipelineActive(false);
      setPipelineStatusMessage("파이프라인 비활성 상태 (시작 실패)");
    } finally {
      setLoading(false);
    }
  };

  // "데이터 수집 OFF" → 파이프라인 OFF
  const handleStopCollection = async () => {
    if (!isPipelineActive) return;

    setLoading(true);
    try {
      const res = await api.post(`/pipeline/off`, {});
      setPipelineActive(false);
      setPipelineStatusMessage(res.data?.message || "파이프라인 비활성화됨");
      alert("데이터 수집 파이프라인을 중지했습니다.");
    } catch (err: any) {
      alert(`파이프라인 중지 실패: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // 컴포넌트 unmount 시 폴링 중지
  useEffect(() => {
    return () => {
      stopBackfillPolling();
      stopPipelineStatusPolling();
    };
  }, []);

  const rows = useMemo(
    () =>
      Object.entries(progressMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([symbol, p], idx) => ({
          idx: idx + 1,
          symbol,
          p,
          overallPct: computeOverallPct(p),
        })),
    [progressMap]
  );

  const scrollToBottom = () => {
    listContainerRef.current?.scrollTo({
      top: listContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  };
  const scrollToTop = () => {
    listContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 엔진별 상태 카드 렌더링 (Backfill 카드만 클릭 가능하도록 onClick 지원)
  const renderEngineCard = (
    label: string,
    data?: EngineStatus,
    onClick?: () => void
  ) => {
    const st: EngineStatusState = data?.status || "UNKNOWN";
    const isActive = !!data?.is_active;

    let badgeText = st;
    let badgeClass = "text-gray-300 border-gray-500";
    if (st === "PROGRESS") {
      badgeText = "PROGRESS";
      badgeClass = "text-blue-300 border-blue-400";
    } else if (st === "WAIT") {
      badgeText = "WAIT";
      badgeClass = "text-gray-300 border-gray-500";
    } else if (st === "FAIL" || st === "FAILURE") {
      badgeText = "FAIL";
      badgeClass = "text-red-300 border-red-400";
    } else if (st === "UNKNOWN") {
      badgeText = "UNKNOWN";
      badgeClass = "text-gray-500 border-gray-600";
    }

    const Wrapper: any = onClick ? "button" : "div";

    return (
      <Wrapper
        key={label}
        type={onClick ? "button" : undefined}
        onClick={onClick}
        className={`bg-gray-900/60 border border-gray-700 rounded-md p-3 text-xs flex flex-col justify-between ${
          onClick ? "hover:border-cyan-400 cursor-pointer transition-colors" : ""
        }`}
      >
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-gray-100">{label}</span>
            <span className={`px-2 py-0.5 rounded-full border ${badgeClass}`}>
              {badgeText}
            </span>
          </div>
          <p className="text-[11px] text-gray-300 mb-1">
            {isActive ? "작업 활성화됨" : "작업 비활성 상태"}
          </p>
          {data?.updated_at && (
            <p className="text-[10px] text-gray-500">
              업데이트: {data.updated_at}
            </p>
          )}
        </div>
        {data?.last_error && (
          <p className="text-[11px] text-red-400 mt-2 break-words">
            에러: {data.last_error}
          </p>
        )}
      </Wrapper>
    );
  };

  if (isChecking)
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-gray-900 text-white">
        인증 확인 중...
      </div>
    );
  if (!isValid) return null;

  return (
    <div className="flex flex-col items-center w-screen min-h-screen p-6 md:p-8 bg-gray-900 text-white">
      <h1 className="text-3xl font-bold mb-6">DB 관리</h1>

      {/* 1. 종목 정보 갱신 */}
      <div className="bg-gray-800 p-6 rounded-lg w-full max-w-3xl text-center shadow-xl border border-gray-700 mb-6 sticky top-0 z-20 backdrop-blur bg-gray-800/95">
        <h2 className="text-lg font-semibold mb-4 text-cyan-400">
          1. 종목 정보 갱신
        </h2>
        <button
          onClick={handleRegisterSymbols}
          disabled={loading}
          className={`w-full px-4 py-2 rounded-md font-semibold text-white ${
            loading
              ? "bg-blue-400 cursor-not-allowed"
              : "bg-blue-500 hover:bg-blue-600"
          }`}
        >
          {loading ? "갱신 중..." : "기존 종목 정보 갱신 (CSV/API 기준)"}
        </button>
        {registerMessage && (
          <p
            className={`text-sm mt-3 ${
              registerMessage.includes("실패") ? "text-red-400" : "text-green-400"
            }`}
          >
            {registerMessage}
          </p>
        )}
      </div>

      {/* 2. OHLCV 백필 + 파이프라인 제어 패널 */}
      <div className="bg-gray-800 w-full max-w-5xl rounded-lg shadow-xl border border-gray-700">
        <div className="p-4 md:p-6 border-b border-gray-700 sticky top-[132px] md:top-[144px] bg-gray-800/95 backdrop-blur z-10">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-green-400">
              2. OHLCV 데이터 수집 파이프라인
            </h2>
            <span
              className={`text-xs px-2 py-1 rounded-full border ${
                isPipelineActive
                  ? "text-green-300 border-green-400"
                  : "text-gray-300 border-gray-500"
              }`}
            >
              {pipelineActive === null
                ? "상태 조회 중..."
                : isPipelineActive
                ? "ACTIVE"
                : "INACTIVE"}
            </span>
          </div>
          {pipelineStatusMessage && (
            <p className="text-xs text-gray-300 mb-3">
              {pipelineStatusMessage}
            </p>
          )}

          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            {/* 단일 토글 버튼: OFF -> ON / ON -> OFF */}
            <button
              onClick={isPipelineActive ? handleStopCollection : handleStartCollection}
              disabled={loading}
              className={`w-full md:w-auto px-4 py-2 rounded-md font-semibold text-white ${
                loading
                  ? "bg-green-400 cursor-not-allowed"
                  : isPipelineActive
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-green-500 hover:bg-green-600"
              }`}
            >
              {loading
                ? isPipelineActive
                  ? "중지 중..."
                  : "시작 중..."
                : isPipelineActive
                ? "데이터 수집 파이프라인 OFF"
                : "데이터 수집 파이프라인 ON (백필 + 실시간)"}
            </button>
          </div>

          {/* 4개 작업(WebSocket / Backfill / REST / Indicator) 상태 + 에러 로그 */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {renderEngineCard("WebSocket 실시간 수집", engineStatus.websocket)}
            {renderEngineCard(
              "Backfill 엔진",
              engineStatus.backfill,
              () => setShowBackfillPanel(true) // ✅ 클릭 시 진행현황 모달 오픈
            )}
            {renderEngineCard(
              "REST 유지보수 엔진",
              engineStatus.rest_maintenance
            )}
            {renderEngineCard(
              "보조지표 계산 엔진",
              engineStatus.indicator
            )}
          </div>
        </div>

        {/* 안내 문구 (모달 사용 안내 정도로만) */}
        <div className="px-4 md:px-6 py-6 text-center text-sm text-gray-400">
          Backfill 엔진 카드를 클릭하면 심볼·인터벌별 상세 진행현황을 확인할 수 있습니다.
        </div>
      </div>

      {/* ✅ Backfill 진행현황 모달 */}
      {showBackfillPanel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 w-[95vw] max-w-5xl max-h-[85vh] rounded-lg shadow-2xl border border-gray-700 flex flex-col">
            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-cyan-300">
                  Backfill 엔진 진행현황
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  /pipeline/backfill/progress 기준 심볼·인터벌별 수집 상태
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={scrollToTop}
                  className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-xs text-gray-200"
                >
                  맨 위로
                </button>
                <button
                  onClick={scrollToBottom}
                  className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-xs text-gray-200"
                >
                  맨 아래로
                </button>
                <button
                  onClick={() => setShowBackfillPanel(false)}
                  className="ml-2 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-xs font-semibold"
                >
                  닫기
                </button>
              </div>
            </div>

            {/* 모달 본문: 기존 rows 리스트 재사용 */}
            <div
              ref={listContainerRef}
              className="px-4 md:px-6 py-4 overflow-y-auto"
            >
              {rows.length > 0 ? (
                <div className="space-y-4 pb-2">
                  {rows.map(({ idx, symbol, p, overallPct }) => (
                    <div
                      key={symbol}
                      className={`p-4 rounded-lg ${
                        p.state === "FAILURE"
                          ? "bg-red-900/50"
                          : p.state === "SUCCESS"
                          ? "bg-green-900/40"
                          : "bg-gray-700"
                      } border border-gray-600/60`}
                    >
                      {/* 심볼 이름, 전체 상태 */}
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">
                          {idx}. {symbol}
                        </h3>
                        <span
                          className={`text-xs px-2 py-1 rounded-full border ${
                            p.state === "SUCCESS"
                              ? "text-green-300 border-green-400"
                              : p.state === "FAILURE"
                              ? "text-red-300 border-red-400"
                              : p.state === "PROGRESS"
                              ? "text-blue-300 border-blue-400"
                              : "text-gray-400 border-gray-500"
                          }`}
                        >
                          {p.state}
                        </span>
                      </div>

                      <p className="text-sm text-gray-300 mt-1 truncate">
                        {p.status || "-"}
                      </p>

                      {/* 심볼 전체 진행률 바 */}
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-300 mb-1">
                          <span>전체 진행률 (인터벌 평균)</span>
                          <span>{overallPct}%</span>
                        </div>
                        <div className="w-full bg-gray-600 rounded-full h-2.5">
                          <div
                            className="bg-cyan-500 h-2.5 rounded-full transition-all duration-300"
                            style={{ width: `${overallPct}%` }}
                          />
                        </div>
                      </div>

                      {/* 개별 인터벌 진행률 바 */}
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                        {INTERVAL_ORDER.map((iv) => {
                          const ivp = p.intervals[iv];
                          const basePct = ivp?.pct_time ?? 0;
                          const pct =
                            ivp && ivp.state === "SUCCESS" && basePct < 100
                              ? 100
                              : Math.round(clampPct(basePct));

                          let tag: string;
                          let tagColor: string;
                          let barColor: string;

                          switch (ivp?.state) {
                            case "SUCCESS":
                              tag = "완료";
                              tagColor = "text-green-400";
                              barColor = "bg-green-500";
                              break;
                            case "FAILURE":
                              tag = "실패";
                              tagColor = "text-red-400";
                              barColor = "bg-red-500";
                              break;
                            case "PROGRESS":
                            case "STARTED":
                              tag = "진행중";
                              tagColor = "text-blue-400";
                              barColor = "bg-blue-500";
                              break;
                            case "PENDING":
                              tag = "대기";
                              tagColor = "text-gray-400";
                              barColor = "bg-gray-700";
                              break;
                            default:
                              tag = "-";
                              tagColor = "text-gray-600";
                              barColor = "bg-gray-800";
                          }

                          if (!ivp) {
                            return (
                              <div
                                key={iv}
                                className="bg-gray-800/30 rounded-md p-3 border border-gray-700/50 opacity-50"
                              >
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="text-gray-500">{iv}</span>
                                  <span className={tagColor}>{tag}</span>
                                </div>
                                <div className="w-full bg-gray-700 rounded-full h-2">
                                  <div
                                    className={`${barColor} h-2 rounded-full`}
                                    style={{ width: `0%` }}
                                  />
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={iv}
                              className="bg-gray-800/50 rounded-md p-3 border border-gray-700"
                            >
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-gray-300">{iv}</span>
                                <span className={tagColor}>
                                  {pct}% · {tag}
                                </span>
                              </div>
                              <div className="w-full bg-gray-600 rounded-full h-2">
                                <div
                                  className={`${barColor} h-2 rounded-full transition-all duration-300`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 py-6 text-center">
                  {loading
                    ? "작업 시작 중..."
                    : "진행 중인 Backfill 작업이 없습니다."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
