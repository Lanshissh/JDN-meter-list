import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BASE_API } from "../constants/api";

export type OfflineScan = {
  id: string; // local id
  meter_id: string;
  reading_value: number;
  lastread_date: string; // YYYY-MM-DD
  createdAt: string; // ISO when queued
  status: "pending" | "approved" | "failed";
  error?: string;
};

type Ctx = {
  scans: OfflineScan[];
  isConnected: boolean | null;
  queueScan: (s: Omit<OfflineScan, "id" | "createdAt" | "status">) => Promise<void>;
  removeScan: (id: string) => Promise<void>;
  markPending: (id: string) => Promise<void>;
  markApproved: (id: string) => Promise<void>;
  approveOne: (id: string, token: string | null) => Promise<void>;
  approveAll: (token: string | null) => Promise<void>;
  reload: () => Promise<void>;
  deviceToken: string | null;

  // ✅ manual pairing (admin provides token)
  setDeviceTokenDirect: (token: string | null) => Promise<void>;

  // existing self-register (you can keep, but MeterReadingPanel should stop calling it)
  registerDevice: (
    token: string | null,
    deviceName: string,
    deviceInfo?: string
  ) => Promise<{ device_token: string; status: string }>;
};

const ScanHistoryContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "offline_scans_v1";
const DEVICE_TOKEN_KEY = "offline_device_token_v1";

export function ScanHistoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);

  // network status
  useEffect(() => {
    const sub = NetInfo.addEventListener((state) =>
      setIsConnected(!!state.isConnected)
    );
    NetInfo.fetch().then((s) => setIsConnected(!!s.isConnected));
    return () => {
      if (sub) sub();
    };
  }, []);

  // load scans
  const reload = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setScans(raw ? (JSON.parse(raw) as OfflineScan[]) : []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // save scans helper
  const save = useCallback(async (items: OfflineScan[]) => {
    setScans(items);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, []);

  // load device token on startup
  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);
      if (stored) setDeviceToken(stored);
    })();
  }, []);

  const saveDeviceToken = useCallback(async (token: string | null) => {
    setDeviceToken(token);
    if (token) {
      await AsyncStorage.setItem(DEVICE_TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(DEVICE_TOKEN_KEY);
    }
  }, []);

  // ✅ NEW: allow manual pairing (admin-provided token)
  const setDeviceTokenDirect: Ctx["setDeviceTokenDirect"] = useCallback(
    async (token) => {
      await saveDeviceToken(token);
    },
    [saveDeviceToken]
  );

  // queue a new scan
  const queueScan: Ctx["queueScan"] = useCallback(
    async ({ meter_id, reading_value, lastread_date }) => {
      const item: OfflineScan = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        meter_id,
        reading_value,
        lastread_date,
        createdAt: new Date().toISOString(),
        status: "pending",
      };
      await save([item, ...scans]);
    },
    [save, scans]
  );

  const removeScan: Ctx["removeScan"] = useCallback(
    async (id) => {
      const updated: OfflineScan[] = scans.filter((s) => s.id !== id);
      await save(updated);
    },
    [save, scans]
  );

  const markPending: Ctx["markPending"] = useCallback(
    async (id) => {
      const updated: OfflineScan[] = scans.map((s) =>
        s.id === id
          ? ({
              ...s,
              status: "pending" as const,
              error: undefined,
            } as OfflineScan)
          : s
      );
      await save(updated);
    },
    [save, scans]
  );

  const markApproved: Ctx["markApproved"] = useCallback(
    async (id) => {
      const updated: OfflineScan[] = scans.map((s) =>
        s.id === id
          ? ({
              ...s,
              status: "approved" as const,
              error: undefined,
            } as OfflineScan)
          : s
      );
      await save(updated);
    },
    [save, scans]
  );

  // register device and get device_token (existing behavior)
  const registerDevice: Ctx["registerDevice"] = useCallback(
    async (token, deviceName, deviceInfo) => {
      if (!token) {
        throw new Error("Missing auth token");
      }

      const api = axios.create({
        baseURL: BASE_API,
        timeout: 15000,
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await api.post("/reader-devices/register", {
        device_name: deviceName,
        device_info: deviceInfo,
      });

      const newToken: string | undefined = res?.data?.device_token;
      if (newToken) {
        await saveDeviceToken(newToken);
      }

      return res.data;
    },
    [saveDeviceToken]
  );

  // export a single scan
  const approveOne: Ctx["approveOne"] = useCallback(
    async (id, token) => {
      const target = scans.find((s) => s.id === id);
      if (!target) return;

      if (!token) throw new Error("Missing auth token");
      if (!deviceToken) throw new Error("Device not registered for offline sync.");

      try {
        const api = axios.create({
          baseURL: BASE_API,
          timeout: 15000,
          headers: { Authorization: `Bearer ${token}` },
        });

        await api.post("/offline/export", {
          device_token: deviceToken,
          readings: [
            {
              meter_id: target.meter_id,
              reading_value: target.reading_value,
              lastread_date: target.lastread_date,
            },
          ],
        });

        const updated: OfflineScan[] = scans.map((s) =>
          s.id === id
            ? ({
                ...s,
                status: "approved" as const,
                error: undefined,
              } as OfflineScan)
            : s
        );
        await save(updated);
      } catch (e: any) {
        const errMsg =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          String(e);

        const updated: OfflineScan[] = scans.map((s) =>
          s.id === id
            ? ({
                ...s,
                status: "failed" as const,
                error: errMsg,
              } as OfflineScan)
            : s
        );
        await save(updated);
      }
    },
    [scans, deviceToken, save]
  );

  // export all pending/failed scans
  const approveAll: Ctx["approveAll"] = useCallback(
    async (token) => {
      const pending = scans.filter(
        (x) => x.status === "pending" || x.status === "failed"
      );
      if (!pending.length) return;

      if (!token) throw new Error("Missing auth token");
      if (!deviceToken) throw new Error("Device not registered for offline sync.");

      try {
        const api = axios.create({
          baseURL: BASE_API,
          timeout: 15000,
          headers: { Authorization: `Bearer ${token}` },
        });

        await api.post("/offline/export", {
          device_token: deviceToken,
          readings: pending.map((s) => ({
            meter_id: s.meter_id,
            reading_value: s.reading_value,
            lastread_date: s.lastread_date,
          })),
        });

        const updated: OfflineScan[] = scans.map((s) =>
          pending.some((p) => p.id === s.id)
            ? ({
                ...s,
                status: "approved" as const,
                error: undefined,
              } as OfflineScan)
            : s
        );
        await save(updated);
      } catch (e: any) {
        const errMsg =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          String(e);

        const updated: OfflineScan[] = scans.map((s) =>
          pending.some((p) => p.id === s.id)
            ? ({
                ...s,
                status: "failed" as const,
                error: errMsg,
              } as OfflineScan)
            : s
        );
        await save(updated);
      }
    },
    [scans, deviceToken, save]
  );

  const value: Ctx = useMemo(
    () => ({
      scans,
      isConnected,
      queueScan,
      removeScan,
      markPending,
      markApproved,
      approveOne,
      approveAll,
      reload,
      deviceToken,
      setDeviceTokenDirect, // ✅ NEW
      registerDevice,
    }),
    [
      scans,
      isConnected,
      queueScan,
      removeScan,
      markPending,
      markApproved,
      approveOne,
      approveAll,
      reload,
      deviceToken,
      setDeviceTokenDirect, // ✅ NEW
      registerDevice,
    ]
  );

  return (
    <ScanHistoryContext.Provider value={value}>
      {children}
    </ScanHistoryContext.Provider>
  );
}

export function useScanHistory() {
  const ctx = useContext(ScanHistoryContext);
  if (!ctx)
    throw new Error("useScanHistory must be used inside <ScanHistoryProvider>");
  return ctx;
}