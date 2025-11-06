import React, { useState, useEffect } from "react";
import axios from "axios";

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
  // 입력 상태
  const [symbol, setSymbol] = useState("");
  const [interval, setInterval] = useState("");
  const [riskReward, setRiskReward] = useState(2.0);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  // 드롭다운 데이터
  const [symbols, setSymbols] = useState<string[]>([]);
  const [intervals, setIntervals] = useState<string[]>([]);

  // 전략 빌더 상태
  const availableColumns = [
    "open",
    "high",
    "low",
    "close",
    "volume",
    "ema_9",
    "ema_21",
    "rsi_14",
    "macd",
    "bb_upper",
    "bb_lower",
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
    rightType: "value", // "value" or "indicator"
    right: "",
  });

  // SQL 미리보기
  const strategySql = conditions
    .map((c, idx) => {
      const cond = `${c.left} ${c.operator} ${c.right}`;
      if (idx === 0) return cond;
      return `${c.logic} ${cond}`;
    })
    .join(" ");

  // 결과 상태
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // --- JWT 토큰 ---
  const token = localStorage.getItem("jwt_token");

  // axios 기본 설정 (Authorization 헤더 추가)
  const axiosAuth = axios.create({
    baseURL: BACKEND_URL,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // --- 드롭다운 데이터 불러오기 ---
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [symbolsRes, intervalsRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/symbols`),
          axios.get(`${BACKEND_URL}/intervals`),
        ]);
        // symbols가 { symbols: [...] } 형태로 들어올 수도 있으므로
        const symbolData =
          Array.isArray(symbolsRes.data) && symbolsRes.data.length
            ? symbolsRes.data
            : symbolsRes.data.symbols || [];
        setSymbols(symbolData);
        setIntervals(intervalsRes.data || []);
      } catch (error) {
        console.error("⚠️ 옵션 불러오기 오류:", error);
      }
    };
    fetchOptions();
  }, []);

  // --- 조건 추가 ---
  const addCondition = () => {
    if (!newCondition.left || !newCondition.operator || !newCondition.right) {
      alert("⚠️ 모든 조건을 입력해주세요.");
      return;
    }

    const newCond = { ...newCondition };
    setConditions([...conditions, newCond]);
    setNewCondition({
      logic: "AND",
      left: "",
      operator: "",
      rightType: "value",
      right: "",
    });
  };

  // --- 조건 삭제 ---
  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  // --- JWT 만료 시 처리 ---
  const handleAuthError = (error: any) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      alert("세션이 만료되었습니다. 다시 로그인해주세요.");
      localStorage.removeItem("jwt_token");
      window.location.href = "/login"; // 로그인 페이지로 리디렉션
    } else {
      console.error("❌ 백테스트 실행 오류:", error);
      setMessage("❌ 백테스트 실행 중 오류가 발생했습니다.");
    }
  };

  // --- 전략 실행 요청 ---
  const handleRunBacktest = async () => {
    if (!symbol || !interval || !strategySql || !startTime || !endTime) {
      setMessage("⚠️ 모든 필드를 입력해주세요.");
      return;
    }

    if (!token) {
      alert("⚠️ 로그인 후 이용 가능합니다.");
      return;
    }

    setLoading(true);
    setMessage("전략 실행 중... 잠시만 기다려주세요.");

    try {
      const response = await axiosAuth.post(`/save_strategy`, {
        symbol,
        interval,
        strategy_sql: strategySql,
        risk_reward_ratio: riskReward,
        start_time: startTime,
        end_time: endTime,
      });

      setMessage(response.data.message || "✅ 전략 실행 완료");
      await fetchResults();
    } catch (error) {
      handleAuthError(error);
    } finally {
      setLoading(false);
    }
  };

  // --- 결과 데이터 조회 ---
  const fetchResults = async () => {
    try {
      const res = await axiosAuth.get(`/filtered`);
      setResults(res.data || []);
    } catch (error) {
      handleAuthError(error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center py-10">
      <h1 className="text-3xl font-bold text-cyan-400 mb-8 flex items-center gap-2">
        📈 Backtesting Dashboard
      </h1>

      {/* 입력폼 */}
      <div className="bg-gray-900 p-6 rounded-2xl shadow-lg border border-gray-700 w-[90%] md:w-[700px] mb-10">
        <div className="grid grid-cols-2 gap-4">
          {/* === Symbol === */}
          <div>
            <label className="text-sm text-gray-400">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
            >
              <option value="">심볼 선택</option>
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* === Interval === */}
          <div>
            <label className="text-sm text-gray-400">Interval</label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
            >
              <option value="">인터벌 선택</option>
              {intervals.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>

          {/* === 전략 빌더 === */}
          <div className="col-span-2">
            <label className="text-sm text-gray-400">Strategy Builder</label>

            <div className="flex flex-wrap gap-2 mt-2 items-center">
              {/* 논리연산자 (AND/OR) */}
              {conditions.length > 0 && (
                <select
                  value={newCondition.logic}
                  onChange={(e) =>
                    setNewCondition({ ...newCondition, logic: e.target.value })
                  }
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
                >
                  {logicOps.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}

              {/* 좌측 지표 */}
              <select
                value={newCondition.left}
                onChange={(e) =>
                  setNewCondition({ ...newCondition, left: e.target.value })
                }
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
              >
                <option value="">지표 선택</option>
                {availableColumns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>

              {/* 비교 연산자 */}
              <select
                value={newCondition.operator}
                onChange={(e) =>
                  setNewCondition({ ...newCondition, operator: e.target.value })
                }
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
              >
                <option value="">연산자</option>
                {operators.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>

              {/* 우측 타입 선택 */}
              <select
                value={newCondition.rightType}
                onChange={(e) =>
                  setNewCondition({
                    ...newCondition,
                    rightType: e.target.value,
                    right: "",
                  })
                }
                className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
              >
                <option value="value">값 입력</option>
                <option value="indicator">지표 선택</option>
              </select>

              {/* 우측 입력 */}
              {newCondition.rightType === "value" ? (
                <input
                  type="text"
                  placeholder="값 입력"
                  value={newCondition.right}
                  onChange={(e) =>
                    setNewCondition({ ...newCondition, right: e.target.value })
                  }
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white w-24"
                />
              ) : (
                <select
                  value={newCondition.right}
                  onChange={(e) =>
                    setNewCondition({ ...newCondition, right: e.target.value })
                  }
                  className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-white"
                >
                  <option value="">지표 선택</option>
                  {availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              )}

              <button
                onClick={addCondition}
                className="bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1 rounded-md"
              >
                추가
              </button>
            </div>

            {/* 조건 리스트 */}
            <ul className="mt-3 space-y-1 text-gray-300 text-sm">
              {conditions.map((c, idx) => (
                <li
                  key={idx}
                  className="flex justify-between bg-gray-800 px-3 py-1 rounded-md border border-gray-700"
                >
                  <span>
                    {idx > 0 && (
                      <span className="text-cyan-400 mr-1">{c.logic}</span>
                    )}
                    {c.left} {c.operator} {c.right}
                  </span>
                  <button
                    onClick={() => removeCondition(idx)}
                    className="text-red-400 hover:text-red-500 text-xs"
                  >
                    ❌
                  </button>
                </li>
              ))}
            </ul>

            {/* SQL 미리보기 */}
            <div className="mt-3 bg-gray-800 border border-gray-700 rounded-md p-2 text-gray-200 text-sm">
              <strong>미리보기:</strong>{" "}
              {strategySql ? strategySql : "조건을 추가해주세요."}
            </div>
          </div>

          {/* === Risk Reward === */}
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

          {/* === Start / End Time === */}
          <div>
            <label className="text-sm text-gray-400">Start Time</label>
            <input
              type="date"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400">End Time</label>
            <input
              type="date"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
            />
          </div>
        </div>

        {/* 실행 버튼 */}
        <button
          onClick={handleRunBacktest}
          disabled={loading}
          className="w-full bg-cyan-500 hover:bg-cyan-600 mt-6 py-3 rounded-lg font-semibold text-gray-900 transition"
        >
          {loading ? "⏳ 실행 중..." : "🚀 Run Backtest"}
        </button>

        <p className="mt-3 text-center text-gray-300">{message}</p>
      </div>

      {/* 결과 테이블 */}
      <div className="w-[95%] md:w-[900px] bg-gray-900 p-5 rounded-2xl border border-gray-700">
        <h2 className="text-xl font-semibold mb-4 text-cyan-400">📊 Results</h2>
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
                <th className="px-2 py-2 border border-gray-700">
                  Cumulative (%)
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, idx) => (
                <tr
                  key={idx}
                  className="border-t border-gray-700 hover:bg-gray-800"
                >
                  <td className="px-2 py-2 text-center">{r.entry_time}</td>
                  <td className="px-2 py-2 text-center">
                    {r.exit_time || "-"}
                  </td>
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
                  <td className="px-2 py-2 text-center">
                    {r.profit_rate?.toFixed(2)}%
                  </td>
                  <td className="px-2 py-2 text-center">
                    {r.cum_profit_rate?.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default BacktestingPage;
