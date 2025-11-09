import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuthCheck } from "../components/is_logined";

function MainPage() {
  // ✅ 1️⃣ 가장 위에서 모든 Hook을 한 번씩, 항상 같은 순서로 실행
  const { isChecking, isValid } = useAuthCheck(); // 첫 번째 Hook
  const [searchParams, setSearchParams] = useSearchParams(); // 두 번째 Hook
  const navigate = useNavigate(); // 세 번째 Hook
  const [token, setToken] = useState(() => localStorage.getItem("jwt_token")); // 네 번째 Hook

  // ✅ 2️⃣ Effect 훅도 순서 고정
  useEffect(() => {
    const urlToken = searchParams.get("jwt_token");
    if (urlToken) {
      localStorage.setItem("jwt_token", urlToken);
      setToken(urlToken);
      searchParams.delete("jwt_token");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // ✅ 3️⃣ 인증 확인 로직은 조건문이 아니라 “렌더링 조기 종료”로 처리
  if (isChecking) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-900 text-white">
        인증 확인 중...
      </div>
    );
  }

  if (!isValid) {
    // useAuthCheck() 내부에서 navigate("/") 실행됨
    return null;
  }

  // ✅ 4️⃣ 이후 UI 렌더링은 순수 JSX
  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    setToken(null);
    navigate("/");
  };

  const handleAdminNavigate = () => navigate("/admin");

  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen bg-gray-900 text-white">
      <h1 className="text-3xl font-bold text-green-400">로그인 성공 (기존 유저)</h1>
      <p className="mt-4">메인 페이지로 리디렉션</p>

      <div className="mt-8 p-4 bg-gray-800 rounded-lg w-full max-w-lg">
        <p className="text-lg font-semibold">발급된 JWT 토큰:</p>
        <pre className="text-xs text-gray-300 break-words whitespace-pre-wrap mt-2">
          {token}
        </pre>

        <button
          onClick={handleAdminNavigate}
          className="mt-6 w-full bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded-lg transition-colors"
        >
          DB 관리자 페이지로 이동
        </button>

        <button
          onClick={handleLogout}
          className="mt-4 w-full bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg transition-colors"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}

export default MainPage;
