import React from "react";
import { useNavigate } from "react-router-dom";

// --- 환경 변수 ---
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

// --- 아이콘 컴포넌트 ---
const LogInIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" x2="3" y1="12" y2="12" />
  </svg>
);

const UserPlusIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    {...props}
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" x2="19" y1="8" y2="14" />
    <line x1="22" x2="16" y1="11" y2="11" />
  </svg>
);

// --- Google 로그인 핸들러 ---
function useGoogleLogin() {
  const handleGoogleLogin = () => {
    const redirect_uri = `${BACKEND_BASE_URL}/auth/google/callback`;
    const scope = encodeURIComponent(
      "openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile"
    );
    const response_type = "code";

    const googleAuthURL = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirect_uri}&response_type=${response_type}&scope=${scope}&access_type=offline&prompt=consent`;

    window.location.href = googleAuthURL;
  };
  
  return { handleGoogleLogin };
}

// --- 로그인 페이지 컴포넌트 ---
export default function App() {
  const navigate = useNavigate();
  const { handleGoogleLogin } = useGoogleLogin();

  // 이미 로그인된 상태면 메인으로 이동
  React.useEffect(() => {
    const token = localStorage.getItem("jwt_token");
    if (token) {
      navigate("/main", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <div className="w-full max-w-sm bg-gray-800 p-8 rounded-xl shadow-2xl border border-gray-700">
        <h1 className="text-3xl font-extrabold text-white mb-8 text-center">
          <LogInIcon className="inline-block w-8 h-8 mr-2 text-blue-400" /> SGFM
          Login
        </h1>

        <button
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center py-3 px-4 mb-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition duration-150 shadow-lg transform hover:scale-[1.02]"
        >
          Sign in with Google
        </button>

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate("/signup")}
            className="text-gray-400 hover:text-blue-400 font-medium text-sm transition duration-150 flex items-center justify-center w-full"
          >
            <UserPlusIcon className="w-4 h-4 mr-1" /> Don't you have an
            account? Sign up
          </button>
        </div>
      </div>
    </div>
  );
}