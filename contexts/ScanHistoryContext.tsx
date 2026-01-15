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

  // optional extras (safe to keep; server may ignore)
  remarks?: string | null;
  image?: string | null; // base64 or uri depending on your flow
  meter_type?: string | null;
  tenant_name?: string | null;

  status: "pending" | "approved" | "failed";
  error?: string;
};

type Ctx = {
  scans: OfflineScan[];
  isConnected: boolean | null;

  queueScan: (
    s: Omit<OfflineScan, "id" | "createdAt" | "status" | "error">
  ) => Promise<void>;
  removeScan: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;

  markPending: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;

  /**
   * Export OFFLINE readings to server (requires device token).
   * On success: clears local storage (so device returns to 0 data).
   */
  syncOfflineReadings: (authToken: string | null, deviceToken: string) => Promise<void>;

  reload: () => Promise<void>;
};

const ScanHistoryContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "offline_scans_v1";

export function ScanHistoryProvider({ children }: { children: React.ReactNode }) {
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) =>
      setIsConnected(!!state.isConnected)
    );
    NetInfo.fetch().then((s) => setIsConnected(!!s.isConnected));
    return () => sub && sub();
  }, []);

  const reload = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setScans(raw ? JSON.parse(raw) : []);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(async (items: OfflineScan[]) => {
    setScans(items);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, []);

  const clearAll = useCallback(async () => {
    await save([]);
  }, [save]);

  const queueScan: Ctx["queueScan"] = useCallback(
    async (payload) => {
      const item: OfflineScan = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        meter_id: payload.meter_id,
        reading_value: payload.reading_value,
        lastread_date: payload.lastread_date,
        createdAt: new Date().toISOString(),

        remarks: payload.remarks ?? null,
        image: payload.image ?? null,
        meter_type: payload.meter_type ?? null,
        tenant_name: payload.tenant_name ?? null,

        status: "pending",
      };

      await save([item, ...scans]);
    },
    [save, scans]
  );

  const removeScan: Ctx["removeScan"] = useCallback(
    async (id) => {
      await save(scans.filter((s) => s.id !== id));
    },
    [save, scans]
  );

  const markPending: Ctx["markPending"] = useCallback(
    async (id) => {
      await save(
        scans.map((s) =>
          s.id === id ? { ...s, status: "pending", error: undefined } : s
        )
      );
    },
    [save, scans]
  );

  const markFailed: Ctx["markFailed"] = useCallback(
    async (id, error) => {
      await save(scans.map((s) => (s.id === id ? { ...s, status: "failed", error } : s)));
    },
    [save, scans]
  );

  const syncOfflineReadings: Ctx["syncOfflineReadings"] = useCallback(
    async (authToken, deviceToken) => {
      const toSend = scans.filter((x) => x.status === "pending" || x.status === "failed");
      if (!toSend.length) return;

      if (!deviceToken) {
        const msg = "Missing device token. Resolve/register this reader device first.";
        await save(scans.map((s) => ({ ...s, status: "failed", error: msg })));
        return;
      }

      try {
        const api = axios.create({
          baseURL: BASE_API,
          timeout: 30000,
          headers: { Authorization: `Bearer ${authToken ?? ""}` },
        });

        await api.post("/offlineExport/export", {
          device_token: deviceToken,
          readings: toSend.map((r) => ({
            meter_id: r.meter_id,
            reading_value: r.reading_value,
            lastread_date: r.lastread_date,
            remarks: r.remarks ?? null,
            image: r.image ?? null,

            // optional fields (server may ignore)
            meter_type: r.meter_type ?? null,
            tenant_name: r.tenant_name ?? null,
          })),
        });

        // ✅ your requirement: after export, clear device data
        await clearAll();
      } catch (e: any) {
        const err =
          e?.response?.data?.error ||
          e?.response?.data?.message ||
          e?.message ||
          String(e);

        // keep them but mark failed so user can retry
        await save(
          scans.map((s) =>
            s.status === "pending" || s.status === "failed"
              ? { ...s, status: "failed", error: err }
              : s
          )
        );
      }
    },
    [scans, save, clearAll]
  );

  const value: Ctx = useMemo(
    () => ({
      scans,
      isConnected,
      queueScan,
      removeScan,
      clearAll,
      markPending,
      markFailed,
      syncOfflineReadings,
      reload,
    }),
    [scans, isConnected, queueScan, removeScan, clearAll, markPending, markFailed, syncOfflineReadings, reload]
  );

  return <ScanHistoryContext.Provider value={value}>{children}</ScanHistoryContext.Provider>;
}

export function useScanHistory() {
  const ctx = useContext(ScanHistoryContext);
  if (!ctx) throw new Error("useScanHistory must be used inside <ScanHistoryProvider>");
  return ctx;
}