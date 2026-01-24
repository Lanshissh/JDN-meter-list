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

/**
 * Storage
 */
const STORAGE_KEY = "offline_scans_v1";

/**
 * ✅ For dashboard "To Read Today":
 * After a successful sync, we keep the scan records but mark them as "synced"
 * (instead of clearing everything). This way your dashboard can still count
 * today's completed meters even after syncing.
 */
export type OfflineScanStatus = "pending" | "synced" | "failed";

export type OfflineScan = {
  id: string; // local id
  meter_id: string;
  reading_value: number;
  lastread_date: string; // ✅ ALWAYS normalized to YYYY-MM-DD
  createdAt: string; // ISO when queued

  // optional extras (safe to keep; server may ignore)
  remarks?: string | null;
  image?: string | null; // base64 or uri depending on your flow
  meter_type?: string | null;
  tenant_name?: string | null;

  status: OfflineScanStatus;
  error?: string;
};

type Ctx = {
  scans: OfflineScan[];
  isConnected: boolean | null;

  /**
   * ✅ Will NOT duplicate the same meter for the same date.
   * If meter_id + lastread_date already exists, this becomes a no-op.
   */
  queueScan: (
    s: Omit<OfflineScan, "id" | "createdAt" | "status" | "error">
  ) => Promise<void>;

  removeScan: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;

  markPending: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;

  /**
   * Export OFFLINE readings to server (requires device token).
   * On success: marks items as "synced" (does not delete), and prunes old records.
   */
  syncOfflineReadings: (
    authToken: string | null,
    deviceToken: string
  ) => Promise<{ uploaded: number; kept: number }>;

  reload: () => Promise<void>;
};

const ScanHistoryContext = createContext<Ctx | null>(null);

function toYMD(input: any): string {
  if (input === null || input === undefined) return "";
  const s = String(input).trim();
  if (!s) return "";
  if (s.includes("T")) return s.split("T")[0];
  if (s.includes(" ")) return s.split(" ")[0];
  return s.slice(0, 10);
}

function isFiniteNumber(n: any) {
  return typeof n === "number" && Number.isFinite(n);
}

function daysBetween(a: Date, b: Date) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Keep only recent history so storage doesn't grow forever.
 * - Keep all scans from the last N days
 * - Also keep anything still pending/failed regardless (so user can retry)
 */
function pruneScans(scans: OfflineScan[], keepDays = 7): OfflineScan[] {
  const now = new Date();
  return scans.filter((s) => {
    if (s.status === "pending" || s.status === "failed") return true;
    const d = new Date(`${toYMD(s.lastread_date)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return true;
    return daysBetween(now, d) <= keepDays;
  });
}

export function ScanHistoryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  // ✅ better connectivity detection
  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      const ok =
        typeof state.isInternetReachable === "boolean"
          ? state.isInternetReachable
          : !!state.isConnected;
      setIsConnected(ok);
    });

    NetInfo.fetch().then((state) => {
      const ok =
        typeof state.isInternetReachable === "boolean"
          ? state.isInternetReachable
          : !!state.isConnected;
      setIsConnected(ok);
    });

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
    const pruned = pruneScans(items, 7);
    setScans(pruned);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  }, []);

  const clearAll = useCallback(async () => {
    await save([]);
  }, [save]);

  const queueScan: Ctx["queueScan"] = useCallback(
    async (payload) => {
      const meter_id = String(payload.meter_id ?? "").trim();
      const lastread_date = toYMD(payload.lastread_date);
      const reading_value = payload.reading_value;

      if (!meter_id || !lastread_date) return;
      if (!isFiniteNumber(reading_value)) return;

      // ✅ prevent duplicate meter+date queue (no overwrite / no double submit)
      const exists = scans.some(
        (s) => s.meter_id === meter_id && toYMD(s.lastread_date) === lastread_date
      );
      if (exists) return;

      const item: OfflineScan = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        meter_id,
        reading_value,
        lastread_date,
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
          s.id === id ? ({ ...s, status: "pending", error: undefined } as OfflineScan) : s
        )
      );
    },
    [save, scans]
  );

  const markFailed: Ctx["markFailed"] = useCallback(
    async (id, error) => {
      await save(
        scans.map((s) =>
          s.id === id ? ({ ...s, status: "failed", error } as OfflineScan) : s
        )
      );
    },
    [save, scans]
  );

  const syncOfflineReadings: Ctx["syncOfflineReadings"] = useCallback(
    async (authToken, deviceToken) => {
      const toSend = scans.filter(
        (x) => x.status === "pending" || x.status === "failed"
      );
      if (!toSend.length) return { uploaded: 0, kept: scans.length };

      if (!deviceToken) {
        const msg =
          "Missing device token. Resolve/register this reader device first.";
        await save(scans.map((s) => ({ ...s, status: "failed", error: msg } as OfflineScan)));
        return { uploaded: 0, kept: scans.length };
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
            // ✅ always YYYY-MM-DD to match server and dashboard
            lastread_date: toYMD(r.lastread_date),
            remarks: r.remarks ?? null,
            image: r.image ?? null,

            // optional
            meter_type: r.meter_type ?? null,
            tenant_name: r.tenant_name ?? null,
          })),
        });

        // ✅ IMPORTANT CHANGE:
        // Don't clear scans; mark the uploaded ones as "synced" so dashboard can still count done today.
        const sentKey = new Set(
          toSend.map((r) => `${r.meter_id}__${toYMD(r.lastread_date)}`)
        );

        // ✅ TS FIX: force exact OfflineScan[] output (prevents "status: string" widening)
        const next: OfflineScan[] = scans.map((s): OfflineScan => {
          const key = `${s.meter_id}__${toYMD(s.lastread_date)}`;
          if (sentKey.has(key)) {
            return {
              ...s,
              status: "synced",
              error: undefined,
            };
          }
          return s;
        });

        await save(next);

        return {
          uploaded: toSend.length,
          kept: next.length,
        };
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
              ? ({ ...s, status: "failed", error: err } as OfflineScan)
              : s
          )
        );

        return { uploaded: 0, kept: scans.length };
      }
    },
    [scans, save]
  );

  /**
   * OPTIONAL: cleanup of synced scans older than N days (kept via pruneScans).
   * This runs whenever scans change.
   */
  useEffect(() => {
    const pruned = pruneScans(scans, 7);
    if (pruned.length !== scans.length) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pruned)).catch(() => {});
      setScans(pruned);
    }
  }, [scans]);

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
    [
      scans,
      isConnected,
      queueScan,
      removeScan,
      clearAll,
      markPending,
      markFailed,
      syncOfflineReadings,
      reload,
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