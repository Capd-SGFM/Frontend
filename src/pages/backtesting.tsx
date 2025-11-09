import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuthCheck } from "../components/is_logined";

const BACKEND_URL =
  import.meta.env.VITE_BACKTESTING_BACKEND_URL || "http://localhost:8090";

interface BacktestResult {
  entry_time: string;
  exit_time: string | null;
  result: string;
  profit_rate: number;
  cum_profit_rate: number;
}

const BacktestingPage: React.FC = () => {
  const { isChecking, isValid } = useAuthCheck();

  const [symbol, setSymbol] = useState("");
  const [interval, setInterval] = useState("");
  const [riskReward, setRiskReward] = useState(2.0);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [intervals, setIntervals] = useState<string[]>([]);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [stopLossType, setStopLossType] = useState("low");
  const [stopLossValue, setStopLossValue] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<{ min: string; max: string } | null>(null);

  const availableColumns = [
    "open", "high", "low", "close", "volume",
    "rsi_14", "ema_7", "ema_21", "ema_99",
    "sma_7", "sma_21", "sma_99",
    "macd", "macd_signal", "macd_hist",
    "bb_upper", "bb_middle", "bb_lower",
    "volume_20",
  ];
  const operators = [">", "<", ">=", "<=", "==", "!="];
  const logicOps = ["AND", "OR"];

  const [conditions, setConditions] = useState<
    { logic: string; left: string; operator: string; rightType: string; right: string }[]
  >([]);
  const [newCondition, setNewCondition] = useState({
    logic: "AND",
    left: "",
    operator: "",
    rightType: "value",
    right: "",
  });

  const token = localStorage.getItem("jwt_token");
  const axiosAuth = axios.create({
    baseURL: BACKEND_URL,
    headers: { Authorization: `Bearer ${token}` },
  });

  axiosAuth.interceptors.response.use(
    (res) => res,
    (error) => {
      if (error.response?.status === 401) {
        alert("세션이 만료되었습니다. 다시 로그인해주세요.");
        localStorage.removeItem("jwt_token");
        window.location.href = "/";
      }
      return Promise.reject(error);
    }
  );

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [symbolsRes, intervalsRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/symbols`),
          axios.get(`${BACKEND_URL}/intervals`),
        ]);
        setSymbols(symbolsRes.data?.symbols || symbolsRes.data || []);
        setIntervals(intervalsRes.data || []);
      } catch (e) {
        console.error("⚠️ 옵션 불러오기 실패:", e);
      }
    };
    fetchOptions();
  }, []);

  useEffect(() => {
    if (!symbol || !interval) return;
    const fetchTimeRange = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/time-range/${symbol}/${interval}`);
        const minDate = new Date(res.data.min_time).toISOString().split("T")[0];
        const maxDate = new Date(res.data.max_time).toISOString().split("T")[0];
        setTimeRange({ min: minDate, max: maxDate });
        setStartTime("");
        setEndTime("");
      } catch (e) {
        console.error("⚠️ 시간 범위 조회 실패:", e);
        setTimeRange(null);
      }
    };
    fetchTimeRange();
  }, [symbol, interval]);

  const isStartTimeActive = !!(symbol && interval && timeRange);
  const isEndTimeActive = !!startTime;

  const strategySql = conditions
    .map((c, i) => `${i > 0 ? c.logic + " " : ""}${c.left} ${c.operator} ${c.right}`)
    .join(" ");

  const addCondition = () => {
    if (!newCondition.left || !newCondition.operator || !newCondition.right) {
      alert("⚠️ 모든 조건을 입력해주세요.");
      return;
    }
    setConditions([...conditions, { ...newCondition }]);
    setNewCondition({ logic: "AND", left: "", operator: "", rightType: "value", right: "" });
  };

  const fetchResults = async () => {
    try {
      const res = await axiosAuth.get(`/filtered`);
      setResults(res.data || []);
    } catch (e) {
      console.error("❌ 결과 조회 오류:", e);
    }
  };

  const handleRunBacktest = async () => {
    if (!symbol || !interval || !strategySql || !startTime || !endTime) {
      setMessage("⚠️ 모든 필드를 입력해주세요.");
      return;
    }
    if (stopLossType === "custom" && (stopLossValue === null || isNaN(stopLossValue))) {
      setMessage("⚠️ 사용자 지정 손절가를 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("전략 실행 중...");

    try {
      const res = await axiosAuth.post(`/save_strategy`, {
        symbol,
        interval,
        strategy_sql: strategySql,
        risk_reward_ratio: riskReward,
        stop_loss_type: stopLossType,
        stop_loss_value: stopLossValue,
        start_time: startTime,
        end_time: endTime,
      });
      setMessage(res.data.message || "완료");
      await fetchResults();
    } catch (e) {
      console.error("❌ 전략 실행 오류:", e);
      setMessage("❌ 전략 실행 중 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  if (isChecking)
    return (
      <div className="flex items-center justify-center h-screen text-white bg-gray-900">
         로그인 상태 확인 중...
      </div>
    );
  if (!isValid) return null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center py-10 px-6">
      <h1 className="text-3xl font-bold text-cyan-400 mb-8 flex items-center gap-2">
         Backtesting Dashboard
      </h1>

      {/* 메인 컨테이너 (양쪽 배치) */}
      <div className="flex flex-col md:flex-row gap-8 w-full max-w-7xl justify-center">
        {/* 왼쪽: 입력 패널 */}
        <div className="bg-gray-900 p-6 rounded-2xl shadow-lg border border-gray-700 w-full md:w-[420px]">
          <div className="grid grid-cols-2 gap-4">
            {/* Symbol */}
            <div>
              <label className="text-sm text-gray-400">Symbol</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              >
                <option value="">심볼 선택</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Interval */}
            <div>
              <label className="text-sm text-gray-400">Interval</label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              >
                <option value="">인터벌 선택</option>
                {intervals.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Strategy Builder */}
          <div className="mt-4">
            <label className="text-sm text-gray-400">Strategy Builder</label>
            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {conditions.length > 0 && (
                <select
                  value={newCondition.logic}
                  onChange={(e) => setNewCondition({ ...newCondition, logic: e.target.value })}
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
                >
                  {logicOps.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              )}

              <select
                value={newCondition.left}
                onChange={(e) => setNewCondition({ ...newCondition, left: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
              >
                <option value="">지표 선택</option>
                {availableColumns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>

              <select
                value={newCondition.operator}
                onChange={(e) => setNewCondition({ ...newCondition, operator: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
              >
                <option value="">연산자</option>
                {operators.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>

              <input
                type="text"
                placeholder="값 입력"
                value={newCondition.right}
                onChange={(e) => setNewCondition({ ...newCondition, right: e.target.value })}
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white w-20"
              />

              <button
                onClick={addCondition}
                className="bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1 rounded-md"
              >
                추가
              </button>
            </div>

            <div className="mt-3 bg-gray-800 border border-gray-700 rounded-md p-2 text-gray-200 text-sm">
              <strong>미리보기:</strong> {strategySql || "조건을 추가해주세요."}
            </div>
          </div>

          {/* Risk/StopLoss/Date */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="text-sm text-gray-400">Risk Reward Ratio</label>
              <input
                type="number"
                step="0.1"
                value={riskReward}
                onChange={(e) => setRiskReward(parseFloat(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-gray-400">Stop Loss 기준</label>
              <select
                value={stopLossType}
                onChange={(e) => setStopLossType(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              >
                <option value="low">진입 캔들의 Low</option>
                <option value="custom">사용자 지정</option>
              </select>

              {stopLossType === "custom" && (
                <input
                  type="number"
                  step="0.1"
                  placeholder="손절가 입력"
                  value={stopLossValue ?? ""}
                  onChange={(e) => setStopLossValue(parseFloat(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-2 text-white"
                />
              )}
            </div>

            {/* StartTime */}
            <div>
              <label className="text-sm text-gray-400">Start Time</label>
              <input
                type="date"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                min={timeRange?.min}
                max={timeRange?.max}
                disabled={!isStartTimeActive}
                className={`w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white ${
                  !isStartTimeActive ? "opacity-50 cursor-not-allowed" : ""
                }`}
              />
            </div>

            {/* EndTime */}
            <div>
              <label className="text-sm text-gray-400">End Time</label>
              <input
                type="date"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                min={startTime || timeRange?.min}
                max={timeRange?.max}
                disabled={!isEndTimeActive}
                className={`w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white ${
                  !isEndTimeActive ? "opacity-50 cursor-not-allowed" : ""
                }`}
              />
            </div>
          </div>

          <button
            onClick={handleRunBacktest}
            disabled={loading}
            className="w-full bg-cyan-500 hover:bg-cyan-600 mt-6 py-3 rounded-lg font-semibold text-gray-900 transition"
          >
            {loading ? " 실행 중..." : " Run Backtest"}
          </button>
          <p className="mt-3 text-center text-gray-300">{message}</p>
        </div>

        {/* 오른쪽: 결과 테이블 */}
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-700 flex-1 overflow-auto max-h-[80vh]">
          <h2 className="text-xl font-semibold mb-4 text-cyan-400">Results</h2>
          {results.length === 0 ? (
            <p className="text-gray-400 text-center py-6">결과가 없습니다.</p>
          ) : (
            <table className="w-full text-sm text-gray-200 border border-gray-700">
              <thead className="bg-gray-800 text-cyan-400">
                <tr>
                  <th className="px-2 py-2 border border-gray-700">Entry Time</th>
                  <th className="px-2 py-2 border border-gray-700">Exit Time</th>
                  <th className="px-2 py-2 border border-gray-700">Result</th>
                  <th className="px-2 py-2 border border-gray-700">Profit (%)</th>
                  <th className="px-2 py-2 border border-gray-700">Cumulative (%)</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, idx) => (
                  <tr key={idx} className="border-t border-gray-700 hover:bg-gray-800">
                    <td className="px-2 py-2 text-center">{r.entry_time}</td>
                    <td className="px-2 py-2 text-center">{r.exit_time || "-"}</td>
                    <td
                      className={`px-2 py-2 text-center font-semibold ${
                        r.result === "TP"
                          ? "text-green-400"
                          : r.result === "SL"
                          ? "text-red-400"
                          : "text-gray-300"
                      }`}
                    >
                      {r.result}
                    </td>
                    <td className="px-2 py-2 text-center">{r.profit_rate.toFixed(2)}%</td>
                    <td className="px-2 py-2 text-center">{r.cum_profit_rate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default BacktestingPage;
