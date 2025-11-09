import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

export function useAuthCheck() {
  const [isChecking, setIsChecking] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("jwt_token");
    if (!token) {
      navigate("/");
      return;
    }

    // verify_token을 통과시키는 /auth/me 호출
    axios
      .get(`${BACKEND_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then(() => {
        setIsValid(true);
      })
      .catch((err) => {
        console.warn("토큰 검증 실패:", err);
        localStorage.removeItem("jwt_token");
        navigate("/");
      })
      .finally(() => setIsChecking(false));
  }, [navigate]);

  return { isChecking, isValid };
}