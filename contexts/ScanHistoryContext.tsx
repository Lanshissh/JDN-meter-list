import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BASE_API } from "../constants/api";

export type OfflineScan = {
  id: string;               // local id
  meter_id: string;
  reading_value: number;
  lastread_date: string;    // YYYY-MM-DD
  createdAt: string;        // ISO when queued
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
};

const ScanHistoryContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "offline_scans_v1";

export function ScanHistoryProvider({ children }: { children: React.ReactNode }) {
  const [scans, setScans] = useState<OfflineScan[]>([]);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const sub = NetInfo.addEventListener(state => setIsConnected(!!state.isConnected));
    NetInfo.fetch().then(s => setIsConnected(!!s.isConnected));
    return () => sub && sub();
  }, []);

  const reload = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setScans(raw ? JSON.parse(raw) : []);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (items: OfflineScan[]) => {
    setScans(items);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, []);

  const queueScan: Ctx["queueScan"] = useCallback(async ({ meter_id, reading_value, lastread_date }) => {
    const item: OfflineScan = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      meter_id,
      reading_value,
      lastread_date,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    await save([item, ...scans]);
  }, [save, scans]);

  const removeScan: Ctx["removeScan"] = useCallback(async (id) => {
    await save(scans.filter(s => s.id !== id));
  }, [save, scans]);

  const markPending: Ctx["markPending"] = useCallback(async (id) => {
    await save(scans.map(s => s.id === id ? { ...s, status: "pending", error: undefined } : s));
  }, [save, scans]);

  const markApproved: Ctx["markApproved"] = useCallback(async (id) => {
    await save(scans.map(s => s.id === id ? { ...s, status: "approved", error: undefined } : s));
  }, [save, scans]);

  const approveOne: Ctx["approveOne"] = useCallback(async (id, token) => {
    const target = scans.find(s => s.id === id);
    if (!target) return;
    try {
      const api = axios.create({ baseURL: BASE_API, timeout: 15000, headers: { Authorization: `Bearer ${token ?? ""}` } });
      await api.post("/readings", {
        meter_id: target.meter_id,
        reading_value: target.reading_value,
        lastread_date: target.lastread_date,
      });
      await markApproved(id);
    } catch (e: any) {
      const err = e?.response?.data?.error || e?.response?.data?.message || e?.message || String(e);
      await save(scans.map(s => s.id === id ? { ...s, status: "failed", error: err } : s));
    }
  }, [scans, markApproved, save]);

  const approveAll: Ctx["approveAll"] = useCallback(async (token) => {
    for (const s of scans.filter(x => x.status === "pending" || x.status === "failed")) {
      await approveOne(s.id, token);
    }
  }, [scans, approveOne]);

  const value: Ctx = useMemo(() => ({
    scans,
    isConnected,
    queueScan,
    removeScan,
    markPending,
    markApproved,
    approveOne,
    approveAll,
    reload,
  }), [scans, isConnected, queueScan, removeScan, markPending, markApproved, approveOne, approveAll, reload]);

  return (
    <ScanHistoryContext.Provider value={value}>{children}</ScanHistoryContext.Provider>
  );
}

export function useScanHistory() {
  const ctx = useContext(ScanHistoryContext);
  if (!ctx) throw new Error("useScanHistory must be used inside <ScanHistoryProvider>");
  return ctx;
}