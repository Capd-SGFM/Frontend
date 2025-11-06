import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

function MainPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // [수정]
  // 1. localStorage에서 초기값을 가져와 React state로 토큰을 관리합니다.
  // 2. 이렇게 하면 URL에 토큰이 있든 없든(이미 로그인했든) 상태가 일관됩니다.
  // 3. 함수형 업데이트 `() => ...`를 사용하면 컴포넌트 마운트 시 *한 번만* localStorage를 읽습니다.
  const [token, setToken] = useState(() => localStorage.getItem("jwt_token"));

  // [수정] URL에 토큰이 있을 경우(로그인 직후) 처리하는 Effect
  useEffect(() => {
    // URL에서 'token' 파라미터를 읽어옵니다.
    const urlToken = searchParams.get("jwt_token");

    if (urlToken) {
      // 1. localStorage에 저장
      localStorage.setItem("jwt_token", urlToken);
      // 2. 컴포넌트 state 업데이트 (UI 즉시 갱신)
      setToken(urlToken);

      // 3. [수정] React 방식의 URL 정리
      // window.history.replaceState 대신 searchParams 훅을 사용해 URL을 정리합니다.
      searchParams.delete("jwt_token");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // [추가] 토큰이 아예 없는 경우 (비로그인) 로그인 페이지로 리디렉션
  useEffect(() => {
    // 이 Effect는 'token' state가 변경될 때마다 실행됩니다.
    // 마운트 시점에 state('token')가 null이고, URL에도 토큰이 없다면
    if (!token) {
        // 혹시 모를 URL 확인 (위 Effect보다 늦게 실행될 수 있으므로)
        if (!searchParams.get("token")) {
           navigate("/"); // 로그인 페이지로 리디렉션
        }
    }
  }, [token, navigate, searchParams]);

  // [추가] 로그아웃 핸들러
  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    setToken(null); // state 업데이트 (즉시 리렌더링)
    // navigate("/"); // 위의 useEffect [token] 의존성에 의해 자동으로 리디렉션됩니다.
  };

  const handleAdminNavigate = () => {
    navigate("/admin");
  };

  return (
    <div className="flex flex-col items-center justify-center w-screen h-screen bg-gray-900 text-white">
      {/* [수정] 모든 렌더링 판단 기준을 localStorage가 아닌 state 'token'으로 변경 */}
      {token ? (
        <>
          <h1 className="text-3xl font-bold text-green-400">
            로그인 성공 (기존 유저)
          </h1>
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
            
            {/* [추가] 로그아웃 버튼 */}
            <button
              onClick={handleLogout}
              className="mt-4 w-full bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-lg transition-colors"
            >
              로그아웃
            </button>
          </div>
        </>
      ) : (
        // 토큰이 없는 경우 (리디렉션 대기 중)
        <p className="text-yellow-400">인증 정보를 확인 중입니다...</p>
      )}
    </div>
  );
}

export default MainPage;