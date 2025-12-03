import axios from "axios";

const API_URL =
  (import.meta as any).env?.VITE_BACKEND_URL || "http://localhost:8080";

// Nginx Proxy를 통해 paper_trading_backend로 요청
const paperApi = axios.create({
  baseURL: `${API_URL}/paper-trading-api`, // nginx.conf에 설정한 경로
  timeout: 10000,
});

export interface CollectionStatus {
  is_active: boolean;
  active_symbols: string[];
  last_updated: string | null;
}

export const startCollection = async () => {
  const res = await paperApi.post("/collect/start");
  return res.data;
};

export const stopCollection = async () => {
  const res = await paperApi.post("/collect/stop");
  return res.data;
};

export const getCollectionStatus = async () => {
  const res = await paperApi.get<CollectionStatus>("/collect/status");
  return res.data;
};

export interface OrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  leverage?: number;
  google_id: string;
  account_id?: number;
}

export interface Account {
  id: number;
  google_id: string;
  account_name: string;
  is_default: boolean;
  total_balance: number;
  available_balance: number;
  margin_balance: number;
  unrealized_pnl: number;
  total_pnl: number;
  created_at: string;
}

export interface Position {
  id: number;
  symbol: string;
  position_side: string;
  quantity: number;
  entry_price: number;
  leverage: number;
  margin: number;
  unrealized_pnl: number;
  roe_percent: number;
  liquidation_price: number | null;
}

export const createAccount = async (google_id: string, account_name: string, initial_balance: number) => {
  const res = await paperApi.post<Account>("/accounts/", { google_id, account_name, initial_balance });
  return res.data;
};

export const getAccounts = async (google_id: string) => {
  const res = await paperApi.get<Account[]>(`/accounts/${google_id}`);
  return res.data;
};

export const getPositions = async (account_id: number) => {
  const res = await paperApi.get<Position[]>(`/accounts/${account_id}/positions`);
  return res.data;
};

export const deleteAccount = async (account_id: number) => {
  const res = await paperApi.delete(`/accounts/${account_id}`);
  return res.data;
};

export const placeOrder = async (order: OrderRequest) => {
  const res = await paperApi.post("/orders/", order);
  return res.data;
};

export interface LeverageBracket {
  bracket_id: number;
  initial_leverage: number;
  max_notional: number;
  min_notional: number;
  maint_margin_rate: number;
}

export const getLeverageBrackets = async (symbol: string) => {
  const res = await paperApi.get<LeverageBracket[]>(`/market/leverage-brackets/${symbol}`);
  return res.data;
};

export const getOrders = async (google_id: string, status?: string, account_id?: number) => {
  const res = await paperApi.get<any[]>("/orders/", {
    params: { google_id, status, account_id }
  });
  return res.data;
};

export const cancelOrder = async (order_id: number, google_id: string) => {
  const res = await paperApi.delete(`/orders/${order_id}`, {
    params: { google_id }
  });
  return res.data;
};
