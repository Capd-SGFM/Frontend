import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

function MainPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("사용자");

  // URL에서 token 파라미터 처리
  useEffect(() => {
    const urlToken = searchParams.get("jwt_token") || searchParams.get("token");
    if (urlToken) {
      console.log("MainPage: URL에서 토큰 발견");
      localStorage.setItem("jwt_token", urlToken);
      
      // URL에서 토큰 파라미터 제거
      searchParams.delete("jwt_token");
      searchParams.delete("token");
      setSearchParams(searchParams, { replace: true });
      
      // 사용자 정보 파싱
      try {
        const payload = JSON.parse(
          atob(urlToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
        );
        setUsername(payload?.username || payload?.sub || "사용자");
      } catch (e) {
        console.error("JWT 파싱 실패:", e);
      }
    }
  }, [searchParams, setSearchParams]);

  // 기존 토큰에서 사용자 정보 가져오기
  useEffect(() => {
    const token = localStorage.getItem("jwt_token");
    if (token && username === "사용자") {
      try {
        const payload = JSON.parse(
          atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
        );
        setUsername(payload?.username || payload?.sub || "사용자");
      } catch (e) {
        console.error("JWT 파싱 실패:", e);
      }
    }
  }, [username]);

  const handleLogout = () => {
    localStorage.removeItem("jwt_token");
    navigate("/");
  };

  const handleEditProfile = () => {
    alert("사용자 정보 수정 기능은 준비 중입니다.");
  };

  const dashboardCards = [
    {
      title: "DB 관리 페이지",
      description: "데이터베이스 관리 및 OHLCV 데이터 수집",
      path: "/admin",
      icon: "🗄️",
      color: "from-blue-500 to-blue-700",
    },
    {
      title: "백테스팅 페이지",
      description: "AI 기반 트레이딩 전략 백테스팅",
      path: "/backtesting",
      icon: "📊",
      color: "from-green-500 to-green-700",
    },
    {
      title: "실시간 트레이딩 페이지",
      description: "실시간 모의 투자 및 자동매매",
      path: "/trading",
      icon: "💹",
      color: "from-purple-500 to-purple-700",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
     
      <nav className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-cyan-400">SGFM</h1>
            <span className="text-sm text-gray-400">Sogang Fund Manager</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-700 rounded-lg">
              <span className="text-gray-300">👤</span>
              <span className="text-white font-medium">{username}</span>
            </div>
            
            <button
              onClick={handleEditProfile}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
              정보 수정
            </button>
            
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>
      </nav>

   
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">
            환영합니다, {username}님!
          </h2>
          <p className="text-gray-400">
            아래 대시보드에서 원하는 기능을 클릭해주세요!
          </p>
        </div>

        {/* 대시보드 카드 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {dashboardCards.map((card, index) => (
            <div
              key={index}
              onClick={() => navigate(card.path)}
              className="group cursor-pointer bg-gray-800 rounded-xl shadow-lg border border-gray-700 hover:border-cyan-500 transition-all duration-300 overflow-hidden"
            >
              <div className={`h-2 bg-gradient-to-r ${card.color}`} />
              
              <div className="p-6">
                <div className="text-5xl mb-4">{card.icon}</div>
                
                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-cyan-400 transition-colors">
                  {card.title}
                </h3>
                
                <p className="text-gray-400 text-sm mb-4">
                  {card.description}
                </p>
                
                <div className="flex items-center text-cyan-400 text-sm font-medium group-hover:gap-2 transition-all">
                  <span>클릭</span>
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </div>
              </div>
            </div>
          ))}
        </div>

    
        
      </main>
    </div>
  );
}

export default MainPage;