import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

interface JwtPayload {
  exp?: number;
}

// JWT 토큰 위조 여부 검사
const ProtectedRoute: React.FC = () => {
  const token = localStorage.getItem("jwt_token");
  let isAuthenticated = false;

  if (token) {
    try {
      const decoded: JwtPayload = jwtDecode(token);
      const now = Date.now() / 1000;
      if (decoded.exp && decoded.exp > now) {
        isAuthenticated = true;
      } else {
        console.warn("JWT토큰 만료");
        localStorage.removeItem("jwt_token");
      }
    } catch (err) {
      console.error("JWT토큰 위조 의심:", err);
      localStorage.removeItem("jwt_token");
    }
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/" replace />;
};

export default ProtectedRoute;
