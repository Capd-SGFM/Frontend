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
}

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
