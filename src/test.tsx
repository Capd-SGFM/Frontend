/// <reference types="react" />

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { placeOrder, getLeverageBrackets, getAccounts, createAccount, getPositions, deleteAccount, getOrders, cancelOrder, type Account, type Position, type LeverageBracket } from "./api/paper_trading";
import { useAuthCheck } from "./components/is_logined";

// Mock Data for Orderbook & Trades (Keep existing mock data for now)
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

const STUDIES: Record<string, any> = {
  "RSI": "RSI@tv-basicstudies",
  "MACD": "MACD@tv-basicstudies",
  "BOLL": "BB@tv-basicstudies",
  "EMA7": { id: "MAExp@tv-basicstudies", inputs: { length: 7 } },
  "EMA21": { id: "MAExp@tv-basicstudies", inputs: { length: 21 } },
  "EMA99": { id: "MAExp@tv-basicstudies", inputs: { length: 99 } },
};

export default function TradingMockup() {
  const { isChecking, isValid, userData } = useAuthCheck();
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [price, setPrice] = useState<string>('0.00');
  const [markPrice, setMarkPrice] = useState<string>('0.00');
  const [amount, setAmount] = useState<string>('');
  const [leverage, setLeverage] = useState(20);
  const [brackets, setBrackets] = useState<LeverageBracket[]>([]);
  const [maxLeverage, setMaxLeverage] = useState(125);
  const [maxPosition, setMaxPosition] = useState<number | null>(null);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeModalData, setCloseModalData] = useState<any>(null);
  const [closePriceInput, setClosePriceInput] = useState("");
  // Multi-Account State
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountBalance, setNewAccountBalance] = useState(100000);

  // Modal State
  const [isLeverageModalOpen, setIsLeverageModalOpen] = useState(false);
  const [tempLeverage, setTempLeverage] = useState(20);

  // Indicator State
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>(Object.keys(STUDIES));

  // Slider State
  const [sliderValue, setSliderValue] = useState(0);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setSliderValue(val);

    if (selectedAccount && price) {
        const balance = selectedAccount.available_balance;
        const cost = balance * (val / 100);
        const notional = cost * leverage;
        // If price is valid, we can calculate. 
        // Actually amount is "Size USDT" (Notional), so we just need Notional.
        // We don't need price to calculate Notional from Balance & Leverage.
        setAmount(notional.toFixed(2));
    }
  };

  const handleIndicatorToggle = (indicator: string) => {
    setSelectedIndicators((prev: string[]) => 
      prev.includes(indicator) 
        ? prev.filter((i: string) => i !== indicator) 
        : [...prev, indicator]
    );
  };

  // Fetch Leverage Brackets
  useEffect(() => {
    getLeverageBrackets("BTCUSDT").then(data => {
      if (data && data.length > 0) {
        setBrackets(data);
        setMaxLeverage(data[0].initial_leverage);
      }
    }).catch(console.error);
  }, []);

  // Fetch Accounts on Login
  useEffect(() => {
    if (userData?.google_id) {
      fetchAccounts();
    }
  }, [userData]);

  const fetchAccounts = async () => {
    if (!userData?.google_id) return;
    try {
      const data = await getAccounts(userData.google_id);
      setAccounts(data);
      if (data.length > 0 && !selectedAccount) {
        // Default to the first account (usually default one) or keep current selection
        setSelectedAccount(data[0]);
      } else if (selectedAccount) {
         // Update selected account data (balance etc)
         const updated = data.find((a: Account) => a.id === selectedAccount.id);
         if (updated) setSelectedAccount(updated);
      }
    } catch (err) {
      console.error("Failed to fetch accounts:", err);
    }
  };

  // Fetch Positions when Account Changes
  useEffect(() => {
    if (selectedAccount) {
      fetchPositions(selectedAccount.id);
    } else {
        setPositions([]);
    }
  }, [selectedAccount]);

  const fetchPositions = async (accountId: number) => {
    try {
      const data = await getPositions(accountId);
      setPositions(data);
    } catch (err) {
      console.error("Failed to fetch positions:", err);
    }
  };

  // WebSocket Connection for Real-time Data (Direct Binance)
  useEffect(() => {
    // Connect directly to Binance Futures WebSocket
    // Streams: Ticker, Depth (20 levels, 100ms update), Aggregated Trades
    const ws = new WebSocket('wss://fstream.binance.com/stream?streams=btcusdt@ticker/btcusdt@depth20@100ms/btcusdt@aggTrade');

    ws.onopen = () => {
      console.log('Connected to Binance WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        const { stream, data } = message;

        if (stream === 'btcusdt@ticker') {
          setMarkPrice(parseFloat(data.c).toFixed(1));
        } else if (stream === 'btcusdt@depth20@100ms') {
          // Update Order Book
          // bids: [[price, qty], ...]
          // We take top 15 for display
          const newBids = data.b.slice(0, 15).map((bid: any) => ({
            price: parseFloat(bid[0]).toFixed(1),
            amount: parseFloat(bid[1]).toFixed(3),
            total: (parseFloat(bid[0]) * parseFloat(bid[1])).toFixed(3)
          }));
          const newAsks = data.a.slice(0, 15).map((ask: any) => ({
            price: parseFloat(ask[0]).toFixed(1),
            amount: parseFloat(ask[1]).toFixed(3),
            total: (parseFloat(ask[0]) * parseFloat(ask[1])).toFixed(3)
          }));
          setOrderBookBids(newBids);
          setOrderBookAsks(newAsks);
        } else if (stream === 'btcusdt@aggTrade') {
          // Update Recent Trades
          const newTrade = {
            price: parseFloat(data.p).toFixed(1),
            amount: parseFloat(data.q).toFixed(4),
            time: new Date(data.T).toLocaleTimeString(),
            side: data.m ? 'SELL' : 'BUY' // m=true means maker (sell), m=false means taker (buy)
          };
          setRecentTrades((prev: any[]) => [newTrade, ...prev].slice(0, 20));
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    return () => {
      ws.close();
    };
  }, []);

  // Initialize price with markPrice once
  const [hasInitializedPrice, setHasInitializedPrice] = useState(false);
  useEffect(() => {
    if (!hasInitializedPrice && markPrice !== '0.00') {
      setPrice(markPrice);
      setHasInitializedPrice(true);
    }
  }, [markPrice, hasInitializedPrice]);

  // State for Order Book and Trades (replacing constants)
  const [orderBookBids, setOrderBookBids] = useState(ORDERBOOK_BIDS);
  const [orderBookAsks, setOrderBookAsks] = useState(ORDERBOOK_ASKS);
  const [recentTrades, setRecentTrades] = useState(RECENT_TRADES);

  const handleCreateAccount = async () => {
    if (!userData?.google_id) return;
    if (!newAccountName.trim()) {
        alert("Please enter an account name.");
        return;
    }
    try {
        await createAccount(userData.google_id, newAccountName, newAccountBalance);
        await fetchAccounts();
        setIsAccountModalOpen(false);
        setNewAccountName('');
        alert("Account created successfully!");
    } catch (err: any) {
        console.error(err);
        alert(`Failed to create account: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleDeleteAccount = async (accountId: number) => {
    if (!window.confirm("Are you sure you want to delete this account? This action cannot be undone.")) return;
    try {
        await deleteAccount(accountId);
        await fetchAccounts();
        if (selectedAccount?.id === accountId) {
            setSelectedAccount(null);
            setPositions([]);
        }
    } catch (err: any) {
        console.error(err);
        alert(`Failed to delete account: ${err.response?.data?.detail || err.message}`);
    }
  };

  const [activeTab, setActiveTab] = useState<'positions' | 'open-orders' | 'history'>('positions');
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);

  useEffect(() => {
    if (userData?.google_id) {
      fetchOrders();
    }
  }, [userData, activeTab]);

  const fetchOrders = async () => {
    if (!userData?.google_id) return;
    try {
      // Fetch Open Orders
      if (activeTab === 'open-orders' || activeTab === 'positions') {
        const data = await getOrders(userData.google_id, 'OPEN', selectedAccount?.id);
        setOpenOrders(data);
      }
      // Fetch Order History
      else if (activeTab === 'history') {
        const data = await getOrders(userData.google_id, 'HISTORY', selectedAccount?.id);
        setOrderHistory(data);
      }
    } catch (err) {
      console.error("Failed to fetch orders", err);
    }
  };

  const handleMarketClose = async (pos: any) => {
    if (!userData || !selectedAccount) return;

    try {
      const side = pos.position_side === 'LONG' ? 'SELL' : 'BUY';
      
      await axios.post('/api/orders/', {
        symbol: pos.symbol,
        side: side,
        type: 'MARKET',
        quantity: parseFloat(pos.quantity),
        leverage: pos.leverage,
        google_id: userData.google_id,
        account_id: selectedAccount.id
      });

      // Refresh data
      fetchPositions(selectedAccount.id);
      fetchAccounts();
      
      // Optional: Show success message or toast
    } catch (err) {
      console.error('Failed to close position:', err);
    }
  };

  const handleLimitCloseClick = (pos: any) => {
    setCloseModalData(pos);
    setClosePriceInput(markPrice); // Default to current mark price
    setIsCloseModalOpen(true);
  };

  const submitLimitClose = async () => {
    if (!userData || !selectedAccount || !closeModalData) return;

    const limitPrice = parseFloat(closePriceInput);
    if (isNaN(limitPrice) || limitPrice <= 0) {
      alert("Please enter a valid price.");
      return;
    }

    try {
      const side = closeModalData.position_side === 'LONG' ? 'SELL' : 'BUY';
      
      await axios.post('/api/orders/', {
        symbol: closeModalData.symbol,
        side: side,
        type: 'LIMIT',
        quantity: parseFloat(closeModalData.quantity),
        price: limitPrice,
        leverage: closeModalData.leverage,
        google_id: userData.google_id,
        account_id: selectedAccount.id
      });

      alert("Limit Close Order Placed Successfully!");
      setIsCloseModalOpen(false);
      setCloseModalData(null);
      setClosePriceInput("");

      // Refresh data
      fetchPositions(selectedAccount.id);
      fetchAccounts();
      fetchOrders();
      
    } catch (err: any) {
      console.error('Failed to place limit close order:', err);
      alert(`Failed to close position: ${err.response?.data?.detail || err.message}`);
    }
  };

  // Update Max Position based on Leverage (for Modal display)
  const getMaxPositionForLeverage = (lev: number) => {
    if (brackets.length > 0) {
      const bracket = brackets.find((b: LeverageBracket) => lev <= b.initial_leverage);
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
    const initWidget = () => {
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
          "container_id": "tradingview_chart",
          "studies": selectedIndicators.map((ind: string) => STUDIES[ind]),
        });
      }
    };

    if (!(window as any).TradingView) {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    } else {
      initWidget();
    }
  }, [selectedIndicators]);

  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    window.location.href = "/";
  };

  const handleOrderSubmit = async (side: "BUY" | "SELL") => {
    try {
      const notionalUSDT = parseFloat(amount);
      const currentPrice = orderType === 'LIMIT' ? parseFloat(price) : parseFloat(markPrice);
      
      // Convert Notional USDT to Quantity BTC
      // Quantity = Notional / Price
      const quantity = notionalUSDT / currentPrice;

      const orderPrice = orderType === "LIMIT" ? currentPrice : undefined;

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

      if (!selectedAccount) {
          alert("Please select an account.");
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
        account_id: selectedAccount.id,
      });

      alert(`${side} Order Placed Successfully!`);
      // Refresh positions and account balance
      fetchPositions(selectedAccount.id);
      fetchAccounts();
      fetchOrders();
      fetchOrders();

    } catch (err: any) {
      console.error(err);
      alert(`Order Failed: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    if (!userData?.google_id) return;
    if (!window.confirm("Are you sure you want to cancel this order?")) return;

    try {
      await cancelOrder(orderId, userData.google_id);
      alert("Order cancelled successfully");
      fetchOrders(); // Refresh orders
      fetchAccounts(); // Refresh balance
    } catch (err: any) {
      console.error("Failed to cancel order", err);
      alert(`Failed to cancel order: ${err.response?.data?.detail || err.message}`);
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
              <span className="text-gray-400">Funding / Countdown</span>
              <span className="text-[#f6465d]">0.0001% / 01:05:36</span>
            </div>

          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
           {userData ? (
             <div className="flex items-center gap-4">
               {/* Account Selector */}
               <div className="flex items-center gap-2">
                   {selectedAccount ? (
                       <div className="flex flex-col items-end mr-2">
                           <span className="text-xs font-bold text-white">{selectedAccount.account_name}</span>
                           <span className="text-[10px] text-[#fcd535]">{selectedAccount.available_balance.toLocaleString()} USDT</span>
                       </div>
                   ) : (
                       <span className="text-xs text-gray-500 mr-2">No Account Selected</span>
                   )}
                   
                   <button 
                       onClick={() => setIsAccountModalOpen(true)}
                       className="text-xs bg-[#2b3139] hover:bg-[#3a404a] text-white px-3 py-1 rounded border border-gray-600 flex items-center gap-1"
                   >
                       <span>Multi Account</span>
                       <span className="bg-[#fcd535] text-black text-[10px] px-1 rounded-sm font-bold">{accounts.length}</span>
                   </button>
               </div>

               <span className="text-gray-200 font-medium">{userData.name}</span>
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
          {/* Indicator Selection Bar */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-[#2b3139] bg-[#161a1e]">
            <span className="text-xs text-gray-400 font-bold">Indicators:</span>
            {Object.keys(STUDIES).map((ind) => (
              <label key={ind} className="flex items-center gap-1 cursor-pointer hover:text-white text-xs text-gray-300">
                <input 
                  type="checkbox" 
                  checked={selectedIndicators.includes(ind)}
                  onChange={() => handleIndicatorToggle(ind)}
                  className="rounded bg-[#2b3139] border-gray-600 accent-[#fcd535]"
                />
                {ind}
              </label>
            ))}
          </div>

          {/* Chart Area */}
          <div className="flex-1 bg-[#161a1e] relative">
             <div id="tradingview_chart" className="w-full h-full" />
          </div>

          {/* Bottom Panel: Positions */}
          <div className="h-64 border-t border-[#2b3139] bg-[#161a1e]">
            <div className="flex h-10 items-center px-4 gap-6 border-b border-[#2b3139]">
              <button 
                onClick={() => setActiveTab('positions')}
                className={`h-full border-b-2 text-sm font-medium ${activeTab === 'positions' ? 'border-[#fcd535] text-white font-bold' : 'border-transparent text-gray-400 hover:text-white'}`}
              >
                Positions ({positions.length})
              </button>
              <button 
                onClick={() => setActiveTab('open-orders')}
                className={`h-full border-b-2 text-sm font-medium ${activeTab === 'open-orders' ? 'border-[#fcd535] text-white font-bold' : 'border-transparent text-gray-400 hover:text-white'}`}
              >
                Open Orders ({openOrders.length})
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={`h-full border-b-2 text-sm font-medium ${activeTab === 'history' ? 'border-[#fcd535] text-white font-bold' : 'border-transparent text-gray-400 hover:text-white'}`}
              >
                Order History
              </button>
            </div>
            <div className="overflow-auto">
              {activeTab === 'positions' && (
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
                  {positions.map((pos: Position, i: number) => {
                    const currentMarkPrice = parseFloat(markPrice);
                    const pnl = pos.position_side === 'LONG' 
                        ? (currentMarkPrice - pos.entry_price) * pos.quantity 
                        : (pos.entry_price - currentMarkPrice) * pos.quantity;
                    const roe = (pnl / pos.margin) * 100;

                    return (
                    <tr key={i} className="border-b border-[#2b3139] hover:bg-[#2b3139]">
                      <td className="px-4 py-2 font-bold">
                        <div className="flex items-center gap-1">
                            <div className={`w-1 h-4 rounded-sm ${pos.position_side === 'LONG' ? 'bg-[#0ecb81]' : 'bg-[#f6465d]'}`}></div>
                            <span>{pos.symbol}</span>
                            <span className="bg-[#2b3139] px-1 rounded text-[10px] text-gray-400">Isolated {pos.leverage}x</span>
                        </div>
                      </td>
                      <td className={`px-4 py-2 ${pos.position_side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{pos.quantity}</td>
                      <td className="px-4 py-2">{pos.entry_price.toLocaleString()}</td>
                      <td className="px-4 py-2">{markPrice.toLocaleString()}</td>
                      <td className="px-4 py-2">{pos.margin.toFixed(2)}</td>
                      <td className="px-4 py-2">
                        <span className={pnl >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]"}>
                            {pnl.toFixed(2)} ({roe.toFixed(2)}%)
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button 
                          onClick={() => handleMarketClose(pos)}
                          className="text-gray-400 hover:text-[#fcd535]"
                        >
                          Market
                        </button>
                        <button 
                          onClick={() => handleLimitCloseClick(pos)}
                          className="ml-2 text-gray-400 hover:text-[#fcd535]"
                        >
                          Limit
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                  {positions.length === 0 && (
                      <tr>
                          <td colSpan={7} className="text-center py-8 text-gray-500">
                              No open positions
                          </td>
                      </tr>
                  )}
                </tbody>
              </table>
              )}

              {activeTab === 'open-orders' && (
                  <table className="w-full text-left text-xs text-gray-300">
                      <thead className="bg-[#1e2329] text-gray-400">
                          <tr>
                              <th className="px-4 py-2 font-normal">Time</th>
                              <th className="px-4 py-2 font-normal">Symbol</th>
                              <th className="px-4 py-2 font-normal">Type</th>
                              <th className="px-4 py-2 font-normal">Side</th>
                              <th className="px-4 py-2 font-normal">Price</th>
                              <th className="px-4 py-2 font-normal">Amount</th>
                              <th className="px-4 py-2 font-normal">Filled</th>
                              <th className="px-4 py-2 font-normal text-right">Action</th>
                          </tr>
                      </thead>
                      <tbody>
                          {openOrders.map((order: any, i: number) => (
                              <tr key={i} className="border-b border-[#2b3139] hover:bg-[#2b3139]">
                                  <td className="px-4 py-2">{new Date(order.created_at).toLocaleTimeString()}</td>
                                  <td className="px-4 py-2 font-bold">{order.symbol}</td>
                                  <td className="px-4 py-2">{order.order_type}</td>
                                  <td className={`px-4 py-2 ${order.side === 'BUY' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{order.side}</td>
                                  <td className="px-4 py-2">{order.price}</td>
                                  <td className="px-4 py-2">{order.quantity}</td>
                                  <td className="px-4 py-2">{parseFloat(order.executed_quantity).toString()}</td>
                                  <td className="px-4 py-2 text-right">
                                      <button 
                                        onClick={() => handleCancelOrder(order.id)}
                                        className="text-[#fcd535] hover:text-[#ffe258]"
                                      >
                                        Cancel
                                      </button>
                                  </td>
                              </tr>
                          ))}
                          {openOrders.length === 0 && (
                              <tr>
                                  <td colSpan={8} className="text-center py-8 text-gray-500">No open orders</td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              )}

              {activeTab === 'history' && (
                  <table className="w-full text-left text-xs text-gray-300">
                      <thead className="bg-[#1e2329] text-gray-400">
                          <tr>
                              <th className="px-4 py-2 font-normal">Time</th>
                              <th className="px-4 py-2 font-normal">Symbol</th>
                              <th className="px-4 py-2 font-normal">Type</th>
                              <th className="px-4 py-2 font-normal">Side</th>
                              <th className="px-4 py-2 font-normal">Price</th>
                              <th className="px-4 py-2 font-normal">Amount</th>
                              <th className="px-4 py-2 font-normal">Filled</th>
                              <th className="px-4 py-2 font-normal">Status</th>
                          </tr>
                      </thead>
                      <tbody>
                          {orderHistory.map((order: any, i: number) => (
                              <tr key={i} className="border-b border-[#2b3139] hover:bg-[#2b3139]">
                                  <td className="px-4 py-2">{new Date(order.created_at).toLocaleString()}</td>
                                  <td className="px-4 py-2 font-bold">{order.symbol}</td>
                                  <td className="px-4 py-2">{order.order_type}</td>
                                  <td className={`px-4 py-2 ${order.side === 'BUY' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{order.side}</td>
                                  <td className="px-4 py-2">{order.price || 'Market'}</td>
                                  <td className="px-4 py-2">{order.quantity}</td>
                                  <td className="px-4 py-2">{order.executed_quantity}</td>
                                  <td className="px-4 py-2">{order.status}</td>
                              </tr>
                          ))}
                          {orderHistory.length === 0 && (
                              <tr>
                                  <td colSpan={8} className="text-center py-8 text-gray-500">No order history</td>
                              </tr>
                          )}
                      </tbody>
                  </table>
              )}
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
                    {orderBookAsks.map((ask: any, i: number) => (
                        <div key={i} onClick={() => setPrice(ask.price)} className="flex px-3 py-[1px] text-xs hover:bg-[#2b3139] cursor-pointer relative">
                            <div className="absolute right-0 top-0 bottom-0 bg-[#f6465d] opacity-10" style={{width: `${Math.random() * 100}%`}}></div>
                            <span className="w-1/3 text-[#f6465d] z-10">{ask.price}</span>
                            <span className="w-1/3 text-right text-gray-300 z-10">{ask.amount}</span>
                            <span className="w-1/3 text-right text-gray-400 z-10">{ask.total}</span>
                        </div>
                    ))}
                 </div>

                 {/* Current Price */}
                 <div onClick={() => setPrice(markPrice)} className="flex items-center justify-center py-2 border-y border-[#2b3139] bg-[#161a1e] cursor-pointer hover:bg-[#2b3139]">
                    <span className="text-lg font-bold text-[#f6465d] mr-2">{markPrice}</span>
                    <span className="text-xs text-gray-400">≈ {markPrice} USD</span>
                 </div>

                 {/* Bids */}
                 <div className="flex-1 overflow-hidden pt-1">
                    {orderBookBids.map((bid: any, i: number) => (
                        <div key={i} onClick={() => setPrice(bid.price)} className="flex px-3 py-[1px] text-xs hover:bg-[#2b3139] cursor-pointer relative">
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
                    {recentTrades.map((trade: any, i: number) => (
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
                    <span className="text-white">{selectedAccount?.available_balance.toLocaleString() || '0.00'} USDT</span>
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
                    <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        step="1"
                        value={sliderValue}
                        onChange={handleSliderChange}
                        className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-[#fcd535]" 
                    />
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

      {/* Limit Close Modal */}
      {isCloseModalOpen && closeModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-[400px] rounded-lg bg-[#1e2329] p-6 shadow-lg">
            <h2 className="mb-4 text-xl font-bold text-white">Close Position (Limit)</h2>
            
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Symbol</span>
                <span className="text-white font-bold">{closeModalData.symbol}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Side</span>
                <span className={closeModalData.position_side === 'LONG' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}>
                  {closeModalData.position_side}
                </span>
              </div>
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Amount</span>
                <span className="text-white">{closeModalData.quantity}</span>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-xs text-gray-400 mb-1">Limit Price (USDT)</label>
              <input
                type="number"
                value={closePriceInput}
                onChange={(e) => setClosePriceInput(e.target.value)}
                className="w-full rounded bg-[#2b3139] px-3 py-2 text-white outline-none focus:ring-1 focus:ring-[#fcd535]"
                placeholder="Enter Price"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setIsCloseModalOpen(false)}
                className="flex-1 rounded bg-[#2b3139] py-2 font-bold text-gray-300 hover:bg-[#363c45]"
              >
                Cancel
              </button>
              <button
                onClick={submitLimitClose}
                className="flex-1 rounded bg-[#fcd535] py-2 font-bold text-black hover:bg-[#ffe258]"
              >
                Confirm Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Management Modal */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-[500px] rounded-lg bg-[#1e2329] p-6 shadow-xl border border-[#2b3139]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Multi Account Management</h2>
              <button onClick={() => setIsAccountModalOpen(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>

            {/* Account List */}
            <div className="mb-6 max-h-[300px] overflow-y-auto">
                <h3 className="text-sm font-bold text-gray-400 mb-3">Your Accounts ({accounts.length}/5)</h3>
                <div className="space-y-2">
                    {accounts.map(acc => (
                        <div key={acc.id} className={`flex items-center justify-between p-3 rounded border ${selectedAccount?.id === acc.id ? 'border-[#fcd535] bg-[#fcd535]/5' : 'border-[#2b3139] bg-[#2b3139]'}`}>
                            <div>
                                <div className="text-sm font-bold text-white flex items-center gap-2">
                                    {acc.account_name}
                                    {acc.is_default && <span className="text-[10px] bg-gray-600 px-1 rounded text-white">Default</span>}
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                    Balance: <span className="text-[#0ecb81]">{acc.available_balance.toLocaleString()} USDT</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {selectedAccount?.id !== acc.id && (
                                    <button 
                                        onClick={() => {
                                            setSelectedAccount(acc);
                                            setIsAccountModalOpen(false);
                                        }}
                                        className="text-xs bg-[#2b3139] hover:bg-[#3a404a] text-white px-3 py-1.5 rounded border border-gray-600"
                                    >
                                        Select
                                    </button>
                                )}
                                <button 
                                    onClick={() => handleDeleteAccount(acc.id)}
                                    className="text-xs text-red-500 hover:text-red-400 px-2 py-1.5"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                    {accounts.length === 0 && (
                        <div className="text-center py-4 text-gray-500 text-sm">
                            No accounts found. Create one to start trading.
                        </div>
                    )}
                </div>
            </div>

            {/* Create New Account Section */}
            {accounts.length < 5 ? (
                <div className="border-t border-[#2b3139] pt-4">
                    <h3 className="text-sm font-bold text-white mb-3">Create New Account</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Account Name</label>
                            <input 
                                type="text" 
                                className="w-full bg-[#2b3139] text-white rounded px-3 py-2 border border-gray-600 outline-none focus:border-[#fcd535]"
                                placeholder="e.g. Aggressive Strategy"
                                value={newAccountName}
                                onChange={(e) => setNewAccountName(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Initial Balance (USDT)</label>
                            <div className="grid grid-cols-4 gap-2">
                                {[100, 1000, 10000, 100000].map(bal => (
                                    <button 
                                        key={bal}
                                        onClick={() => setNewAccountBalance(bal)}
                                        className={`py-1.5 rounded text-xs font-medium border ${newAccountBalance === bal ? 'border-[#fcd535] text-[#fcd535] bg-[#fcd535]/10' : 'border-gray-600 text-gray-400 hover:border-gray-400'}`}
                                    >
                                        ${bal.toLocaleString()}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <button 
                          onClick={handleCreateAccount}
                          className="w-full rounded bg-[#fcd535] py-3 text-sm font-bold text-black hover:bg-[#ffe258]"
                        >
                          Create Account
                        </button>
                    </div>
                </div>
            ) : (
                <div className="border-t border-[#2b3139] pt-4 text-center text-xs text-yellow-500">
                    Maximum number of accounts (5) reached. Delete an account to create a new one.
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
