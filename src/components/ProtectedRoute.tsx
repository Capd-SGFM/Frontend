import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

interface JwtPayload {
  exp?: number;
  sub?: string;
  username?: string;
}

// JWT 토큰 검증
const ProtectedRoute: React.FC = () => {
  //localStorage에서 토큰 확인
  let token = localStorage.getItem("jwt_token");
  
  //localStorage에 없으면 URL 파라미터 확인
  if (!token) {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get("jwt_token") || urlParams.get("token");
    
    if (urlToken) {
      console.log("URL에서 토큰 발견, localStorage에 저장");
      localStorage.setItem("jwt_token", urlToken);
      token = urlToken;
      
      
      urlParams.delete("jwt_token");
      urlParams.delete("token");
      const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState({}, '', newUrl);
    }
  }
  
  let isAuthenticated = false;

  if (token) {
    try {
      const decoded: JwtPayload = jwtDecode(token);
      const now = Date.now() / 1000;
      
      //디버깅 로그
      console.log("ProtectedRoute 토큰 검증:");
      console.log("- 현재 시간:", now);
      console.log("- 토큰 만료:", decoded.exp);
      console.log("- 남은 시간:", decoded.exp ? (decoded.exp - now) : "만료시간 없음");
      
      //exp가 없거나, 아직 만료되지 않았으면 인증 성공
      if (!decoded.exp || decoded.exp > now) {
        isAuthenticated = true;
        console.log("인증 성공");
      } else {
        console.warn("JWT 토큰 만료");
        localStorage.removeItem("jwt_token");
      }
    } catch (err) {
      console.error("JWT 토큰 위조 의심:", err);
      localStorage.removeItem("jwt_token");
    }
  } else {
    console.log("토큰 없음");
  }

  return isAuthenticated ? <Outlet /> : <Navigate to="/" replace />;
};

export default ProtectedRoute;