
import React, { useState, useEffect } from 'react';
import { placeOrder, getLeverageBrackets, LeverageBracket } from "./api/paper_trading";
import { useAuthCheck } from "./components/is_logined";

// Mock Data
const ORDERBOOK_BIDS = Array.from({ length: 15 }, (_, i) => ({
  price: (87859.7 - i * 0.1).toFixed(1),
  amount: (Math.random() * 2).toFixed(3),
  total: (Math.random() * 10).toFixed(3),
}));

const ORDERBOOK_ASKS = Array.from({ length: 15 }, (_, i) => ({
  price: (87859.8 + (14 - i) * 0.1).toFixed(1),
  amount: (Math.random() * 2).toFixed(3),
  total: (Math.random() * 10).toFixed(3),
})).reverse();

const RECENT_TRADES = Array.from({ length: 15 }, (_, i) => ({
  price: (87859.7 + (Math.random() - 0.5)).toFixed(1),
  amount: (Math.random() * 0.5).toFixed(4),
  time: new Date(Date.now() - i * 1000).toLocaleTimeString('en-US', { hour12: false }),
  side: Math.random() > 0.5 ? 'BUY' : 'SELL',
}));

const POSITIONS = [
  {
    symbol: 'BTCUSDT',
    side: 'LONG',
    size: '0.002',
    entryPrice: '86,500.0',
    markPrice: '87,859.7',
    pnl: '+27.19',
    roe: '+15.23%',
    margin: '175.70',
  },
];

export default function TradingMockup() {
  const { isChecking, isValid, userData } = useAuthCheck();
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState('87859.7');
  const [amount, setAmount] = useState('');
  const [leverage, setLeverage] = useState(20);
  const [brackets, setBrackets] = useState<LeverageBracket[]>([]);
  const [maxLeverage, setMaxLeverage] = useState(125);
  const [maxPosition, setMaxPosition] = useState<number | null>(null);

  // Modal State
  const [isLeverageModalOpen, setIsLeverageModalOpen] = useState(false);
  const [tempLeverage, setTempLeverage] = useState(20);

  // Fetch Leverage Brackets
  useEffect(() => {
    getLeverageBrackets("BTCUSDT").then(data => {
      if (data && data.length > 0) {
        setBrackets(data);
        // 초기 최대 레버리지 설정 (첫 번째 브래킷이 가장 높은 레버리지)
        setMaxLeverage(data[0].initial_leverage);
      }
    }).catch(console.error);
  }, []);

  // Update Max Position based on Leverage (for Modal display)
  const getMaxPositionForLeverage = (lev: number) => {
    if (brackets.length > 0) {
      const bracket = brackets.find(b => lev <= b.initial_leverage);
      return bracket ? bracket.max_notional : null;
    }
    return null;
  };

  // Update Max Position for main state
  useEffect(() => {
    const maxPos = getMaxPositionForLeverage(leverage);
    setMaxPosition(maxPos);
  }, [leverage, brackets]);

  const openLeverageModal = () => {
    setTempLeverage(leverage);
    setIsLeverageModalOpen(true);
  };

  const confirmLeverage = () => {
    setLeverage(tempLeverage);
    setIsLeverageModalOpen(false);
  };

  // TradingView Widget
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if ((window as any).TradingView) {
        new (window as any).TradingView.widget({
          "width": "100%",
          "height": "100%",
          "symbol": "BINANCE:BTCUSDT.P",
          "interval": "15",
          "timezone": "Etc/UTC",
          "theme": "dark",
          "style": "1",
          "locale": "en",
          "enable_publishing": false,
          "hide_side_toolbar": false,
          "allow_symbol_change": false,
          "container_id": "tradingview_chart"
        });
      }
    };
    document.head.appendChild(script);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    window.location.href = "/";
  };

  const handleOrderSubmit = async (side: "BUY" | "SELL") => {
    try {
      const quantity = parseFloat(amount);
      const orderPrice = orderType === "LIMIT" ? parseFloat(price) : undefined;

      if (isNaN(quantity) || quantity <= 0) {
        alert("Please enter a valid quantity.");
        return;
      }

      if (orderType === "LIMIT" && (orderPrice === undefined || isNaN(orderPrice) || orderPrice <= 0)) {
        alert("Please enter a valid price for Limit order.");
        return;
      }

      if (!userData?.google_id) {
        alert("Please log in to place an order.");
        return;
      }

      await placeOrder({
        symbol: "BTCUSDT", // Mock symbol
        side,
        type: orderType,
        quantity,
        price: orderPrice,
        leverage: leverage,
        google_id: userData.google_id,
      });

      alert(`${side} Order Placed Successfully!`);
    } catch (err: any) {
      console.error(err);
      alert(`Order Failed: ${err.response?.data?.detail || err.message}`);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#161a1e] text-[#eaecef] font-sans overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#2b3139] bg-[#181a20] px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">BTCUSDT</span>
            <span className="rounded bg-[#2b3139] px-1 text-xs text-gray-400">Perp</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-[#0ecb81] text-lg font-bold">87,859.7</span>
            <div className="flex flex-col">
              <span className="text-gray-400">Mark</span>
              <span>87,859.8</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400">Index</span>
              <span>87,892.4</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400">Funding / Countdown</span>
              <span className="text-[#f6465d]">0.0001% / 01:05:36</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400">24h High</span>
              <span>89,177.3</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400">24h Low</span>
              <span>85,226.4</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-400">24h Vol(BTC)</span>
              <span>184,094.053</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
           {userData ? (
             <div className="flex items-center gap-4">
               <span className="text-gray-200 font-medium">{userData.name} ({userData.email})</span>
               <button 
                 onClick={handleLogout}
                 className="hover:text-white text-xs border border-gray-600 rounded px-2 py-1"
               >
                 Logout
               </button>
             </div>
           ) : (
             <div className="flex items-center gap-4">
               <button className="hover:text-white">Log In</button>
               <button className="rounded bg-[#fcd535] px-4 py-1 text-black font-bold hover:bg-[#ffe258]">Register</button>
             </div>
           )}
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* LEFT COLUMN: Chart & Positions (Flexible Width) */}
        <div className="flex flex-1 flex-col border-r border-[#2b3139] min-w-0">
          {/* Chart Area */}
          <div className="flex-1 bg-[#161a1e] relative">
             <div id="tradingview_chart" className="w-full h-full" />
          </div>

          {/* Bottom Panel: Positions */}
          <div className="h-64 border-t border-[#2b3139] bg-[#161a1e]">
            <div className="flex h-10 items-center px-4 gap-6 border-b border-[#2b3139]">
              <button className="h-full border-b-2 border-[#fcd535] text-sm font-bold text-white">Positions (1)</button>
              <button className="h-full border-b-2 border-transparent text-sm font-medium text-gray-400 hover:text-white">Open Orders (0)</button>
              <button className="h-full border-b-2 border-transparent text-sm font-medium text-gray-400 hover:text-white">Order History</button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-left text-xs text-gray-300">
                <thead className="bg-[#1e2329] text-gray-400">
                  <tr>
                    <th className="px-4 py-2 font-normal">Symbol</th>
                    <th className="px-4 py-2 font-normal">Size</th>
                    <th className="px-4 py-2 font-normal">Entry Price</th>
                    <th className="px-4 py-2 font-normal">Mark Price</th>
                    <th className="px-4 py-2 font-normal">Margin</th>
                    <th className="px-4 py-2 font-normal">PNL (ROE%)</th>
                    <th className="px-4 py-2 font-normal text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {POSITIONS.map((pos, i) => (
                    <tr key={i} className="border-b border-[#2b3139] hover:bg-[#2b3139]">
                      <td className="px-4 py-2 font-bold">
                        <div className="flex items-center gap-1">
                            <div className={`w-1 h-4 rounded-sm ${pos.side === 'LONG' ? 'bg-[#0ecb81]' : 'bg-[#f6465d]'}`}></div>
                            <span>{pos.symbol}</span>
                            <span className="bg-[#2b3139] px-1 rounded text-[10px] text-gray-400">Isolated 20x</span>
                        </div>
                      </td>
                      <td className={`px-4 py-2 ${pos.side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{pos.size}</td>
                      <td className="px-4 py-2">{pos.entryPrice}</td>
                      <td className="px-4 py-2">{pos.markPrice}</td>
                      <td className="px-4 py-2">{pos.margin}</td>
                      <td className="px-4 py-2">
                        <span className="text-[#0ecb81]">{pos.pnl} ({pos.roe})</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button className="text-gray-400 hover:text-[#fcd535]">Market</button>
                        <button className="ml-2 text-gray-400 hover:text-[#fcd535]">Limit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: Orderbook & Trades (Fixed Width) */}
        <div className="flex w-[320px] flex-col border-r border-[#2b3139] bg-[#161a1e]">
            {/* Orderbook Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b3139]">
                <span className="text-sm font-bold text-white">Order Book</span>
                <span className="text-xs text-gray-400">0.1</span>
            </div>
            
            {/* Orderbook Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                 {/* Header */}
                 <div className="flex px-3 py-1 text-[10px] text-gray-400 mb-1">
                    <span className="w-1/3">Price(USDT)</span>
                    <span className="w-1/3 text-right">Size(BTC)</span>
                    <span className="w-1/3 text-right">Sum(BTC)</span>
                 </div>

                 {/* Asks */}
                 <div className="flex-1 overflow-hidden flex flex-col justify-end pb-1">
                    {ORDERBOOK_ASKS.map((ask, i) => (
                        <div key={i} className="flex px-3 py-[1px] text-xs hover:bg-[#2b3139] cursor-pointer relative">
                            <div className="absolute right-0 top-0 bottom-0 bg-[#f6465d] opacity-10" style={{width: `${Math.random() * 100}%`}}></div>
                            <span className="w-1/3 text-[#f6465d] z-10">{ask.price}</span>
                            <span className="w-1/3 text-right text-gray-300 z-10">{ask.amount}</span>
                            <span className="w-1/3 text-right text-gray-400 z-10">{ask.total}</span>
                        </div>
                    ))}
                 </div>

                 {/* Current Price */}
                 <div className="flex items-center justify-center py-2 border-y border-[#2b3139] bg-[#161a1e]">
                    <span className="text-lg font-bold text-[#f6465d] mr-2">87,859.7</span>
                    <span className="text-xs text-gray-400">≈ 87,859.7 USD</span>
                 </div>

                 {/* Bids */}
                 <div className="flex-1 overflow-hidden pt-1">
                    {ORDERBOOK_BIDS.map((bid, i) => (
                        <div key={i} className="flex px-3 py-[1px] text-xs hover:bg-[#2b3139] cursor-pointer relative">
                            <div className="absolute right-0 top-0 bottom-0 bg-[#0ecb81] opacity-10" style={{width: `${Math.random() * 100}%`}}></div>
                            <span className="w-1/3 text-[#0ecb81] z-10">{bid.price}</span>
                            <span className="w-1/3 text-right text-gray-300 z-10">{bid.amount}</span>
                            <span className="w-1/3 text-right text-gray-400 z-10">{bid.total}</span>
                        </div>
                    ))}
                 </div>
            </div>

            {/* Recent Trades (Bottom Half of Middle Column) */}
            <div className="h-1/3 border-t border-[#2b3139] flex flex-col">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b3139]">
                    <span className="text-sm font-bold text-white">Trades</span>
                </div>
                <div className="flex px-3 py-1 text-[10px] text-gray-400">
                    <span className="w-1/3">Price(USDT)</span>
                    <span className="w-1/3 text-right">Amount(BTC)</span>
                    <span className="w-1/3 text-right">Time</span>
                </div>
                <div className="flex-1 overflow-auto">
                    {RECENT_TRADES.map((trade, i) => (
                        <div key={i} className="flex px-3 py-[1px] text-xs hover:bg-[#2b3139]">
                            <span className={`w-1/3 ${trade.side === 'BUY' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{trade.price}</span>
                            <span className="w-1/3 text-right text-gray-300">{trade.amount}</span>
                            <span className="w-1/3 text-right text-gray-400">{trade.time}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: Order Entry (Fixed Width) */}
        <div className="w-[320px] bg-[#1e2329] flex flex-col border-l border-[#2b3139]">


            {/* Order Type Tabs */}
            <div className="flex px-3 gap-4 text-sm font-bold text-gray-400 mb-4">
                <button className={orderType === 'LIMIT' ? 'text-[#fcd535]' : 'hover:text-white'} onClick={() => setOrderType('LIMIT')}>Limit</button>
                <button className={orderType === 'MARKET' ? 'text-[#fcd535]' : 'hover:text-white'} onClick={() => setOrderType('MARKET')}>Market</button>
                <button className="hover:text-white">Stop Limit</button>
            </div>

            {/* Margin Mode & Leverage */}
            <div className="flex gap-2 mb-4">
               <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Margin Mode</label>
                  <select disabled className="w-full bg-[#2b3139] text-gray-400 text-sm rounded px-2 py-1 border border-gray-600 cursor-not-allowed">
                     <option>Isolated</option>
                  </select>
               </div>
               <div className="flex-1">
                  <label className="text-xs text-gray-500 mb-1 block">Leverage</label>
                  <button 
                    onClick={openLeverageModal}
                    className="w-full bg-[#2b3139] hover:bg-[#3a404a] text-sm rounded px-2 py-1 border border-gray-600 font-bold text-white"
                  >
                    {leverage}x
                  </button>
               </div>
            </div>
            {/* Order Form */}
            <div className="px-3 flex-1">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Avail</span>
                    <span className="text-white">0.00 USDT</span>
                </div>

                {orderType === 'LIMIT' && (
                    <div className="bg-[#2b3139] rounded flex items-center px-2 py-2 mb-3">
                        <span className="text-gray-400 text-sm w-12">Price</span>
                        <input 
                            type="text" 
                            value={price} 
                            onChange={(e) => setPrice(e.target.value)}
                            className="bg-transparent text-right text-white text-sm flex-1 outline-none" 
                        />
                        <span className="text-gray-400 text-xs ml-2">USDT</span>
                    </div>
                )}

                <div className="bg-[#2b3139] rounded flex items-center px-2 py-2 mb-4">
                    <span className="text-gray-400 text-sm w-12">Size</span>
                    <input 
                        type="text" 
                        value={amount} 
                        onChange={(e) => setAmount(e.target.value)}
                        className="bg-transparent text-right text-white text-sm flex-1 outline-none" 
                    />
                    <span className="text-gray-400 text-xs ml-2">USDT</span>
                </div>

                {/* Slider */}
                <div className="mb-6 px-1">
                    <input type="range" className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer" />
                    <div className="flex justify-between mt-1">
                        <span className="w-1 h-1 bg-gray-500 rounded-full"></span>
                        <span className="w-1 h-1 bg-gray-500 rounded-full"></span>
                        <span className="w-1 h-1 bg-gray-500 rounded-full"></span>
                        <span className="w-1 h-1 bg-gray-500 rounded-full"></span>
                        <span className="w-1 h-1 bg-gray-500 rounded-full"></span>
                    </div>
                </div>

                {/* Checkboxes */}
                <div className="flex gap-4 mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="rounded bg-[#2b3139] border-gray-600" />
                        <span className="text-xs text-gray-400">TP/SL</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" className="rounded bg-[#2b3139] border-gray-600" />
                        <span className="text-xs text-gray-400">Reduce-Only</span>
                    </label>
                </div>

                {/* Buy / Sell Buttons */}
            <div className="flex gap-2 mt-4">
              <button 
                onClick={() => handleOrderSubmit("BUY")}
                className="flex-1 bg-[#0ecb81] hover:bg-[#0ecb81]/90 text-white py-3 rounded font-bold text-sm transition-colors"
              >
                Buy / Long
              </button>
              <button 
                onClick={() => handleOrderSubmit("SELL")}
                className="flex-1 bg-[#f6465d] hover:bg-[#f6465d]/90 text-white py-3 rounded font-bold text-sm transition-colors"
              >
                Sell / Short
              </button>
            </div>

                {/* Order Cost Info */}
                <div className="mt-4 space-y-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Liq Price</span>
                        <span className="text-white">-- USDT</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Cost</span>
                        <span className="text-white">0.00 USDT</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-400">Max</span>
                        <span className="text-white">0.00 USDT</span>
                    </div>
                </div>
            </div>
            
            {/* Footer */}
            <div className="p-3 border-t border-[#2b3139] text-xs text-gray-400">
                <div className="flex justify-between">
                    <span>% Fee level</span>
                </div>
            </div>
        </div>
      </div>

      {/* Adjust Leverage Modal */}
      {isLeverageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[400px] rounded-lg bg-[#1e2329] p-6 shadow-xl border border-[#2b3139]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Adjust Leverage</h2>
              <button onClick={() => setIsLeverageModalOpen(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="mb-8">
              <div className="flex justify-between items-center mb-4 bg-[#2b3139] rounded p-3">
                 <button 
                   onClick={() => setTempLeverage(Math.max(1, tempLeverage - 1))}
                   className="text-gray-400 hover:text-white text-xl font-bold px-2"
                 >−</button>
                 <span className="text-2xl font-bold text-white">{tempLeverage}x</span>
                 <button 
                   onClick={() => setTempLeverage(Math.min(maxLeverage, tempLeverage + 1))}
                   className="text-gray-400 hover:text-white text-xl font-bold px-2"
                 >+</button>
              </div>

              <input 
                type="range" 
                min="1" 
                max={maxLeverage} 
                value={tempLeverage} 
                onChange={(e) => setTempLeverage(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-[#fcd535]"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>1x</span>
                <span>{maxLeverage}x</span>
              </div>
            </div>

            <div className="mb-6 text-xs text-gray-400">
              <p className="mb-2">
                Maximum position at current leverage: <span className="text-white font-bold">{getMaxPositionForLeverage(tempLeverage)?.toLocaleString()} USDT</span>
              </p>
              <p>
                Please note that leverage changing will also apply for open positions and open orders.
              </p>
            </div>

            <button 
              onClick={confirmLeverage}
              className="w-full rounded bg-[#fcd535] py-3 text-sm font-bold text-black hover:bg-[#ffe258]"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
