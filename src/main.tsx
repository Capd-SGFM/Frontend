import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App";                 // 로그인 페이지
import MainPage from "./pages/MainPage";
import AdminPage from "./pages/AdminPage";
import SignupPage from "./pages/SignupPage";
import ProtectedRoute from "./components/ProtectedRoute";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* 공개: 로그인 페이지 */}
        <Route path="/" element={<App />} />

        {/* 공개: 회원가입(여기서 URL의 jwt_token을 먼저 저장) */}
        <Route path="/signup" element={<SignupPage />} />

        {/* 보호: 로그인 필요 페이지들 */}
        <Route element={<ProtectedRoute />}>
          <Route path="/main" element={<MainPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>

        {/* 404 */}
        <Route
          path="*"
          element={
            <div className="text-white text-3xl p-8 bg-slate-900 min-h-screen">
              404 Not Found
            </div>
          }
        />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
