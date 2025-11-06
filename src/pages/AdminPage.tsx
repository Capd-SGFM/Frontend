import React, { useState, useRef, useEffect, useMemo } from "react";
import axios from "axios";

type CeleryState = "PENDING" | "PROGRESS" | "SUCCESS" | "FAILURE" | "STARTED" | "UNKNOWN";
// DB 스키마에 정의된 모든 인터벌을 포함
type IntervalKey = "1m" | "3m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M";
const INTERVAL_ORDER: IntervalKey[] = ["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"];

// --- (백엔드 /routers/schemas.py와 일치하는 타입) ---
interface TaskInfo {
  task_id: string;
  symbol: string;
  interval: string;
}
interface TaskStatusResponse {
  task_id: string;
  state: string;
  meta: any;
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
  state: CeleryState; // "PROGRESS", "SUCCESS" 등 (개별 인터벌 상태에서 파생됨)
  status: string; // "수집 중...", "완료" 등
  // 모든 인터벌의 개별 진행 상황
  intervals: Partial<Record<IntervalKey, IntervalProgress>>;
}
// ---------------------------------------------------

const API_URL = (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:8080";
const POLLING_INTERVAL = 2000; // 폴링 간격
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
      .map(intv => p.intervals[intv]?.pct_time)
      .filter(pct => typeof pct === 'number') as number[];
      
  if (percentages.length === 0) return 0;
  
  const sum = percentages.reduce((a, b) => a + b, 0);
  return Math.round(sum / percentages.length);
}

// 심볼에 대한 초기 상태 객체를 생성
const createEmptySymbolProgress = (symbol: string): SymbolProgress => ({
  symbol: symbol,
  state: "PENDING",
  status: "대기 중...",
  intervals: {},
});

const AdminPage: React.FC = () => {
  const [registerMessage, setRegisterMessage] = useState("");
  const [loading, setLoading] = useState(false); // UI 로딩 (버튼 클릭 시)
  
  // UI 표시에 사용되는 메인 상태 (심볼 기준)
  const [progressMap, setProgressMap] = useState<Record<string, SymbolProgress>>({});
  
  // Celery 작업 추적용 상태
  // (Task ID -> {심볼, 인터벌}) 매핑
  const [taskMap, setTaskMap] = useState<Record<string, { symbol: string, interval: IntervalKey }>>({});
  // (현재 실행/폴링 중인 모든 Task ID 목록)
  const [allTaskIds, setAllTaskIds] = useState<string[]>([]);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // "진행 중" 여부를 allTaskIds 기준으로 판단
  const isBackfillRunning = useMemo(
    () => allTaskIds.length > 0,
    [allTaskIds]
  );

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  // 폴링 시작 로직 (task ID 목록만 받음)
  const startPolling = (ids: string[]) => {
    stopPolling();
    if (!ids.length) return;
    
    // 즉시 1회 실행
    void pollBulkStatuses(ids); 
    
    // 인터벌 설정
    pollIntervalRef.current = setInterval(() => {
      // 화면이 보일 때만 폴링
      if (!document.hidden) void pollBulkStatuses(ids);
    }, POLLING_INTERVAL);
  };

  // "1. 종목 정보 갱신" (변경 없음)
  const handleRegisterSymbols = async () => {
    if (isBackfillRunning) return;
    setLoading(true);
    setRegisterMessage("");
    try {
      const res = await api.post(`/get_symbol_info/register_symbols`);
      setRegisterMessage(res.data?.message || "종목 정보 갱신 완료");
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || "종목 갱신 실패";
      setRegisterMessage(`실패: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // "2. OHLCV 데이터 백필" -> "수집 시작"
  const handleStartCollection = async () => {
    if (isBackfillRunning) return;
    setLoading(true);
    
    // 상태 초기화
    setProgressMap({});
    setTaskMap({});
    setAllTaskIds([]);
    stopPolling();

    try {
      // DB의 모든 심볼을 가져오도록 백엔드에 요청
      const symbolsRes = await api.get<{ symbols: string[] }>("/symbols/all");
      const symbolsToFetch = symbolsRes.data?.symbols;

      if (!symbolsToFetch || symbolsToFetch.length === 0) {
        throw new Error("서버에서 조회된 심볼이 없습니다. '종목 정보 갱신'을 먼저 실행하세요.");
      }
      
      const intervalsToFetch = [...INTERVAL_ORDER]; // 모든 인터벌
      
      // 새 백엔드 엔드포인트 호출 (Body가 비어있음)
      const res = await api.post(`/ohlcv/backfill`, {});

      const { tasks } = (res.data || {}) as { tasks: TaskInfo[] };
      if (!tasks || tasks.length === 0) throw new Error("백엔드에서 작업을 생성하지 못했습니다.");

      const newProgressMap: Record<string, SymbolProgress> = {};
      const newTaskMap: Record<string, { symbol: string, interval: IntervalKey }> = {};
      const newTaskIds: string[] = [];

      // UI에 모든 심볼을 먼저 표시
      for (const symbol of symbolsToFetch) {
          newProgressMap[symbol] = createEmptySymbolProgress(symbol);
      }

      // 백엔드에서 받은 실제 작업 정보로 상태 업데이트
      for (const task of tasks) {
        newTaskIds.push(task.task_id);
        const intervalKey = task.interval as IntervalKey;
        newTaskMap[task.task_id] = { symbol: task.symbol, interval: intervalKey };
        
        // 해당 심볼의 인터벌에 "PENDING" 상태 추가
        newProgressMap[task.symbol].intervals[intervalKey] = {
          interval: intervalKey,
          state: "PENDING",
          pct_time: 0,
        };
      }

      setProgressMap(newProgressMap);
      setTaskMap(newTaskMap);
      setAllTaskIds(newTaskIds);
      
      // 폴링 시작
      startPolling(newTaskIds);

    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.message || "백필 시작 실패";
      alert(`백필 시작 실패: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };
  
  // "수집 중지" 버튼 핸들러
  const handleStopCollection = async () => {
    if (!isBackfillRunning) return;
    setLoading(true);
    
    try {
      // 모든 활성 Task ID에 대해 중지 요청
      await Promise.allSettled(
        allTaskIds.map(id => api.post(`/ohlcv/stop/${id}`))
      );
      
      alert("모든 작업에 중지 신호를 보냈습니다. (반영에 시간이 걸릴 수 있음)");
      
    } catch (err: any) {
      alert(`작업 중지 실패: ${err.message}`);
    } finally {
      // 폴링 및 상태 즉시 중지
      stopPolling();
      setAllTaskIds([]);
      setTaskMap({});
      // progressMap은 마지막 상태를 보여주기 위해 유지
      setLoading(false);
    }
  };

  // 폴링 및 상태 업데이트 로직
  const pollBulkStatuses = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      // (가정) 백엔드에 'POST /ohlcv/status/bulk' 엔드포인트가 구현되어 있어야 함
      // (이전 답변의 routers/ohlcv_backfill.py에는 이 기능이 누락되어 있으므로, 백엔드에 추가 필요)
      
      // (임시) 개별 폴링으로 대체 (비효율적이지만, 이전 답변 백엔드와 호환됨)
      const responses = await Promise.allSettled(
        ids.map(id => api.get<TaskStatusResponse>(`/ohlcv/status/${id}`))
      );
      const items = responses
        .filter(res => res.status === 'fulfilled')
        .map(res => (res as PromiseFulfilledResult<axios.AxiosResponse<TaskStatusResponse>>).value.data);



      setProgressMap((prev) => {
        const next: Record<string, SymbolProgress> = JSON.parse(JSON.stringify(prev));
        
        // 1. 개별 인터벌 상태 업데이트
        for (const item of items) {
          const taskInfo = taskMap[item.task_id];
          if (!taskInfo) continue;
          
          const { symbol, interval } = taskInfo;
          if (!next[symbol]) continue;

          const meta = item.meta || {};
          const prevInterval = next[symbol].intervals[interval];
          
          next[symbol].intervals[interval] = {
            interval: interval,
            state: item.state as CeleryState,
            pct_time: clampPct(meta.pct ?? prevInterval?.pct_time ?? 0),
            last_updated_iso: meta.last_candle_time ?? prevInterval?.last_updated_iso ?? null,
          };
        }

        // 2. 전체 심볼 상태 재계산
        for (const symbol in next) {
          const symbolProgress = next[symbol];
          const symbolIntervals = INTERVAL_ORDER
            .map(intv => symbolProgress.intervals[intv])
            .filter(Boolean) as IntervalProgress[]; // 이 심볼에 할당된 모든 인터벌 작업
            
          if (symbolIntervals.length === 0) {
             // 이 심볼에 대해 시작된 작업이 없음
             symbolProgress.state = "UNKNOWN"; // 혹은 'PENDING'
             symbolProgress.status = "수집 대기 중";
             continue;
          }

          if (symbolIntervals.some(iv => iv.state === "FAILURE")) {
            symbolProgress.state = "FAILURE";
            symbolProgress.status = "하나 이상의 인터벌 수집 실패";
          } else if (symbolIntervals.every(iv => iv.state === "SUCCESS")) {
            symbolProgress.state = "SUCCESS";
            symbolProgress.status = "모든 인터벌 수집 완료";
          } else if (symbolIntervals.some(iv => iv.state === "PROGRESS" || iv.state === "STARTED")) {
            symbolProgress.state = "PROGRESS";
            symbolProgress.status = "데이터 수집 중...";
          } else if (symbolIntervals.every(iv => iv.state === "PENDING")) {
            symbolProgress.state = "PENDING";
            symbolProgress.status = "작업 대기 중...";
          }
        }
        return next;
      });

      // 모든 작업이 완료(SUCCESS 또는 FAILURE)되었는지 확인
      const allDone = items.every((it) => ["SUCCESS", "FAILURE"].includes(it.state));
      if (allDone) {
        stopPolling();
        setAllTaskIds([]);
        setTaskMap({});
      }
    } catch (err) {
      console.error("벌크 상태 폴링 오류:", err);
    }
  };

  // 컴포넌트 unmount 시 폴링을 중지하도록 useEffect 남김
  useEffect(() => {
    // 컴포넌트가 사라질 때 인터벌 정리
    return () => {
      stopPolling();
    };
  }, []); // 빈 배열로 마운트/언마운트 시 1회만 실행

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
    listContainerRef.current?.scrollTo({ top: listContainerRef.current.scrollHeight, behavior: "smooth" });
  };
  const scrollToTop = () => {
    listContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col items-center w-screen min-h-screen p-6 md:p-8 bg-gray-900 text-white">
      <h1 className="text-3xl font-bold mb-6">DB 관리</h1>

      {/* 1. 종목 정보 갱신 */}
      <div className="bg-gray-800 p-6 rounded-lg w-full max-w-3xl text-center shadow-xl border border-gray-700 mb-6 sticky top-0 z-20 backdrop-blur bg-gray-800/95">
        <h2 className="text-lg font-semibold mb-4 text-cyan-400">1. 종목 정보 갱신</h2>
        <button
          onClick={handleRegisterSymbols}
          disabled={loading || isBackfillRunning}
          className={`w-full px-4 py-2 rounded-md font-semibold text-white ${
            loading || isBackfillRunning ? "bg-blue-400 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-600"
          }`}
        >
          {loading ? "갱신 중..." : "기존 종목 정보 갱신 (CSV/API 기준)"}
        </button>
        {registerMessage && (
          <p className={`text-sm mt-3 ${registerMessage.includes("실패") ? "text-red-400" : "text-green-400"}`}>
            {registerMessage}
          </p>
        )}
      </div>

      {/* 2. OHLCV 백필 패널 */}
      <div className="bg-gray-800 w-full max-w-5xl rounded-lg shadow-xl border border-gray-700">
        <div className="p-4 md:p-6 border-b border-gray-700 sticky top-[132px] md:top-[144px] bg-gray-800/95 backdrop-blur z-10">
          <h2 className="text-lg font-semibold mb-4 text-green-400">2. OHLCV 데이터 수집</h2>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            
            {/* 수집 시작 버튼 */}
            <button
              onClick={handleStartCollection}
              disabled={loading || isBackfillRunning}
              className={`w-full md:w-auto px-4 py-2 rounded-md font-semibold text-white ${
                loading || isBackfillRunning ? "bg-green-400 cursor-not-allowed" : "bg-green-500 hover:bg-green-600"
              }`}
            >
              {isBackfillRunning ? "작업 진행 중..." : "모든 종목 데이터 수집 시작"}
            </button>
            
            {/* 수집 중지 버튼 */}
            <button
              onClick={handleStopCollection}
              disabled={loading || !isBackfillRunning}
              className={`w-full md:w-auto px-4 py-2 rounded-md font-semibold text-white ${
                loading || !isBackfillRunning ? "bg-red-400 cursor-not-allowed" : "bg-red-500 hover:bg-red-600"
              }`}
            >
              {loading ? "중지 중..." : "모든 작업 중지"}
            </button>

            <div className="flex-1" />
            <div className="flex gap-2">
              <button onClick={scrollToTop} className="px-3 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-xs">
                맨 위로
              </button>
              <button onClick={scrollToBottom} className="px-3 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-xs">
                맨 아래로
              </button>
            </div>
          </div>
        </div>

        {/* 진행률 표시 (UI 로직 수정됨) */}
        <div ref={listContainerRef} className="px-4 md:px-6 pb-16 max-h-[70vh] overflow-y-auto">
          {rows.length > 0 ? (
            <div className="mt-4 space-y-4">
              {rows.map(({ idx, symbol, p, overallPct }) => (
                <div
                  key={symbol}
                  className={`p-4 rounded-lg ${
                    p.state === "FAILURE"
                      ? "bg-red-900/50"
                      : p.state === "SUCCESS"
                      ? "bg-green-900/50"
                      : "bg-gray-700"
                  }`}
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

                  <p className="text-sm text-gray-300 mt-1 truncate">{p.status || "-"}</p>

                  {/* 심볼 전체 진행률 바 */}
                  <div className="mt-2">
                    <div className="flex justify-between text-xs text-gray-300 mb-1">
                      <span>전체 진행률 (인터벌 평균)</span>
                      <span>
                        {overallPct}%
                      </span>
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
                      const pct = Math.round(clampPct(ivp?.pct_time ?? 0));
                      
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
                          // 이 심볼에 대해 이 인터벌은 아예 시작되지 않음
                          tag = "-";
                          tagColor = "text-gray-600";
                          barColor = "bg-gray-800";
                      }
                      
                      // 작업이 시작되지 않은 인터벌은 흐리게 처리
                      if (!ivp) {
                        return (
                          <div key={iv} className="bg-gray-800/30 rounded-md p-3 border border-gray-700/50 opacity-50">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="text-gray-500">{iv}</span>
                              <span className={tagColor}>{tag}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div className={`${barColor} h-2 rounded-full`} style={{ width: `0%` }} />
                            </div>
                          </div>
                        );
                      }
                      
                      // 작업이 시작된 인터벌
                      return (
                        <div key={iv} className="bg-gray-800/50 rounded-md p-3 border border-gray-700">
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
              {loading ? "작업 시작 중..." : "수집 시작 버튼을 눌러주세요."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;