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
type EngineStatusState =
  | "WAIT"
  | "PROGRESS"
  | "FAIL"
  | "FAILURE"
  | "SUCCESS"
  | "UNKNOWN";

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

/* ===========================
 *  Backfill 진행률 API 타입
 * =========================== */
interface BackfillIntervalApi {
  interval: IntervalKey;
  state: string;
  pct_time: number;
  last_updated_iso: string | null;
}

interface BackfillSymbolApi {
  symbol: string;
  state: string;
  intervals: Record<string, BackfillIntervalApi>;
}

interface BackfillProgressApiResponse {
  run_id: string | null;
  symbols: Record<string, BackfillSymbolApi>;
}

/* ===========================
 *  REST 유지보수 진행률 API 타입
 *  (백엔드: { run_id, symbols: { [symbol]: { symbol, intervals: { [interval]: {interval, state, updated_at} } } } })
 * =========================== */
interface RestIntervalApi {
  interval: string;
  state: string;
  updated_at: string | null;
}

interface RestSymbolApi {
  symbol: string;
  intervals: Record<string, RestIntervalApi>;
}

interface RestProgressApiResponse {
  run_id: string | null;
  symbols: Record<string, RestSymbolApi>;
}

/* REST UI용 변환 타입 */
interface RestIntervalState {
  interval: IntervalKey;
  state: "PENDING" | "SUCCESS" | "FAILURE" | "PROGRESS" | "UNKNOWN";
  updated_at?: string | null;
}

interface RestSymbolState {
  symbol: string;
  intervals: RestIntervalState[];
}

/* ===========================
 *  Indicator 진행률 API 타입
 *  (백엔드: { run_id, symbols: { [symbol]: { symbol, intervals: { [interval]: {interval, state, pct_time, updated_at} } } } })
 * =========================== */
interface IndicatorIntervalApi {
  interval: string;
  state: string;
  pct_time: number;
  updated_at: string | null;
}

interface IndicatorSymbolApi {
  symbol: string;
  intervals: Record<string, IndicatorIntervalApi>;
}

interface IndicatorProgressApiResponse {
  run_id: string | null;
  symbols: Record<string, IndicatorSymbolApi>;
}

/* ===========================
 *  WebSocket 진행률 API 타입
 *  (백엔드: { run_id, symbols: { [symbol]: { symbol, intervals: { [interval]: {interval, state, message_count, last_message_ts, last_error} } } } })
 * =========================== */
interface WebSocketIntervalApi {
  interval: string;
  state: string;
  message_count: number;
  last_message_ts: string | null;
  last_error: string | null;
}

interface WebSocketSymbolApi {
  symbol: string;
  intervals: Record<string, WebSocketIntervalApi>;
}

interface WebSocketProgressApiResponse {
  run_id: string | null;
  symbols: Record<string, WebSocketSymbolApi>;
}

/* WebSocket UI용 변환 타입 */
interface WebSocketIntervalState {
  interval: IntervalKey;
  state: "CONNECTED" | "DISCONNECTED" | "ERROR" | "UNKNOWN";
  message_count: number;
  last_message_ts?: string | null;
  last_error?: string | null;
}

interface WebSocketSymbolState {
  symbol: string;
  intervals: WebSocketIntervalState[];
}

// --- 공통 UI 상태 타입 ---
interface IntervalProgress {
  interval: IntervalKey;
  state: CeleryState;
  pct_time: number;
  last_updated_iso?: string | null;
}

interface SymbolProgress {
  symbol: string;
  state: CeleryState;
  status: string;
  intervals: Partial<Record<IntervalKey, IntervalProgress>>;
}

const API_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:8080";

const POLLING_INTERVAL = 2000;
const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});

// 0~100 클램프
const clampPct = (v: any) => {
  const num = Number(v);
  if (!Number.isFinite(num) || isNaN(num)) return 0;
  return Math.max(0, Math.min(100, num));
};

// 전체 pct 평균 계산
function computeOverallPct(p: SymbolProgress): number {
  const percentages = INTERVAL_ORDER.map((intv) => {
    const iv = p.intervals[intv];
    if (!iv) return undefined;

    if (iv.state === "SUCCESS" && iv.pct_time < 100) return 100;
    return iv.pct_time;
  }).filter((x) => typeof x === "number") as number[];

  if (percentages.length === 0) return 0;

  const sum = percentages.reduce((a, b) => a + b, 0);
  return Math.round(sum / percentages.length);
}

const AdminPage: React.FC = () => {
  const { isChecking, isValid } = useAuthCheck();

  const [registerMessage, setRegisterMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [pipelineActive, setPipelineActive] = useState<boolean | null>(null);
  const [pipelineStatusMessage, setPipelineStatusMessage] = useState("");

  const [engineStatus, setEngineStatus] = useState<{
    websocket?: EngineStatus;
    backfill?: EngineStatus;
    rest_maintenance?: EngineStatus;
    indicator?: EngineStatus;
  }>({});

  // Backfill 진행률
  const [backfillProgressMap, setBackfillProgressMap] = useState<
    Record<string, SymbolProgress>
  >({});

  // REST 유지보수 진행률
  const [restProgress, setRestProgress] = useState<RestSymbolState[]>([]);
  const [showRestPanel, setShowRestPanel] = useState(false);

  // Indicator 진행률
  const [indicatorProgressMap, setIndicatorProgressMap] = useState<
    Record<string, SymbolProgress>
  >({});
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);

  // WebSocket 진행률
  const [websocketProgress, setWebsocketProgress] = useState<WebSocketSymbolState[]>([]);
  const [showWebsocketPanel, setShowWebsocketPanel] = useState(false);

  const backfillPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pipelinePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const restListRef = useRef<HTMLDivElement | null>(null);
  const indicatorListRef = useRef<HTMLDivElement | null>(null);
  const websocketListRef = useRef<HTMLDivElement | null>(null);

  const isPipelineActive = pipelineActive === true;
  const [showBackfillPanel, setShowBackfillPanel] = useState(false);

  /* ======================================
   * Backfill Polling
   * ====================================== */
  const fetchBackfillProgress = async () => {
    try {
      const res = await api.get<BackfillProgressApiResponse>(
        "/pipeline/backfill/progress"
      );
      const data = res.data;

      if (!data.run_id || !data.symbols) {
        setBackfillProgressMap({});
        return;
      }

      const next: Record<string, SymbolProgress> = {};

      Object.values(data.symbols).forEach((sym) => {
        const intervals: Partial<Record<IntervalKey, IntervalProgress>> = {};

        for (const [intv, row] of Object.entries(sym.intervals)) {
          const interval = intv as IntervalKey;
          intervals[interval] = {
            interval,
            state: (row.state as CeleryState) || "UNKNOWN",
            pct_time: clampPct(row.pct_time),
            last_updated_iso: row.last_updated_iso,
          };
        }

        const sp: SymbolProgress = {
          symbol: sym.symbol,
          state: "UNKNOWN",
          status: "",
          intervals,
        };

        const states = Object.values(intervals).map((x) => x!.state);

        if (states.length === 0) {
          sp.state = "UNKNOWN";
          sp.status = "대기 중";
        } else if (states.every((s) => s === "SUCCESS")) {
          sp.state = "SUCCESS";
          sp.status = "모든 인터벌 완료";
        } else if (states.some((s) => s === "FAILURE")) {
          sp.state = "FAILURE";
          sp.status = "일부 실패";
        } else if (states.some((s) => s === "PROGRESS" || s === "STARTED")) {
          sp.state = "PROGRESS";
          sp.status = "수집 중...";
        } else if (states.every((s) => s === "PENDING")) {
          sp.state = "PENDING";
          sp.status = "대기 중";
        } else {
          sp.state = "UNKNOWN";
          sp.status = "-";
        }

        next[sym.symbol] = sp;
      });

      setBackfillProgressMap(next);
    } catch (err) {
      console.error("Backfill 폴링 실패:", err);
    }
  };

  const startBackfillPolling = () => {
    if (backfillPollRef.current) clearInterval(backfillPollRef.current);

    void fetchBackfillProgress();

    backfillPollRef.current = setInterval(() => {
      if (!document.hidden) fetchBackfillProgress();
    }, POLLING_INTERVAL);
  };

  /* ======================================
   * REST Maintenance Progress (클릭 시 조회)
   * ====================================== */
  const fetchRestProgress = async () => {
    try {
      const res = await api.get<RestProgressApiResponse>(
        "/pipeline/rest/progress"
      );
      const data = res.data;

      if (!data.run_id || !data.symbols) {
        setRestProgress([]);
        return;
      }

      const items: RestSymbolState[] = [];

      Object.values(data.symbols).forEach((sym: RestSymbolApi) => {
        const intervals: RestIntervalState[] = [];

        Object.values(sym.intervals).forEach((iv: RestIntervalApi) => {
          const interval = iv.interval as IntervalKey;
          intervals.push({
            interval,
            state: (iv.state as any) || "UNKNOWN",
            updated_at: iv.updated_at,
          });
        });

        items.push({ symbol: sym.symbol, intervals });
      });

      setRestProgress(items);
    } catch (err) {
      console.error("REST progress 조회 실패:", err);
      setRestProgress([]);
    }
  };

  /* ======================================
   * Indicator Progress (클릭 시 조회)
   * ====================================== */
  const fetchIndicatorProgress = async () => {
    try {
      const res = await api.get<IndicatorProgressApiResponse>(
        "/pipeline/indicator/progress"
      );
      const data = res.data;

      if (!data.run_id || !data.symbols) {
        setIndicatorProgressMap({});
        return;
      }

      const next: Record<string, SymbolProgress> = {};

      Object.values(data.symbols).forEach((sym: IndicatorSymbolApi) => {
        const intervals: Partial<Record<IntervalKey, IntervalProgress>> = {};

        Object.values(sym.intervals).forEach((iv: IndicatorIntervalApi) => {
          const interval = iv.interval as IntervalKey;
          intervals[interval] = {
            interval,
            state: (iv.state as CeleryState) || "UNKNOWN",
            pct_time: clampPct(iv.pct_time),
            last_updated_iso: iv.updated_at,
          };
        });

        const sp: SymbolProgress = {
          symbol: sym.symbol,
          state: "UNKNOWN",
          status: "",
          intervals,
        };

        const states = Object.values(intervals).map((x) => x!.state);

        if (states.length === 0) {
          sp.state = "UNKNOWN";
          sp.status = "대기 중";
        } else if (states.every((s) => s === "SUCCESS")) {
          sp.state = "SUCCESS";
          sp.status = "모든 인터벌 지표 계산 완료";
        } else if (states.some((s) => s === "FAILURE")) {
          sp.state = "FAILURE";
          sp.status = "일부 지표 계산 실패";
        } else if (states.some((s) => s === "PROGRESS" || s === "STARTED")) {
          sp.state = "PROGRESS";
          sp.status = "지표 계산 중...";
        } else if (states.every((s) => s === "PENDING")) {
          sp.state = "PENDING";
          sp.status = "대기 중";
        } else {
          sp.state = "UNKNOWN";
          sp.status = "-";
        }

        next[sym.symbol] = sp;
      });

      setIndicatorProgressMap(next);
    } catch (err) {
      console.error("Indicator progress 조회 실패:", err);
      setIndicatorProgressMap({});
    }
  };

  /* ======================================
   * WebSocket Progress (클릭 시 조회)
   * ====================================== */
  const fetchWebsocketProgress = async () => {
    try {
      const res = await api.get<WebSocketProgressApiResponse>(
        "/pipeline/websocket/progress"
      );
      const data = res.data;

      if (!data.run_id || !data.symbols) {
        setWebsocketProgress([]);
        return;
      }

      const items: WebSocketSymbolState[] = [];

      Object.values(data.symbols).forEach((sym: WebSocketSymbolApi) => {
        const intervals: WebSocketIntervalState[] = [];

        Object.values(sym.intervals).forEach((iv: WebSocketIntervalApi) => {
          const interval = iv.interval as IntervalKey;
          intervals.push({
            interval,
            state: (iv.state as any) || "UNKNOWN",
            message_count: iv.message_count || 0,
            last_message_ts: iv.last_message_ts,
            last_error: iv.last_error,
          });
        });

        items.push({ symbol: sym.symbol, intervals });
      });

      setWebsocketProgress(items);
    } catch (err) {
      console.error("WebSocket progress 조회 실패:", err);
      setWebsocketProgress([]);
    }
  };


  /* ======================================
   * Pipeline Status polling
   * ====================================== */
  useEffect(() => {
    if (isChecking || !isValid) return;

    const fetchPipelineStatus = async () => {
      try {
        const res = await api.get<PipelineStatusApiResponse>(
          "/pipeline/status"
        );
        setPipelineActive(res.data.is_active);

        setEngineStatus({
          websocket: res.data.websocket,
          backfill: res.data.backfill,
          rest_maintenance: res.data.rest_maintenance,
          indicator: res.data.indicator,
        });

        setPipelineStatusMessage(
          res.data.is_active
            ? "데이터 수집 파이프라인 활성화됨"
            : "파이프라인 비활성 상태"
        );
      } catch (err) {
        console.error("파이프라인 상태 조회 실패:", err);
        setPipelineStatusMessage("파이프라인 상태 조회 실패");
      }
    };

    void fetchPipelineStatus();

    pipelinePollRef.current = setInterval(() => {
      if (!document.hidden) void fetchPipelineStatus();
    }, POLLING_INTERVAL);

    return () => {
      if (pipelinePollRef.current) clearInterval(pipelinePollRef.current);
    };
  }, [isChecking, isValid]);

  // 인증 끝났을 때 Backfill polling 시작
  useEffect(() => {
    if (!isChecking && isValid) startBackfillPolling();

    return () => {
      if (backfillPollRef.current) clearInterval(backfillPollRef.current);
    };
  }, [isChecking, isValid]);

  // REST 모달이 열려있을 때 폴링
  useEffect(() => {
    if (!showRestPanel) return;

    void fetchRestProgress(); // 초기 데이터 가져오기

    const pollRef = setInterval(() => {
      if (!document.hidden) void fetchRestProgress();
    }, POLLING_INTERVAL);

    return () => clearInterval(pollRef);
  }, [showRestPanel]);

  // Indicator 모달이 열려있을 때 폴링
  useEffect(() => {
    if (!showIndicatorPanel) return;

    void fetchIndicatorProgress(); // 초기 데이터 가져오기

    const pollRef = setInterval(() => {
      if (!document.hidden) void fetchIndicatorProgress();
    }, POLLING_INTERVAL);

    return () => clearInterval(pollRef);
  }, [showIndicatorPanel]);

  // WebSocket 모달이 열려있을 때 폴링
  useEffect(() => {
    if (!showWebsocketPanel) return;

    void fetchWebsocketProgress(); // 초기 데이터 가져오기

    const pollRef = setInterval(() => {
      if (!document.hidden) void fetchWebsocketProgress();
    }, POLLING_INTERVAL);

    return () => clearInterval(pollRef);
  }, [showWebsocketPanel]);

  /* ======================================
   * 버튼 핸들러
   * ====================================== */
  const handleRegisterSymbols = async () => {
    setLoading(true);
    setRegisterMessage("");

    try {
      const res = await api.post(`/get_symbol_info/register_symbols`);
      setRegisterMessage(res.data?.message || "종목 정보 갱신 완료");
    } catch (err: any) {
      const msg =
        err.response?.data?.detail || err.message || "종목 갱신 실패";
      setRegisterMessage(`실패: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStartCollection = async () => {
    if (isPipelineActive) return;

    setLoading(true);

    try {
      const res = await api.post(`/pipeline/on`);
      setPipelineActive(true);
      setPipelineStatusMessage(
        res.data?.message || "파이프라인 활성화됨"
      );
    } catch (err: any) {
      alert("시작 실패: " + (err.message || ""));
      setPipelineActive(false);
    } finally {
      setLoading(false);
    }
  };

  const handleStopCollection = async () => {
    if (!isPipelineActive) return;

    setLoading(true);

    try {
      const res = await api.post(`/pipeline/off`);
      setPipelineActive(false);
      alert("데이터 수집 파이프라인 OFF");
    } catch (err: any) {
      alert("중지 실패: " + (err.message || ""));
    } finally {
      setLoading(false);
    }
  };

  /* ======================================
   * 리스트 렌더링용 rows
   * ====================================== */
  const backfillRows = useMemo(
    () =>
      Object.entries(backfillProgressMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([symbol, p], idx) => ({
          idx: idx + 1,
          symbol,
          p,
          overallPct: computeOverallPct(p),
        })),
    [backfillProgressMap]
  );

  const indicatorRows = useMemo(
    () =>
      Object.entries(indicatorProgressMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([symbol, p], idx) => ({
          idx: idx + 1,
          symbol,
          p,
          overallPct: computeOverallPct(p),
        })),
    [indicatorProgressMap]
  );

  const scrollToTop = () =>
    listContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToBottom = () =>
    listContainerRef.current?.scrollTo({
      top: listContainerRef.current.scrollHeight,
      behavior: "smooth",
    });

  /* ======================================
   * 엔진 카드 렌더링
   * ====================================== */
  const renderEngineCard = (
    label: string,
    data?: EngineStatus,
    onClick?: () => void
  ) => {
    const st: EngineStatusState = data?.status || "UNKNOWN";
    let badgeClass = "text-gray-300 border-gray-500";

    if (st === "SUCCESS") badgeClass = "text-green-300 border-green-400";
    else if (st === "PROGRESS") badgeClass = "text-blue-300 border-blue-400";
    else if (st === "FAIL" || st === "FAILURE")
      badgeClass = "text-red-300 border-red-400";

    const Wrapper: any = onClick ? "button" : "div";

    return (
      <Wrapper
        onClick={onClick}
        className={`bg-gray-900/60 border border-gray-700 rounded-md p-3 text-xs flex flex-col justify-between
        ${onClick ? "hover:border-cyan-400 cursor-pointer" : ""}`}
      >
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-gray-100">{label}</span>
            <span className={`px-2 py-0.5 rounded-full border ${badgeClass}`}>
              {st}
            </span>
          </div>

          <p className="text-[11px] text-gray-300 mb-1">
            {data?.is_active ? "작업 활성화됨" : "작업 비활성"}
          </p>

          {data?.updated_at && (
            <p className="text-[10px] text-gray-500">
              업데이트: {data.updated_at}
            </p>
          )}
        </div>

        {data?.last_error && (
          <p className="text-[11px] text-red-400 break-words mt-2">
            에러: {data.last_error}
          </p>
        )}
      </Wrapper>
    );
  };

  /* ======================================
   * 렌더링 시작
   * ====================================== */
  if (isChecking)
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-gray-900 text-white">
        인증 확인 중...
      </div>
    );
  if (!isValid) return null;

  return (
    <div className="flex flex-col items-center w-screen min-h-screen p-6 md:p-8 bg-gray-900 text-white">
      {/* 1. 종목 정보 갱신 */}
      <h1 className="text-3xl font-bold mb-6">DB 관리</h1>

      <div className="bg-gray-800 p-6 rounded-lg w-full max-w-3xl text-center border border-gray-700 mb-6 sticky top-0 z-20">
        <h2 className="text-lg font-semibold mb-4 text-cyan-400">
          1. 종목 정보 갱신
        </h2>

        <button
          onClick={handleRegisterSymbols}
          disabled={loading}
          className="w-full px-4 py-2 rounded-md bg-blue-500 hover:bg-blue-600 font-semibold"
        >
          {loading ? "갱신 중..." : "기존 종목 정보 갱신"}
        </button>

        {registerMessage && (
          <p className="text-sm mt-2">
            {registerMessage.includes("실패") ? (
              <span className="text-red-400">{registerMessage}</span>
            ) : (
              <span className="text-green-400">{registerMessage}</span>
            )}
          </p>
        )}
      </div>

      {/* 2. 파이프라인 제어 패널 */}
      <div className="bg-gray-800 w-full max-w-5xl rounded-lg border border-gray-700">
        <div className="p-6 border-b border-gray-700 sticky top-[130px] bg-gray-800 z-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-green-400">
              2. 데이터 수집 파이프라인
            </h2>

            <span
              className={`text-xs px-2 py-1 rounded-full border ${
                isPipelineActive
                  ? "text-green-300 border-green-400"
                  : "text-gray-300 border-gray-500"
              }`}
            >
              {isPipelineActive ? "ACTIVE" : "INACTIVE"}
            </span>
          </div>

          <p className="text-xs text-gray-300 mb-3">
            {pipelineStatusMessage}
          </p>

          {/* Start / Stop 버튼 */}
          <div className="flex flex-row gap-4 mb-3">
            <button
              onClick={
                isPipelineActive ? handleStopCollection : handleStartCollection
              }
              disabled={loading}
              className={`px-4 py-2 rounded-md font-semibold ${
                isPipelineActive
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-green-500 hover:bg-green-600"
              }`}
            >
              {isPipelineActive
                ? "데이터 수집 파이프라인 OFF"
                : "데이터 수집 파이프라인 ON"}
            </button>
          </div>

          {/* 엔진 카드 4개 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {renderEngineCard(
              "WebSocket 실시간",
              engineStatus.websocket,
              () => setShowWebsocketPanel(true)
            )}
            {renderEngineCard(
              "Backfill 엔진",
              engineStatus.backfill,
              () => setShowBackfillPanel(true)
            )}
            {renderEngineCard(
              "REST 유지보수 엔진",
              engineStatus.rest_maintenance,
              () => setShowRestPanel(true)
            )}
            {renderEngineCard(
              "보조지표 계산 엔진",
              engineStatus.indicator,
              () => setShowIndicatorPanel(true)
            )}
          </div>
        </div>
      </div>

      {/* =============================== */}
      {/*      Backfill 모달 창           */}
      {/* =============================== */}
      {showBackfillPanel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 w-[95vw] max-w-5xl max-h-[85vh] rounded-lg border border-gray-700 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-cyan-300">
                  Backfill 진행현황
                </h3>
                <p className="text-xs text-gray-400">
                  /pipeline/backfill/progress
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
                  className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-xs"
                >
                  닫기
                </button>
              </div>
            </div>

            {/* Body */}
            <div ref={listContainerRef} className="px-4 py-4 overflow-y-auto">
              {backfillRows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  진행 중인 Backfill 없음
                </p>
              ) : (
                backfillRows.map(({ symbol, p, overallPct }) => (
                  <div
                    key={symbol}
                    className="p-4 mb-4 rounded-lg border border-gray-700 bg-gray-800"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-semibold">{symbol}</h3>
                      <span className="text-xs text-gray-300">{p.state}</span>
                    </div>

                    <p className="text-xs text-gray-400 mb-2">
                      {p.status || "-"}
                    </p>

                    <div className="mb-2">
                      <div className="text-xs mb-1">
                        전체 진행률: {overallPct}%
                      </div>
                      <div className="w-full bg-gray-700 h-2 rounded-full">
                        <div
                          className="bg-cyan-500 h-2 rounded-full"
                          style={{ width: `${overallPct}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Interval details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                      {INTERVAL_ORDER.map((iv) => {
                        const ivp = p.intervals[iv];
                        const state = ivp?.state || "PENDING";

                        return (
                          <div
                            key={iv}
                            className="p-2 border border-gray-700 rounded-md bg-gray-900"
                          >
                            <div className="text-xs text-gray-300 mb-1 flex justify-between">
                              <span>{iv}</span>
                              <span>{state}</span>
                            </div>
                            <div className="w-full bg-gray-700 h-2 rounded-full">
                              <div
                                className="bg-blue-400 h-2 rounded-full"
                                style={{
                                  width: `${
                                    ivp ? clampPct(ivp.pct_time) : 0
                                  }%`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =============================== */}
      {/*      REST 유지보수 모달         */}
      {/* =============================== */}
      {showRestPanel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 w-[90vw] max-w-3xl max-h-[80vh] rounded-lg border border-gray-700 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-green-300">
                  REST 유지보수 상태
                </h3>
                <p className="text-xs text-gray-400">
                  /pipeline/rest/progress
                </p>
              </div>
              <button
                onClick={() => setShowRestPanel(false)}
                className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-xs"
              >
                닫기
              </button>
            </div>

            {/* Body */}
            <div ref={restListRef} className="px-4 py-4 overflow-y-auto">
              {restProgress.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  유지보수 대상 없음 (SUCCESS)
                </p>
              ) : (
                restProgress.map((row) => (
                  <div
                    key={row.symbol}
                    className="p-3 mb-3 rounded-lg border border-gray-700 bg-gray-800"
                  >
                    <h3 className="text-md font-bold mb-2 text-white">
                      {row.symbol}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {row.intervals.map((iv) => {
                        let color = "text-gray-300";
                        if (iv.state === "SUCCESS")
                          color = "text-green-400";
                        else if (iv.state === "FAILURE")
                          color = "text-red-400";
                        else if (iv.state === "PROGRESS")
                          color = "text-blue-400";

                        return (
                          <div
                            key={iv.interval}
                            className="p-2 border border-gray-700 rounded bg-gray-900"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-400">
                                {iv.interval}
                              </span>
                              <span className={`text-xs font-semibold ${color}`}>
                                {iv.state}
                              </span>
                            </div>
                            {iv.updated_at && (
                              <div className="text-[10px] text-gray-500">
                                {iv.updated_at}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =============================== */}
      {/*   Indicator 진행현황 모달        */}
      {/* =============================== */}
      {showIndicatorPanel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 w-[95vw] max-w-5xl max-h-[85vh] rounded-lg border border-gray-700 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-yellow-300">
                  보조지표 계산 진행현황
                </h3>
                <p className="text-xs text-gray-400">
                  /pipeline/indicator/progress
                </p>
              </div>
              <button
                onClick={() => setShowIndicatorPanel(false)}
                className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-xs"
              >
                닫기
              </button>
            </div>

            {/* Body */}
            <div
              ref={indicatorListRef}
              className="px-4 py-4 overflow-y-auto"
            >
              {indicatorRows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  진행 중인 보조지표 계산 작업이 없습니다.
                </p>
              ) : (
                indicatorRows.map(({ symbol, p, overallPct }) => (
                  <div
                    key={symbol}
                    className="p-4 mb-4 rounded-lg border border-gray-700 bg-gray-800"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-semibold">{symbol}</h3>
                      <span className="text-xs text-gray-300">
                        {p.state}
                      </span>
                    </div>

                    <p className="text-xs text-gray-400 mb-2">
                      {p.status || "-"}
                    </p>

                    <div className="mb-2">
                      <div className="text-xs mb-1">
                        전체 진행률: {overallPct}%
                      </div>
                      <div className="w-full bg-gray-700 h-2 rounded-full">
                        <div
                          className="bg-yellow-400 h-2 rounded-full"
                          style={{ width: `${overallPct}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Interval details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                      {INTERVAL_ORDER.map((iv) => {
                        const ivp = p.intervals[iv];
                        const state = ivp?.state || "PENDING";

                        return (
                          <div
                            key={iv}
                            className="p-2 border border-gray-700 rounded-md bg-gray-900"
                          >
                            <div className="text-xs text-gray-300 mb-1 flex justify-between">
                              <span>{iv}</span>
                              <span>{state}</span>
                            </div>
                            <div className="w-full bg-gray-700 h-2 rounded-full">
                              <div
                                className="bg-yellow-400 h-2 rounded-full"
                                style={{
                                  width: `${
                                    ivp ? clampPct(ivp.pct_time) : 0
                                  }%`,
                                }}
                              />
                            </div>
                            {ivp?.last_updated_iso && (
                              <div className="text-[10px] text-gray-500 mt-1">
                                {ivp.last_updated_iso}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =============================== */}
      {/*   WebSocket 연결 상태 모달      */}
      {/* =============================== */}
      {showWebsocketPanel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
          <div className="bg-gray-900 w-[90vw] max-w-3xl max-h-[80vh] rounded-lg border border-gray-700 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
              <div>
                <h3 className="text-lg font-semibold text-purple-300">
                  WebSocket 실시간 연결 상태
                </h3>
                <p className="text-xs text-gray-400">
                  /pipeline/websocket/progress
                </p>
              </div>
              <button
                onClick={() => setShowWebsocketPanel(false)}
                className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-xs"
              >
                닫기
              </button>
            </div>

            {/* Body */}
            <div ref={websocketListRef} className="px-4 py-4 overflow-y-auto">
              {websocketProgress.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">
                  WebSocket 연결 정보 없음
                </p>
              ) : (
                websocketProgress.map((row) => (
                  <div
                    key={row.symbol}
                    className="p-3 mb-3 rounded-lg border border-gray-700 bg-gray-800"
                  >
                    <h3 className="text-md font-bold mb-2 text-white">
                      {row.symbol}
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {row.intervals.map((iv) => {
                        let color = "text-gray-300";
                        let bgColor = "bg-gray-900";
                        if (iv.state === "CONNECTED") {
                          color = "text-green-400";
                          bgColor = "bg-green-900/20";
                        } else if (iv.state === "ERROR") {
                          color = "text-red-400";
                          bgColor = "bg-red-900/20";
                        } else if (iv.state === "DISCONNECTED") {
                          color = "text-gray-400";
                          bgColor = "bg-gray-900";
                        }

                        return (
                          <div
                            key={iv.interval}
                            className={`p-2 border border-gray-700 rounded ${bgColor}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-400">
                                {iv.interval}
                              </span>
                              <span className={`text-xs font-semibold ${color}`}>
                                {iv.state}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-500">
                              메시지: {iv.message_count.toLocaleString()}개
                            </div>
                            {iv.last_message_ts && (
                              <div className="text-[10px] text-gray-500">
                                최근: {new Date(iv.last_message_ts).toLocaleTimeString()}
                              </div>
                            )}
                            {iv.last_error && (
                              <div className="text-[10px] text-red-400 mt-1 truncate">
                                에러: {iv.last_error}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
