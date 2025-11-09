import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import App from "./App";
import MainPage from "./pages/MainPage";
import AdminPage from "./pages/AdminPage";
import BacktestingPage from "./pages/Backtesting";
import SignupPage from "./pages/SignupPage";
import ProtectedRoute from "./components/ProtectedRoute";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* JWT 토큰이 유효할 경우 /main으로 redirect되도록 수정해야함 */}
        <Route path="/" element={<App />} />

        {/* JWT있을때만 접근할지 다시 수정해야함 */}
        <Route path="/signup" element={<SignupPage />} />

        {/* JWT토큰이 유효할 경우에만 접근 */}
        <Route element={<ProtectedRoute />}>
          <Route path="/main" element={<MainPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/backtesting" element={<BacktestingPage />} />
        </Route>

        {/* 등록되지 않은 경로로 접근 */}
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
