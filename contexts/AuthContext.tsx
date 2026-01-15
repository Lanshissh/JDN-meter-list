// contexts/AuthContext.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Shape we expect from the JWT payload */
export type AuthUser = {
  user_id: string;
  user_fullname: string;
  user_roles: string[];
  building_ids: string[];
  utility_role: string[];
};

type AuthContextType = {
  isLoggedIn: boolean;
  loading: boolean;
  token: string | null;
  expiresAt: number | null; // ms epoch
  user: AuthUser | null;

  /** Reader device identity (READERS ONLY) */
  deviceToken: string | null;
  deviceName: string | null;

  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;

  /** Reader device helpers */
  setReaderDevice: (deviceToken: string, deviceName?: string | null) => Promise<void>;
  clearReaderDevice: () => Promise<void>;

  // convenience guards
  hasRole: (...roles: string[]) => boolean;
  inBuilding: (...buildingIds: string[]) => boolean;
  hasUtility: (...utils: string[]) => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/* ---------------- storage keys ---------------- */
const KEY_TOKEN = "token";
const KEY_EXPIRES_AT = "expiresAt";
const KEY_USER = "user";

// Reader device keys (must match what login.tsx stores)
const KEY_DEVICE_TOKEN = "device_token_v1";
const KEY_DEVICE_NAME = "device_name_v1";
// NOTE: we intentionally DO NOT remove device_serial_v1 on logout (device-level setting)

// Offline session keys (must match ScanHistoryContext.tsx)
const KEY_OFFLINE_SCANS = "offline_scans_v1";
const KEY_OFFLINE_PACKAGE = "offline_package_v1";

/* ---------------- helpers (frontend-only) ---------------- */
const safeAtob = (b64: string): string | null => {
  try {
    // web / RN web
    // @ts-ignore
    if (typeof globalThis.atob === "function") return globalThis.atob(b64);
  } catch {}
  try {
    // RN / Node fallback
    // @ts-ignore
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  } catch {}
  return null;
};

const decodeJwt = (jwt: string): any | null => {
  try {
    const payloadB64 = jwt.split(".")[1];
    if (!payloadB64) return null;
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const json = safeAtob(base64);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const getExpMsFromJwt = (jwt: string): number => {
  const p = decodeJwt(jwt);
  if (p && typeof p.exp === "number") return p.exp * 1000;
  // fallback if token lacks exp (keeps user around for 1h)
  return Date.now() + 60 * 60 * 1000;
};

const getUserFromJwt = (jwt: string): AuthUser | null => {
  const p = decodeJwt(jwt);
  if (!p) return null;
  return {
    user_id: String(p.user_id ?? ""),
    user_fullname: String(p.user_fullname ?? ""),
    user_roles: Array.isArray(p.user_roles) ? p.user_roles : [],
    building_ids: Array.isArray(p.building_ids) ? p.building_ids : [],
    utility_role: Array.isArray(p.utility_role) ? p.utility_role : [],
  };
};

const norm = (v: any) => String(v ?? "").trim().toLowerCase();
const userHasRole = (u: AuthUser | null, role: string) =>
  !!u && Array.isArray(u.user_roles) && u.user_roles.map(norm).includes(norm(role));

/**
 * Reader requirement:
 * - When reader logs in, phone must have 0 meter/tenant data until Sync Import.
 * So clear offline package + offline scans on reader login.
 */
const clearReaderSessionData = async () => {
  await AsyncStorage.multiRemove([KEY_OFFLINE_SCANS, KEY_OFFLINE_PACKAGE]);
};

/* ---------------- provider ---------------- */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  // Reader device identity (READERS ONLY)
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const clearReaderDevice = async () => {
    setDeviceToken(null);
    setDeviceName(null);
    await AsyncStorage.multiRemove([KEY_DEVICE_TOKEN, KEY_DEVICE_NAME]);
  };

  const setReaderDevice = async (dt: string, dn?: string | null) => {
    const tokenStr = (dt || "").trim();
    const nameStr = (dn || "").trim();

    if (!tokenStr) throw new Error("Device token is required.");

    setDeviceToken(tokenStr);
    setDeviceName(nameStr || null);

    const pairs: [string, string][] = [[KEY_DEVICE_TOKEN, tokenStr]];
    if (nameStr) pairs.push([KEY_DEVICE_NAME, nameStr]);

    await AsyncStorage.multiSet(pairs);
  };

  // load session on mount
  useEffect(() => {
    const init = async () => {
      try {
        const [storedToken, storedExp, storedUser, storedDeviceToken, storedDeviceName] =
          await Promise.all([
            AsyncStorage.getItem(KEY_TOKEN),
            AsyncStorage.getItem(KEY_EXPIRES_AT),
            AsyncStorage.getItem(KEY_USER),
            AsyncStorage.getItem(KEY_DEVICE_TOKEN),
            AsyncStorage.getItem(KEY_DEVICE_NAME),
          ]);

        const expMs =
          storedExp != null
            ? parseInt(storedExp, 10)
            : storedToken
            ? getExpMsFromJwt(storedToken)
            : null;

        if (!storedToken || !expMs || Date.now() >= expMs) {
          await AsyncStorage.multiRemove([KEY_TOKEN, KEY_EXPIRES_AT, KEY_USER]);
          setIsLoggedIn(false);
          setToken(null);
          setExpiresAt(null);
          setUser(null);
          // also clear reader device identity
          await AsyncStorage.multiRemove([KEY_DEVICE_TOKEN, KEY_DEVICE_NAME]);
          setDeviceToken(null);
          setDeviceName(null);
          return;
        }

        setToken(storedToken);
        setExpiresAt(expMs);
        setIsLoggedIn(true);

        // prefer decoding the token (source of truth)
        const decoded = getUserFromJwt(storedToken);
        if (decoded) {
          setUser(decoded);
          await AsyncStorage.setItem(KEY_USER, JSON.stringify(decoded));
        } else if (storedUser) {
          setUser(JSON.parse(storedUser));
        } else {
          setUser(null);
        }

        // Only keep device token in memory if current user is a reader
        const effectiveUser = decoded ?? (storedUser ? JSON.parse(storedUser) : null);
        if (userHasRole(effectiveUser, "reader")) {
          setDeviceToken(storedDeviceToken ? String(storedDeviceToken) : null);
          setDeviceName(storedDeviceName ? String(storedDeviceName) : null);

          // Ensure reader starts with 0 data on app restore as well
          await clearReaderSessionData();
        } else {
          // non-reader logged in -> do not keep device token around
          await AsyncStorage.multiRemove([KEY_DEVICE_TOKEN, KEY_DEVICE_NAME]);
          setDeviceToken(null);
          setDeviceName(null);
        }

        scheduleAutoLogout(expMs);
      } finally {
        setLoading(false);
      }
    };

    init();
    return clearTimer; // cleanup on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async (newToken: string) => {
    const expMs = getExpMsFromJwt(newToken);
    const decoded = getUserFromJwt(newToken);

    setToken(newToken);
    setExpiresAt(expMs);
    setIsLoggedIn(true);
    setUser(decoded);

    scheduleAutoLogout(expMs);

    await AsyncStorage.multiSet([
      [KEY_TOKEN, newToken],
      [KEY_EXPIRES_AT, String(expMs)],
      [KEY_USER, JSON.stringify(decoded)],
    ]);

    // IMPORTANT:
    // login.tsx will do /reader-devices/resolve for reader and store device_token_v1/device_name_v1.
    // Here we simply refresh from storage if reader; otherwise clear.
    if (userHasRole(decoded, "reader")) {
      // reader must start with ZERO data until Sync Import
      await clearReaderSessionData();

      const [dt, dn] = await Promise.all([
        AsyncStorage.getItem(KEY_DEVICE_TOKEN),
        AsyncStorage.getItem(KEY_DEVICE_NAME),
      ]);
      setDeviceToken(dt ? String(dt) : null);
      setDeviceName(dn ? String(dn) : null);
    } else {
      await clearReaderDevice();
    }
  };

  const logout = async () => {
    clearTimer();
    setIsLoggedIn(false);
    setToken(null);
    setExpiresAt(null);
    setUser(null);

    // Clear reader device token + name on logout (keep device serial)
    setDeviceToken(null);
    setDeviceName(null);

    await AsyncStorage.multiRemove([
      KEY_TOKEN,
      KEY_EXPIRES_AT,
      KEY_USER,
      KEY_DEVICE_TOKEN,
      KEY_DEVICE_NAME,

      // also clear any offline session data on logout
      KEY_OFFLINE_SCANS,
      KEY_OFFLINE_PACKAGE,
    ]);
  };

  // convenience guards (case-insensitive)
  const hasRole = (...roles: string[]) =>
    !!user && roles.some((r) => user.user_roles.map(norm).includes(norm(r)));

  const inBuilding = (...buildingIds: string[]) =>
    !!user && buildingIds.some((b) => user.building_ids.map(String).includes(String(b)));

  const hasUtility = (...utils: string[]) =>
    !!user && utils.some((u) => user.utility_role.map(norm).includes(norm(u)));

  const value = useMemo<AuthContextType>(
    () => ({
      isLoggedIn,
      loading,
      token,
      expiresAt,
      user,

      deviceToken,
      deviceName,

      login,
      logout,

      setReaderDevice,
      clearReaderDevice,

      hasRole,
      inBuilding,
      hasUtility,
    }),
    [isLoggedIn, loading, token, expiresAt, user, deviceToken, deviceName]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};