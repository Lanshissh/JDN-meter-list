import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type AuthContextType = {
  isLoggedIn: boolean;
  loading: boolean;
  logout: () => Promise<void>;
  login: (token: string) => Promise<void>;
  token: string | null;
  /** ms epoch when the JWT expires (null if unknown) */
  expiresAt: number | null;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safe decode of JWT exp (ms). Fallback to now+1h if decoding not available.
  const getExpMs = (jwt: string): number => {
    try {
      const payload = jwt.split(".")[1];
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const g: any = globalThis as any;
      if (typeof g.atob === "function") {
        const json = g.atob(base64);
        const obj = JSON.parse(json);
        if (typeof obj.exp === "number") return obj.exp * 1000;
      }
    } catch {}
    // fallback (API default is 1h)
    return Date.now() + 60 * 60 * 1000;
  };

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const scheduleAutoLogout = (expMs: number) => {
    clearTimer();
    const ms = Math.max(0, expMs - Date.now());
    timerRef.current = setTimeout(() => {
      logout();
    }, ms);
  };

  useEffect(() => {
    const initialize = async () => {
      const [storedToken, storedExp] = await Promise.all([
        AsyncStorage.getItem("token"),
        AsyncStorage.getItem("expiresAt"),
      ]);

      // If we have a token but no stored expiry, derive it from token
      let expMs =
        storedExp != null
          ? parseInt(storedExp, 10)
          : storedToken
            ? getExpMs(storedToken)
            : null;

      if (!storedToken || !expMs || Date.now() >= expMs) {
        // nothing valid -> ensure clean state
        await AsyncStorage.multiRemove(["token", "expiresAt"]);
        setIsLoggedIn(false);
        setToken(null);
        setExpiresAt(null);
        setLoading(false);
        return;
      }

      setToken(storedToken);
      setExpiresAt(expMs);
      setIsLoggedIn(true);
      scheduleAutoLogout(expMs);
      setLoading(false);
    };
    initialize();
    return clearTimer; // cleanup timer on unmount
  }, []);

  const login = async (newToken: string) => {
    const expMs = getExpMs(newToken);
    setToken(newToken);
    setIsLoggedIn(true);
    setExpiresAt(expMs);
    scheduleAutoLogout(expMs);
    await AsyncStorage.multiSet([
      ["token", newToken],
      ["expiresAt", String(expMs)],
    ]);
  };

  const logout = async () => {
    clearTimer();
    setIsLoggedIn(false);
    setToken(null);
    setExpiresAt(null);
    await AsyncStorage.multiRemove(["token", "expiresAt"]);
  };

  return (
    <AuthContext.Provider
      value={{ isLoggedIn, loading, logout, login, token, expiresAt }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
