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
  
  // Time component states
  const [startDate, setStartDate] = useState("");
  const [startHour, setStartHour] = useState("00");
  const [startMinute, setStartMinute] = useState("00");
  const [endDate, setEndDate] = useState("");
  const [endHour, setEndHour] = useState("00");
  const [endMinute, setEndMinute] = useState("00");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [intervals, setIntervals] = useState<string[]>([]);
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [stopLossType, setStopLossType] = useState("low");
  const [stopLossValue, setStopLossValue] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<{ min: Date; max: Date } | null>(null);
  
  // New State Variables
  const [positionSide, setPositionSide] = useState("LONG");
  const [leverage, setLeverage] = useState(1.0);
  const [slippageRate, setSlippageRate] = useState(0.0);

  const [slOptions, setSlOptions] = useState<{ long: { value: string; label: string }[]; short: { value: string; label: string }[] }>({
    long: [],
    short: [],
  });

  const availableColumns = [
    "open", "high", "low", "close", "volume",
    "rsi_14", "ema_7", "ema_21", "ema_99",
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

  // Helper functions for time validation based on timeframe
  const getValidMinutes = (interval: string): number[] => {
    if (!interval) return Array.from({ length: 60 }, (_, i) => i);
    
    const minuteValue = interval.match(/(\d+)m/);
    if (!minuteValue) return [0]; // For hourly timeframes, only 0 is valid
    
    const step = parseInt(minuteValue[1]);
    const validMinutes: number[] = [];
    for (let i = 0; i < 60; i += step) {
      validMinutes.push(i);
    }
    return validMinutes;
  };

  const getValidHours = (interval: string): number[] => {
    if (!interval) return Array.from({ length: 24 }, (_, i) => i);
    
    const hourValue = interval.match(/(\d+)h/);
    if (!hourValue) return Array.from({ length: 24 }, (_, i) => i); // For minute timeframes, all hours valid
    
    const step = parseInt(hourValue[1]);
    const validHours: number[] = [];
    for (let i = 0; i < 24; i += step) {
      validHours.push(i);
    }
    return validHours;
  };

  const isMinuteBasedTimeframe = (interval: string): boolean => {
    return /\d+m/.test(interval);
  };

  const isHourBasedTimeframe = (interval: string): boolean => {
    return /\d+h/.test(interval);
  };

  const isWeeklyTimeframe = (interval: string): boolean => {
    return interval === '1w';
  };

  const isMonthlyTimeframe = (interval: string): boolean => {
    return interval === '1M';
  };

  const isDailyTimeframe = (interval: string): boolean => {
    return interval === '1d';
  };

  // Check if a date string (YYYY-MM-DD) is a Monday
  const isMonday = (dateString: string): boolean => {
    const date = new Date(dateString + 'T00:00:00'); // Parse as local midnight
    return date.getDay() === 1; // Monday = 1
  };

  // Get the Monday on or immediately before a given date
  // Examples:
  // - Monday 2024-01-01 -> 2024-01-01 (same day)
  // - Tuesday 2024-01-02 -> 2024-01-01 (1 day back)
  // - Sunday 2024-01-07 -> 2024-01-01 (6 days back)
  const getNearestMonday = (dateString: string): string => {
    const date = new Date(dateString + 'T00:00:00');
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    if (dayOfWeek === 1) {
      // Already Monday, return as-is
      return dateString;
    }
    
    // Calculate days to go back to reach the previous Monday
    // Sunday (0) -> 6 days back
    // Tuesday (2) -> 1 day back
    // Wednesday (3) -> 2 days back
    // Thursday (4) -> 3 days back
    // Friday (5) -> 4 days back
    // Saturday (6) -> 5 days back
    const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    const monday = new Date(date);
    monday.setDate(date.getDate() - daysToSubtract);
    
    // Format as YYYY-MM-DD using local timezone (not UTC)
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, '0');
    const day = String(monday.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  };

  // Get filtered hours based on selected date and time range
  const getFilteredHours = (interval: string, date: string, isStart: boolean): number[] => {
    const allValidHours = getValidHours(interval);
    if (!timeRange || !date) return allValidHours;

    // Compare dates directly as strings (YYYY-MM-DD format)
    const minDate = timeRange.min.toISOString().split('T')[0];
    const maxDate = timeRange.max.toISOString().split('T')[0];

    if (isStart && date === minDate) {
      // For start time on min date, filter hours >= min hour (using UTC hours)
      const minHour = timeRange.min.getUTCHours();
      return allValidHours.filter(h => h >= minHour);
    } else if (!isStart) {
      // For end time, consider both start time and max time
      let filteredHours = allValidHours;
      
      // If end date equals start date, hours must be >= start hour
      if (startDate && date === startDate && startHour) {
        const startHourNum = parseInt(startHour);
        filteredHours = filteredHours.filter(h => h >= startHourNum);
      }
      
      // If end date equals max date, hours must be <= max hour
      if (date === maxDate) {
        const maxHour = timeRange.max.getUTCHours();
        filteredHours = filteredHours.filter(h => h <= maxHour);
      }
      
      return filteredHours;
    }
    
    return allValidHours;
  };

  // Get filtered minutes based on selected date, hour, and time range
  const getFilteredMinutes = (interval: string, date: string, hour: string, isStart: boolean): number[] => {
    const allValidMinutes = getValidMinutes(interval);
    if (!timeRange || !date || !hour) return allValidMinutes;

    // Compare dates directly as strings (YYYY-MM-DD format)
    const selectedHour = parseInt(hour);
    const minDate = timeRange.min.toISOString().split('T')[0];
    const maxDate = timeRange.max.toISOString().split('T')[0];
    const minHour = timeRange.min.getUTCHours();
    const maxHour = timeRange.max.getUTCHours();
    const minMinute = timeRange.min.getUTCMinutes();
    const maxMinute = timeRange.max.getUTCMinutes();

    if (isStart && date === minDate && selectedHour === minHour) {
      // For start time on min date and min hour, filter minutes >= min minute
      return allValidMinutes.filter(m => m >= minMinute);
    } else if (!isStart) {
      // For end time, consider both start time and max time
      let filteredMinutes = allValidMinutes;
      
      // If end date/hour equals start date/hour, minutes must be >= start minute
      if (startDate && date === startDate && startHour && selectedHour === parseInt(startHour) && startMinute) {
        const startMinuteNum = parseInt(startMinute);
        filteredMinutes = filteredMinutes.filter(m => m >= startMinuteNum);
      }
      
      // If end date/hour equals max date/hour, minutes must be <= max minute
      if (date === maxDate && selectedHour === maxHour) {
        filteredMinutes = filteredMinutes.filter(m => m <= maxMinute);
      }
      
      return filteredMinutes;
    }
    
    return allValidMinutes;
  };

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
        const [symbolsRes, intervalsRes, slRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/symbols`),
          axios.get(`${BACKEND_URL}/intervals`),
          axios.get(`${BACKEND_URL}/sl-options`),
        ]);
        setSymbols(symbolsRes.data?.symbols || symbolsRes.data || []);
        setIntervals(intervalsRes.data || []);
        setSlOptions(slRes.data || { long: [], short: [] });
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
        console.log('⏰ Time range response:', res.data);
        
        const minDateTime = new Date(res.data.min_time);
        const maxDateTime = new Date(res.data.max_time);
        
        console.log('📅 Parsed datetime range:', { 
          min: minDateTime.toISOString(), 
          max: maxDateTime.toISOString() 
        });
        
        setTimeRange({ min: minDateTime, max: maxDateTime });
        setStartDate("");
        setStartHour("00");
        setStartMinute("00");
        setEndDate("");
        setEndHour("00");
        setEndMinute("00");
      } catch (e) {
        console.error("⚠️ 시간 범위 조회 실패:", e);
        setTimeRange(null);
      }
    };
    fetchTimeRange();
  }, [symbol, interval]);

  // Auto-adjust start hour if it becomes invalid when date changes
  useEffect(() => {
    if (!startDate || !timeRange) return;
    const validHours = getFilteredHours(interval, startDate, true);
    const currentHour = parseInt(startHour);
    if (!validHours.includes(currentHour)) {
      setStartHour(validHours[0]?.toString().padStart(2, '0') || '00');
    }
  }, [startDate, interval, timeRange]);

  // Auto-adjust start minute if it becomes invalid when date or hour changes
  useEffect(() => {
    if (!startDate || !timeRange) return;
    const validMinutes = getFilteredMinutes(interval, startDate, startHour, true);
    const currentMinute = parseInt(startMinute);
    if (!validMinutes.includes(currentMinute)) {
      setStartMinute(validMinutes[0]?.toString().padStart(2, '0') || '00');
    }
  }, [startDate, startHour, interval, timeRange]);

  // Auto-adjust end hour if it becomes invalid when date changes
  useEffect(() => {
    if (!endDate || !timeRange) return;
    const validHours = getFilteredHours(interval, endDate, false);
    const currentHour = parseInt(endHour);
    if (!validHours.includes(currentHour)) {
      setEndHour(validHours[0]?.toString().padStart(2, '0') || '00');
    }
  }, [endDate, interval, timeRange]);

  // Auto-adjust end minute if it becomes invalid when date or hour changes
  useEffect(() => {
    if (!endDate || !timeRange) return;
    const validMinutes = getFilteredMinutes(interval, endDate, endHour, false);
    const currentMinute = parseInt(endMinute);
    if (!validMinutes.includes(currentMinute)) {
      setEndMinute(validMinutes[0]?.toString().padStart(2, '0') || '00');
    }
  }, [endDate, endHour, interval, timeRange]);

  // Handler for start date change with Monday adjustment for weekly
  const handleStartDateChange = (dateValue: string) => {
    if (isWeeklyTimeframe(interval) && dateValue) {
      // For weekly, always adjust to Monday
      const mondayDate = getNearestMonday(dateValue);
      setStartDate(mondayDate);
    } else {
      setStartDate(dateValue);
    }
  };

  // Handler for end date change with Monday adjustment for weekly
  const handleEndDateChange = (dateValue: string) => {
    if (isWeeklyTimeframe(interval) && dateValue) {
      // For weekly, always adjust to Monday
      const mondayDate = getNearestMonday(dateValue);
      setEndDate(mondayDate);
    } else {
      setEndDate(dateValue);
    }
  };

  // Check if start time is completely entered based on timeframe
  const isStartTimeComplete = (): boolean => {
    if (!startDate) return false;
    
    if (isMonthlyTimeframe(interval)) {
      // For monthly: startDate should be in YYYY-MM format
      return startDate.length >= 7 && startDate.includes('-');
    } else if (isDailyTimeframe(interval) || isWeeklyTimeframe(interval)) {
      // For daily and weekly: startDate should be in YYYY-MM-DD format
      return startDate.length >= 10;
    } else if (isHourBasedTimeframe(interval)) {
      // For hour-based (1h, 4h): need date + hour
      return !!startDate && !!startHour;
    } else if (isMinuteBasedTimeframe(interval)) {
      // For minute-based (1m, 3m, etc.): need date + hour + minute
      return !!startDate && !!startHour && !!startMinute;
    }
    
    return false;
  };

  const isStartTimeActive = !!(symbol && interval && timeRange);
  const isEndTimeActive = isStartTimeComplete();

  // Reset end time when start time changes
  useEffect(() => {
    setEndDate("");
    setEndHour("00");
    setEndMinute("00");
  }, [startDate, startHour, startMinute]);

  // Combine date and time components into full datetime strings
  // For 1M (monthly), append '-01' to make it the 1st of the month
  const formatDateTime = (date: string, hour: string, minute: string): string => {
    if (!date) return "";
    
    if (isMonthlyTimeframe(interval)) {
      // date is in YYYY-MM format for monthly, append -01 and use 00:00:00
      return `${date}-01T00:00:00`;
    }
    
    // For other timeframes, use the date as-is
    return `${date}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
  };

  const startTime = formatDateTime(startDate, startHour, startMinute);
  const endTime = formatDateTime(endDate, endHour, endMinute);

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
        position_side: positionSide,
        leverage: leverage,
        slippage_rate: slippageRate / 100, // Convert % to decimal
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
              <label className="text-sm text-gray-400">종목 선택</label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              >
                <option value="">종목 선택</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Interval */}
            <div>
              <label className="text-sm text-gray-400">Timeframe 선택</label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              >
                <option value="">Timeframe 선택</option>
                {intervals.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Start Time and End Time - Only show after symbol and interval are selected */}
          {symbol && interval && (
            <div className="mt-4 space-y-4">
              {/* Start Time */}
              <div>
                <label className="text-sm text-gray-400 block mb-2">Start Time</label>
                {isMonthlyTimeframe(interval) ? (
                  // Monthly: Show only month picker (YYYY-MM)
                  <input
                    type="month"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={timeRange?.min.toISOString().substring(0, 7)} // YYYY-MM
                    max={timeRange?.max.toISOString().substring(0, 7)}
                    disabled={!isStartTimeActive}
                    className={`w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm ${
                      !isStartTimeActive ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  />
                ) : isDailyTimeframe(interval) || isWeeklyTimeframe(interval) ? (
                  // Daily and Weekly: Show only date picker (full width, no time selectors)
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    min={timeRange?.min.toISOString().split('T')[0]}
                    max={timeRange?.max.toISOString().split('T')[0]}
                    disabled={!isStartTimeActive}
                    className={`w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm ${
                      !isStartTimeActive ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  />
                ) : (
                  // Other timeframes: Show date + hour + minute
                  <div className="grid grid-cols-3 gap-2">
                    {/* Start Date */}
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => handleStartDateChange(e.target.value)}
                      min={timeRange?.min.toISOString().split('T')[0]}
                      max={timeRange?.max.toISOString().split('T')[0]}
                      disabled={!isStartTimeActive}
                      className={`bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm ${
                        !isStartTimeActive ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    />
                    
                    {/* Start Hour */}
                    <select
                      value={startHour}
                      onChange={(e) => setStartHour(e.target.value)}
                      disabled={!startDate}
                      className={`bg-gray-800 border border-gray-700 rounded-md px-2 py-2 text-white text-sm ${
                        !startDate ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      {getFilteredHours(interval, startDate, true).map((h) => (
                        <option key={h} value={h.toString().padStart(2, '0')}>
                          {h.toString().padStart(2, '0')}시
                        </option>
                      ))}
                    </select>
                    
                    {/* Start Minute - Only show for minute-based timeframes */}
                    {isMinuteBasedTimeframe(interval) ? (
                      <select
                        value={startMinute}
                        onChange={(e) => setStartMinute(e.target.value)}
                        disabled={!startDate}
                        className={`bg-gray-800 border border-gray-700 rounded-md px-2 py-2 text-white text-sm ${
                          !startDate ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        {getFilteredMinutes(interval, startDate, startHour, true).map((m) => (
                          <option key={m} value={m.toString().padStart(2, '0')}>
                            {m.toString().padStart(2, '0')}분
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-gray-500 text-sm flex items-center justify-center">
                        00분
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* End Time */}
              <div>
                <label className="text-sm text-gray-400 block mb-2">End Time</label>
                {isMonthlyTimeframe(interval) ? (
                  // Monthly: Show only month picker (YYYY-MM)
                  <input
                    type="month"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || timeRange?.min.toISOString().substring(0, 7)}
                    max={timeRange?.max.toISOString().substring(0, 7)}
                    disabled={!isEndTimeActive}
                    className={`w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm ${
                      !isEndTimeActive ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  />
                ) : isDailyTimeframe(interval) || isWeeklyTimeframe(interval) ? (
                  // Daily and Weekly: Show only date picker (full width, no time selectors)
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    min={startDate || timeRange?.min.toISOString().split('T')[0]}
                    max={timeRange?.max.toISOString().split('T')[0]}
                    disabled={!isEndTimeActive}
                    className={`w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm ${
                      !isEndTimeActive ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  />
                ) : (
                  // Other timeframes: Show date + hour + minute
                  <div className="grid grid-cols-3 gap-2">
                    {/* End Date */}
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => handleEndDateChange(e.target.value)}
                      min={startDate || timeRange?.min.toISOString().split('T')[0]}
                      max={timeRange?.max.toISOString().split('T')[0]}
                      disabled={!isEndTimeActive}
                      className={`bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm ${
                        !isEndTimeActive ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    />
                    
                    {/* End Hour */}
                    <select
                      value={endHour}
                      onChange={(e) => setEndHour(e.target.value)}
                      disabled={!endDate}
                      className={`bg-gray-800 border border-gray-700 rounded-md px-2 py-2 text-white text-sm ${
                        !endDate ? "opacity-50 cursor-not-allowed" : ""
                      }`}
                    >
                      {getFilteredHours(interval, endDate, false).map((h) => (
                        <option key={h} value={h.toString().padStart(2, '0')}>
                          {h.toString().padStart(2, '0')}시
                        </option>
                      ))}
                    </select>
                    
                    {/* End Minute - Only show for minute-based timeframes */}
                    {isMinuteBasedTimeframe(interval) ? (
                      <select
                        value={endMinute}
                        onChange={(e) => setEndMinute(e.target.value)}
                        disabled={!endDate}
                        className={`bg-gray-800 border border-gray-700 rounded-md px-2 py-2 text-white text-sm ${
                          !endDate ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        {getFilteredMinutes(interval, endDate, endHour, false).map((m) => (
                          <option key={m} value={m.toString().padStart(2, '0')}>
                            {m.toString().padStart(2, '0')}분
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-gray-500 text-sm flex items-center justify-center">
                        00분
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

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
                <option value="custom">사용자 지정</option>
                {slOptions[positionSide.toLowerCase() as "long" | "short"]?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
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

            {/* Position Side */}
            <div>
              <label className="text-sm text-gray-400">Position Side</label>
              <select
                value={positionSide}
                onChange={(e) => setPositionSide(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              >
                <option value="LONG">Long</option>
                <option value="SHORT">Short</option>
              </select>
            </div>

            {/* Leverage */}
            <div>
              <label className="text-sm text-gray-400">Leverage (x)</label>
              <input
                type="number"
                step="0.1"
                min="1"
                value={leverage}
                onChange={(e) => setLeverage(parseFloat(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
              />
            </div>

            {/* Slippage */}
            <div>
              <label className="text-sm text-gray-400">Slippage (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={slippageRate}
                onChange={(e) => setSlippageRate(parseFloat(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 mt-1 text-white"
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
