import { Navigate, Outlet, useLocation } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

const TOKEN_KEY = "jwt_token";

type JwtPayload = { exp?: number };

export default function ProtectedRoute() {
  const loc = useLocation();

  // 1) 혹시 URL로 /main?jwt_token=... 식으로 들어온 경우 먼저 흡수
  const qs = new URLSearchParams(loc.search);
  const urlToken = qs.get("jwt_token") || qs.get("token");
  if (urlToken) {
    localStorage.setItem(TOKEN_KEY, urlToken);
    qs.delete("jwt_token"); qs.delete("token");
    const clean = qs.toString();
    window.history.replaceState(
      null,
      "",
      clean ? `${loc.pathname}?${clean}` : loc.pathname
    );
  }

  // 2) 저장된 토큰 확인 + 만료 검사
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return <Navigate to="/" replace state={{ from: loc }} />;

  try {
    const { exp } = jwtDecode<JwtPayload>(token);
    if (exp && exp * 1000 <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return <Navigate to="/" replace />;
    }
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
