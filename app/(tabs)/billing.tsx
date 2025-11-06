// app/(tabs)/billing.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, FlatList, ScrollView, Platform, Modal
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import { LinearGradient } from 'expo-linear-gradient';

/* ==================== Types ==================== */
type MeterBillingLegacy = {
  meter_id: string;
  meter_type: string;
  stall_id?: string;
  current_index?: number | null;
  previous_index?: number | null;
  current_consumption?: number | null;
  previous_consumption?: number | null;
  charge?: number | null;
};
type TenantBillingLegacy = {
  tenant_id: string;
  end_date: string;
  meters: MeterBillingLegacy[];
  totals_by_type?: Record<string, { current_consumption: number; previous_consumption: number; charge: number; meters: number }>;
  grand_totals: { current_consumption: number; previous_consumption: number | null; charge: number; meters: number };
  generated_at: string;
};

/** ── NEW: Comparison payloads (from rateofchange.js) ───────────────────── */
type RocPeriod = { start: string; end: string };
type BuildingMonthlyTotals = {
  building_id: string;
  building_name?: string | null;
  period: { current: RocPeriod };
  totals: { electric: number; water: number; lpg: number };
};
type BuildingFourMonths = {
  building_id: string;
  building_name?: string | null;
  four_months: {
    periods: Array<{ month: string; start: string; end: string; totals: { electric: number; water: number; lpg: number } }>;
  };
};
// NEW: Yearly totals
type BuildingYearlyTotals = {
  building_id: string;
  building_name?: string | null;
  yearly: {
    year: string; // YYYY
    months: Array<{
      month: string; // YYYY-MM
      start: string; // 21 →
      end: string;   // → 20
      totals: { electric: number; water: number; lpg: number };
    }>;
  };
};
/** ─────────────────────────────────────────────────────────────────────── */

/* ==================== Utils ==================== */
const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number | string | null | undefined, digits = 2): string => {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
};
const peso = (n: number | string | null | undefined) => `₱ ${fmt(n, 2)}`;
const notify = (title: string, message?: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
};
const errorText = (err: unknown, fallback = "Server error.") => {
  const e = err as any;
  const status = e?.response?.status;
  const url = e?.config?.url;
  const data = e?.response?.data;
  let msg = "";
  if (typeof data === "string") msg = data;
  else if (data && typeof data === "object") {
    for (const k of ["error", "message", "detail", "msg", "reason"]) {
      if (typeof (data as any)[k] === "string") { msg = (data as any)[k]; break; }
    }
    if (!msg) { try { msg = JSON.stringify(data); } catch { msg = String(data); } }
  } else msg = e?.message || "";
  const parts: string[] = [];
  if (status) parts.push(`HTTP ${status}`);
  if (url) parts.push(url);
  if (msg) parts.push(msg);
  return parts.length ? parts.join(" — ") : fallback;
};
const penaltyQS = (rateStr: string): string => {
  const n = Number(rateStr);
  return Number.isFinite(n) && n >= 0 ? `?penalty_rate=${encodeURIComponent(String(n))}` : "";
};
const getSafe = async <T,>(api: ReturnType<typeof axios.create>, path: string, onError?: (s: string)=>void): Promise<T | null> => {
  try { const { data } = await api.get<T>(path); return data; }
  catch (e: any) { const msg = errorText(e); onError?.(msg); return null; }
};
const tryPaths = async (api: ReturnType<typeof axios.create>, paths: string[], setNote?: (s: string)=>void) => {
  const notes: string[] = [];
  for (const p of paths) {
    const data = await getSafe<any>(api, p, (m)=>{ notes.push(`✗ ${p}\n   ${m}`); setNote?.(m); });
    if (data) { const ok = `✓ ${p}`; notes.push(ok); setNote?.(ok); return { data, tried: p, notes }; }
  }
  throw new Error(notes.length ? notes.join("\n") : "No data returned by the backend.");
};

/* ---------- Date helpers ---------- */
function ymd(d: Date){return d.toISOString().slice(0,10);}
function lastDayOfMonth(y:number,m0:number){return new Date(y,m0+1,0).getDate();}
function parseYMD(s:string){ if(!isYMD(s)) return null; const [Y,M,D]=s.split("-").map(Number); const dt=new Date(Date.UTC(Y,M-1,D)); return isNaN(+dt)?null:dt; }
function buildEndDateCandidates(endDate: string): string[] {
  const base = parseYMD(endDate) ?? new Date();
  const Y = base.getUTCFullYear(); const M = base.getUTCMonth(); const last = lastDayOfMonth(Y, M);
  const prevY = M===0?Y-1:Y; const prevM = M===0?11:M-1; const prevLast = lastDayOfMonth(prevY, prevM);
  const list = [
    ymd(base),
    ymd(new Date(Date.UTC(Y, M, 20))),
    ymd(new Date(Date.UTC(Y, M, last))),
    ymd(new Date(Date.UTC(prevY, prevM, 20))),
    ymd(new Date(Date.UTC(prevY, prevM, prevLast))),
  ];
  return Array.from(new Set(list));
}

/* ---------- Numbers & ROC ---------- */
const normNum = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
function computeRoc(prev: number | null | undefined, curr: number | null | undefined): number | null {
  const p = prev == null ? null : Number(prev); const c = curr == null ? null : Number(curr);
  if (p == null || !isFinite(p) || p === 0 || c == null || !isFinite(c)) return null;
  return ((c - p) / p) * 100;
}

/* ==================== Component ==================== */
type Mode = "building" | "tenant" | "meter";
type Row = {
  tenant_id?: string | null;
  tenant_name?: string | null;
  meter_id: string;
  meter_sn?: string;
  meter_type?: string;
  stall_id?: string;
  mult?: number | null;
  prev_index?: number | null;
  curr_index?: number | null;
  prev_cons?: number | null;
  curr_cons?: number | null;
  base?: number | null;
  vat?: number | null;
  wt?: number | null;
  penalty?: number | null;
  total?: number | null;
  rate_of_change?: number | null;
  memo?: string | null;
  for_penalty?: boolean | null;
  utility_rate?: number | null;
  vat_rate?: number | null;
  system_rate?: number | null;
  wt_rate?: number | null;
  tax_code?: string | null;
  whtax_code?: string | null;
};

export default function BillingScreen() {
  const { token } = useAuth();
  const authHeader = useMemo(() => ({ Authorization: token ? `Bearer ${token}` : "" }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 30000 }), [authHeader]);

  // form
  const [mode, setMode] = useState<Mode>("building");
  const [buildingId, setBuildingId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [meterId, setMeterId] = useState("");
  const [endDate, setEndDate] = useState(today());
  const [penaltyRate, setPenaltyRate] = useState<string>("");

  // data
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{ consumption: number; base: number; vat: number; wt: number; penalty: number; total: number } | null>(null);
  const [myBuildings, setMyBuildings] = useState<string[]>([]);
  const [buildingElectricRate, setBuildingElectricRate] = useState<number | null>(null);
  const [vatMap, setVatMap] = useState<Record<string, number>>({});
  const [reportOpen, setReportOpen] = useState(false);

  /** ── Comparison states ─────────────────────────────────────────── */
  const [cmpMonthly, setCmpMonthly] = useState<BuildingMonthlyTotals | null>(null);
  const [cmpFour, setCmpFour] = useState<BuildingFourMonths | null>(null);
  const [cmpUtil, setCmpUtil] = useState<"electric" | "water" | "lpg">("electric");

  // NEW
  const [cmpMode, setCmpMode] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [cmpYearly, setCmpYearly] = useState<BuildingYearlyTotals | null>(null);

  // ROC endpoints may live under /rateofchange or /roc (we’ll try both).
  const ROC_BASES = ["/rateofchange", "/roc"];
  const getJSON = async <T,>(paths: string[]): Promise<T | null> => {
    for (const base of ROC_BASES) {
      for (const p of paths) {
        try {
          const { data } = await api.get<T>(`${base}${p}`);
          return data;
        } catch (e: any) {
          if ([401, 403].includes(e?.response?.status)) throw e;
        }
      }
    }
    return null;
  };
  const loadComparisonFor = async (building: string, end: string) => {
    setCmpMonthly(null); setCmpFour(null);
    const [m, f] = await Promise.all([
      getJSON<BuildingMonthlyTotals>([`/buildings/${encodeURIComponent(building)}/period-end/${encodeURIComponent(end)}/monthly-comparison`]),
      getJSON<BuildingFourMonths>([`/buildings/${encodeURIComponent(building)}/period-end/${encodeURIComponent(end)}/four-month-comparison`]),
    ]);
    setCmpMonthly(m || null);
    setCmpFour(f || null);
  };
  // NEW: yearly loader
  const loadYearlyFor = async (building: string, end: string) => {
    setCmpYearly(null);
    const year = (end || today()).slice(0, 4);
    const y = await getJSON<BuildingYearlyTotals>([
      `/buildings/${encodeURIComponent(building)}/year/${encodeURIComponent(year)}/yearly-comparison`,
    ]);
    setCmpYearly(y || null);
  };

  /* ---------- Load lists ---------- */
  const loadBuildings = async () => {
    setNote("");
    const list = await getSafe<any[]>(api, `/buildings`, (m)=>setNote(m));
    if (Array.isArray(list)) {
      const ids = list.map((b:any)=>String(b?.building_id||"")).filter(Boolean);
      setMyBuildings(ids);
      if (!buildingId && ids.length) setBuildingId(ids[0]);
      if (!ids.length) setNote("No buildings are visible to your account.");
    } else setNote("Could not load buildings for this account.");
  };

  /* ---------- Config helpers ---------- */
  const pickElectricRate = (b: any): number | null => {
    const cand = b?.electric_rate ?? b?.electric_kwh_rate ?? b?.kwh_rate ?? b?.rate_per_kwh ?? b?.utility_rate ?? b?.power_rate ?? null;
    return typeof cand === "number" && isFinite(cand) ? cand : null;
  };
  const loadBuildingRate = async (bid: string) => {
    setBuildingElectricRate(null);
    const candidates = [`/buildings/${encodeURIComponent(bid)}`, `/building/${encodeURIComponent(bid)}`, `/buildings?id=${encodeURIComponent(bid)}`];
    for (const p of candidates) {
      const data = await getSafe<any>(api, p);
      if (!data) continue;
      const obj = Array.isArray(data) ? data.find((x:any)=>x?.building_id===bid) ?? data[0] : data;
      const rate = pickElectricRate(obj);
      if (rate != null) { setBuildingElectricRate(rate); return; }
    }
  };
  const loadVatCodes = async () => {
    const paths = ["/vat", "/vats", "/vat-codes"];
    for (const p of paths) {
      const data = await getSafe<any>(api, p);
      if (!data) continue;
      const map: Record<string, number> = {};
      const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [data];
      for (const it of arr) {
        if (!it) continue;
        const code = (it.code ?? it.vat_code ?? it.tax_code ?? "").toString().trim();
        const pct = Number(it.percent ?? it.rate_percent ?? it.rate_pct ?? it.vat_percent ?? it.vat_rate ?? it.percent_rate);
        if (code && isFinite(pct)) map[code] = pct;
      }
      if (Object.keys(map).length) { setVatMap(map); return; }
    }
  };

  /* ---------- Derivers ---------- */
  const getEffectiveRate = (r: Row, md: Mode, buildingRate: number | null) =>
    (md === "building" ? buildingRate : null) ?? r.utility_rate ?? null;

  const getVatPctFor = (r: Row, vmap: Record<string, number>) => {
    if (r.vat_rate != null && isFinite(Number(r.vat_rate))) return Number(r.vat_rate);
    if (r.tax_code && vmap[r.tax_code] != null) return Number(vmap[r.tax_code]);
    return null;
  };

  const deriveAmounts = (r: Row, md: Mode, buildingRate: number | null, vmap: Record<string, number>): Row => {
    const effRate = getEffectiveRate(r, md, buildingRate);
    const base = (r.base != null && isFinite(Number(r.base))) ? Number(r.base) : (effRate != null && r.curr_cons != null && isFinite(Number(r.curr_cons))) ? Number(r.curr_cons) * Number(effRate) : null;
    const vatPct = getVatPctFor(r, vmap);
    const vat = (r.vat != null && isFinite(Number(r.vat))) ? Number(r.vat) : (base != null && vatPct != null) ? base * (vatPct / 100) : null;
    const wt = (r.wt != null && isFinite(Number(r.wt))) ? Number(r.wt) : null;
    const penalty = (r.penalty != null && isFinite(Number(r.penalty))) ? Number(r.penalty) : null;
    return { ...r, base, vat, wt, penalty };
  };

  /* ---------- Setters with derivation ---------- */
  const setRowsAndSummary = (incoming: Row[], totals?: { consumption?: number; base?: number; vat?: number; wt?: number; penalty?: number; total?: number } | null) => {
    const filled = incoming.map((r)=>deriveAmounts(r, mode, buildingElectricRate, vatMap));
    setRows(filled);
    if (totals) {
      const agg = filled.reduce((acc, r)=>{ acc.consumption+=Number(r.curr_cons??0); acc.base+=Number(r.base??0); acc.vat+=Number(r.vat??0); acc.wt+=Number(r.wt??0); acc.penalty+=Number(r.penalty??0); return acc; }, {consumption:0,base:0,vat:0,wt:0,penalty:0});
      setSummary({ consumption: Number(totals.consumption ?? agg.consumption), base: agg.base, vat: agg.vat, wt: agg.wt, penalty: agg.penalty, total: Number(totals.total ?? 0) });
    } else {
      const agg = filled.reduce((acc, r)=>{ acc.consumption+=Number(r.curr_cons??0); acc.base+=Number(r.base??0); acc.vat+=Number(r.vat??0); acc.wt+=Number(r.wt??0); acc.penalty+=Number(r.penalty??0); acc.total+=Number(r.total??0); return acc; }, {consumption:0,base:0,vat:0,wt:0,penalty:0,total:0});
      setSummary(agg);
    }
  };

  const extractGeneratedAt = (payload: any): string => {
    if (payload && typeof payload === "object" && !Array.isArray(payload) && "generated_at" in payload) return String(payload.generated_at ?? "");
    if (Array.isArray(payload)) {
      const hit = payload.find((x:any)=>x && typeof x === "object" && "generated_at" in x);
      if (hit) return String(hit.generated_at ?? "");
    }
    return "";
  };

  /* ---------- Parsers ---------- */
  const mapArrayishItem = (x: any): Row => {
    const m = (x.meter || x) as any;
    const b = (x.billing || {}) as any;
    const idx = (x.indices || {}) as any;
    const t = (x.tenant || {}) as any;
    const prev_from_payload = normNum(x.previous_consumption) ?? normNum(x?.totals?.previous_consumption) ?? normNum((x as any).previous_month_units) ?? normNum((x as any).prev_consumed_kwh) ?? normNum((x as any).previous_kwh) ?? normNum((x as any).previous_units) ?? null;
    const curr_cons = normNum(x.current_consumption) ?? normNum(x?.totals?.consumption) ?? normNum((x as any).current_month_units) ?? normNum((x as any).consumed_kwh);
    let roc = normNum(x.rate_of_change) ?? normNum(x.roc) ?? normNum((x as any).rate_of_change_pct) ?? normNum((x as any).rate_of_change_percent) ?? null;
    let prev_cons = prev_from_payload;
    if (prev_cons == null && roc != null && isFinite(roc) && roc > -100 && curr_cons != null && isFinite(Number(curr_cons))) {
      prev_cons = Number(curr_cons) / (1 + Number(roc) / 100);
      prev_cons = Math.round(prev_cons * 100) / 100;
    }
    if (roc == null) roc = computeRoc(prev_cons, curr_cons);
    return {
      tenant_id: t.tenant_id ?? (x.tenant_id ?? null),
      tenant_name: t.tenant_name ?? (x.tenant_name ?? null),
      meter_id: String(m.meter_id || x.meter_id || ""),
      meter_sn: m.meter_sn ?? x.meter_sn,
      meter_type: (m.meter_type ?? x.meter_type ?? "").toString().toLowerCase(),
      stall_id: x.stall?.stall_id ?? x.stall_id,
      mult: normNum(x.mult ?? x.multiplier),
      prev_index: idx.prev_index ?? x.previous_index ?? null,
      curr_index: idx.curr_index ?? x.current_index ?? null,
      prev_cons, curr_cons,
      base: normNum(b.base ?? x.base),
      vat: normNum(b.vat ?? x.vat),
      wt: normNum(b.wt ?? x.wt),
      penalty: normNum(b.penalty ?? x.penalty),
      total: normNum(b.total ?? x.total ?? x.charge),
      rate_of_change: roc,
      memo: x.memo ?? null,
      for_penalty: x.for_penalty ?? null,
      utility_rate: normNum(x.utility_rate ?? x.rate_per_kwh ?? x.kwh_rate),
      tax_code: (x.tax_code ?? x.vat_code ?? x.taxcode ?? null) ? String(x.tax_code ?? x.vat_code ?? x.taxcode) : null,
      vat_rate: normNum(x.vat_rate ?? x.vat_rate_pct ?? x.vat_percent ?? x.vat_pct),
      whtax_code: (x.whtax_code ?? x.wh_tax_code ?? x.withholding_code ?? x.wt_code ?? null) ? String(x.whtax_code ?? x.wh_tax_code ?? x.withholding_code ?? x.wt_code) : null,
    };
  };

  const mapBuildingTenantRow = (x: any, tenantId?: string | null, tenantName?: string | null): Row => {
    const prev_raw = normNum(x.prev_consumed_kwh) ?? normNum((x as any).previous_month_units) ?? normNum((x as any).previous_kwh) ?? normNum((x as any).previous_units) ?? normNum((x as any).previous_consumption) ?? null;
    const curr_cons = normNum(x.consumed_kwh) ?? normNum((x as any).current_month_units);
    let roc = normNum(x.rate_of_change_pct) ?? normNum((x as any).rate_of_change_percent) ?? null;
    let prev_cons = prev_raw;
    if (prev_cons == null && roc != null && isFinite(roc) && roc > -100 && curr_cons != null && isFinite(Number(curr_cons))) {
      prev_cons = Number(curr_cons) / (1 + Number(roc) / 100);
      prev_cons = Math.round(prev_cons * 100) / 100;
    }
    if (roc == null) roc = computeRoc(prev_cons, curr_cons);
    return {
      tenant_id: tenantId ?? x.tenant_id ?? null,
      tenant_name: tenantName ?? x.tenant_name ?? null,
      meter_id: String(x.meter_id || x.meter_no || ""),
      meter_sn: x.meter_no ?? undefined,
      meter_type: undefined,
      stall_id: x.stall_no ?? undefined,
      mult: normNum(x.mult ?? x.multiplier),
      prev_index: x.reading_previous ?? null,
      curr_index: x.reading_present ?? null,
      prev_cons, curr_cons,
      base: normNum(x.base),
      vat: normNum(x.vat),
      wt: normNum(x.wt),
      penalty: normNum(x.penalty),
      total: normNum(x.total_amount ?? x.total),
      rate_of_change: roc,
      memo: x.memo ?? null,
      for_penalty: x.for_penalty ?? null,
      utility_rate: normNum(x.utility_rate ?? x.rate_per_kwh ?? x.kwh_rate),
      tax_code: (x.tax_code ?? x.vat_code ?? null) ? String(x.tax_code ?? x.vat_code) : null,
      vat_rate: normNum(x.vat_rate ?? x.vat_rate_pct ?? x.vat_percent ?? x.vat_pct),
      whtax_code: (x.whtax_code ?? x.wh_tax_code ?? x.withholding_code ?? x.wt_code ?? null) ? String(x.whtax_code ?? x.wh_tax_code ?? x.withholding_code ?? x.wt_code) : null,
    };
  };

  const parsePayload = (data: any) => {
    const unwrap = (x: any) => (x && typeof x === "object" && "data" in x ? (x as any).data : x);
    const payload = unwrap(data);
    if (Array.isArray(payload?.meters) || Array.isArray(payload?.lines) || Array.isArray(payload)) {
      const list: any[] = Array.isArray(payload) ? payload : (payload.meters || payload.lines || []);
      const out: Row[] = list.map(mapArrayishItem).filter((r) => r.meter_id);
      const agg = list.reduce((acc: any, x: any) => {
        const b = x.billing || {};
        const curr = Number(x?.totals?.consumption ?? x.current_consumption ?? x.current_month_units ?? 0);
        acc.consumption += curr;
        acc.base += Number(b.base ?? 0);
        acc.vat += Number(b.vat ?? 0);
        acc.wt += Number(b.wt ?? 0);
        acc.penalty += Number(b.penalty ?? 0);
        acc.total += Number(b.total ?? x.total ?? x.charge ?? 0);
        return acc;
      }, { consumption: 0, base: 0, vat: 0, wt: 0, penalty: 0, total: 0 });
      setRowsAndSummary(out, agg);
      setGeneratedAt(extractGeneratedAt(payload));
      return;
    }
    if (payload && payload.tenant_id && Array.isArray(payload.meters)) {
      const p = payload as TenantBillingLegacy;
      const out: Row[] = p.meters.map((m) => ({
        tenant_id: p.tenant_id,
        meter_id: m.meter_id,
        meter_type: m.meter_type,
        stall_id: m.stall_id,
        prev_index: m.previous_index ?? null,
        curr_index: m.current_index ?? null,
        prev_cons: m.previous_consumption ?? null,
        curr_cons: m.current_consumption ?? null,
        total: m.charge ?? null,
      }));
      setRowsAndSummary(out, {
        consumption: Number(p.grand_totals?.current_consumption ?? 0),
        base: 0, vat: 0, wt: 0, penalty: 0,
        total: Number(p.grand_totals?.charge ?? 0),
      });
      setGeneratedAt(extractGeneratedAt(payload));
      return;
    }
    if (payload && Array.isArray(payload.tenants)) {
      const out: Row[] = [];
      for (const t of payload.tenants) {
        const tId = t?.tenant_id ?? null;
        const name = t?.tenant_name ?? null;
        const items: any[] = Array.isArray(t?.meters) ? t.meters : Array.isArray(t?.rows) ? t.rows : [];
        for (const x of items) out.push(mapBuildingTenantRow(x, tId, name));
      }
      const totals = payload.totals || null;
      setRowsAndSummary(out.filter((r) => r.meter_id), totals ? {
        consumption: Number(totals.total_consumed_kwh ?? totals.current_month_units ?? 0),
        base: 0, vat: 0, wt: 0, penalty: 0,
        total: Number(totals.total_amount ?? 0),
      } : null);
      setGeneratedAt(extractGeneratedAt(payload));
      return;
    }
    if (payload && (Array.isArray(payload.rows) || Array.isArray(payload.lines))) {
      const list: any[] = payload.rows || payload.lines || [];
      const out: Row[] = list.map((x: any) => mapBuildingTenantRow(x, x?.tenant_id ?? null, x?.tenant_name ?? null));
      const totals = payload.totals || null;
      setRowsAndSummary(out.filter((r) => r.meter_id), totals ? {
        consumption: Number(totals.total_consumed_kwh ?? totals.current_month_units ?? 0),
        base: 0, vat: 0, wt: 0, penalty: 0,
        total: Number(totals.total_amount ?? 0),
      } : null);
      setGeneratedAt(extractGeneratedAt(payload));
      return;
    }
    if (payload && typeof payload === "object") {
      const looksLikeBuildingRow = "meter_no" in payload || "stall_no" in payload || "consumed_kwh" in payload || "reading_present" in payload;
      const looksLikeArrayish = "meter" in payload || "billing" in payload || "indices" in payload;
      if (looksLikeBuildingRow || looksLikeArrayish) {
        const row: Row = looksLikeBuildingRow ? mapBuildingTenantRow(payload, (payload as any)?.tenant_id ?? null, (payload as any)?.tenant_name ?? null) : mapArrayishItem(payload);
        setRowsAndSummary([row], null);
        setGeneratedAt(extractGeneratedAt(payload));
        return;
      }
      const firstArrayKey = Object.keys(payload).find((k) => Array.isArray((payload as any)[k]));
      if (firstArrayKey) {
        const arr: any[] = (payload as any)[firstArrayKey];
        if (arr.length && typeof arr[0] === "object") {
          const out: Row[] = arr.map((x) => {
            const hasBuildingRowHints = x && (x.meter_no || x.stall_no || x.consumed_kwh || x.reading_present);
            return hasBuildingRowHints ? mapBuildingTenantRow(x, x?.tenant_id ?? null, x?.tenant_name ?? null) : mapArrayishItem(x);
          });
          setRowsAndSummary(out.filter((r) => r.meter_id), null);
          setGeneratedAt(extractGeneratedAt(payload));
          return;
        }
      }
    }
    throw new Error("Unrecognized billing payload format");
  };

  /* ---------- Tenant & Meter helpers ---------- */
  const getTenantBillingFor = async (tenant: string, end: string, qs: string) => {
    const paths = [
      `/billings/tenants/${encodeURIComponent(tenant)}/period-end/${encodeURIComponent(end)}${qs}`,
      `/billings/with-markup/tenants/${encodeURIComponent(tenant)}/period-end/${encodeURIComponent(end)}${qs}`,
      `/billings/tenant/${encodeURIComponent(tenant)}/${encodeURIComponent(end)}${qs}`,
    ];
    try { const { data } = await tryPaths(api, paths); return data; } catch { return null; }
  };

  const getMeterBillingFor = async (meter: string, end: string, qs: string) => {
    const paths = [
      `/billings/meters/${encodeURIComponent(meter)}/period-end/${encodeURIComponent(end)}${qs}`,
      `/billings/meter/${encodeURIComponent(meter)}/${encodeURIComponent(end)}${qs}`,
      `/billings/with-markup/meters/${encodeURIComponent(meter)}/period-end/${encodeURIComponent(end)}${qs}`,
    ];
    const { data } = await tryPaths(api, paths, (m)=>setNote(m));
    return data;
  };

  const fetchTenantIdsForBuilding = async (building: string): Promise<string[]> => {
    const candidates = [
      `/buildings/${encodeURIComponent(building)}/tenants`,
      `/tenants?building_id=${encodeURIComponent(building)}`,
      `/tenants/of/${encodeURIComponent(building)}`,
    ];
    for (const p of candidates) {
      const data = await getSafe<any>(api, p);
      if (Array.isArray(data)) {
        const ids = data.map((t:any)=> (typeof t === "string" ? t : t?.tenant_id)).filter((x:any)=> typeof x === "string" && x.length>0);
        if (ids.length) return ids;
      }
    }
    return [];
  };

  const aggregateBuildingViaTenants = async (building: string, end: string, qs: string) => {
    const tenantIds = await fetchTenantIdsForBuilding(building);
    if (!tenantIds.length) throw new Error("No tenants found for this building (fallback).");
    const collected: Row[] = [];
    for (const tid of tenantIds) {
      const data = await getTenantBillingFor(tid, end, qs);
      if (!data) continue;
      if (Array.isArray(data?.meters) || Array.isArray(data?.lines) || Array.isArray(data)) {
        collected.push(...(Array.isArray(data) ? data : (data.meters || data.lines)).map(mapArrayishItem));
      } else if (data && data.tenant_id && Array.isArray(data.meters)) {
        const p = data as TenantBillingLegacy;
        collected.push(...p.meters.map((m)=>({
          tenant_id: p.tenant_id,
          meter_id: m.meter_id,
          meter_type: m.meter_type,
          stall_id: m.stall_id,
          prev_index: m.previous_index ?? null,
          curr_index: m.current_index ?? null,
          prev_cons: m.previous_consumption ?? null,
          curr_cons: m.current_consumption ?? null,
          total: m.charge ?? null,
        })));

      } else if (data && Array.isArray(data.tenants)) {
        for (const t of data.tenants) {
          const tId = t?.tenant_id ?? null; const name = t?.tenant_name ?? null;
          const items: any[] = Array.isArray(t?.meters) ? t.meters : Array.isArray(t?.rows) ? t.rows : [];
          for (const x of items) collected.push(mapBuildingTenantRow(x, tId, name));
        }
      }
    }
    if (!collected.length) throw new Error("No tenant billing data found for this date (fallback).");
    setRowsAndSummary(collected.filter(r=>r.meter_id), null);
    setNote((prev) => (prev ? prev + "\n" : "") + "(Fallback: aggregated via tenants)");
    setGeneratedAt(extractGeneratedAt(collected));
  };

  /* ---------- Generate ---------- */
  const onGenerate = async () => {
    setBusy(true); setError(""); setNote(""); setRows([]); setSummary(null); setGeneratedAt("");
    setCmpMonthly(null); setCmpFour(null); setCmpYearly(null); // reset comparison each run
    try {
      if (!endDate || !isYMD(endDate)) throw new Error("Please enter a valid End Date (YYYY-MM-DD).");
      const qs = penaltyQS(penaltyRate);
      await loadVatCodes();
      if (mode === "building") {
        if (!buildingId) throw new Error("Please enter a Building ID.");
        await loadBuildingRate(buildingId);
        const candidates = buildEndDateCandidates(endDate);
        const notesAll: string[] = [];
        let ok = false;
        let usedEnd = endDate;                       // track which date succeeded to mirror comparison calls
        for (const cand of candidates) {
          const paths = [
            `/billings/buildings/${encodeURIComponent(buildingId)}/period-end/${encodeURIComponent(cand)}${qs}`,
            `/billings/with-markup/buildings/${encodeURIComponent(buildingId)}/period-end/${encodeURIComponent(cand)}${qs}`,
          ];
          try {
            const { data, notes } = await tryPaths(api, paths, (m)=>setNote(m));
            if (notes && notes.length) notesAll.push(...notes.map(n=>`[${cand}] ${n}`));
            setNote(notesAll.join("\n"));
            parsePayload(data);
            usedEnd = cand;
            if (cand !== endDate) setEndDate(cand);
            ok = true;
            break;
          } catch (e:any) {
            notesAll.push(`[${cand}] ${String(e?.message || e)}`);
            setNote(notesAll.join("\n"));
          }
        }
        if (!ok) {
          setNote((prev)=> (prev?prev+"\n":"") + "Building endpoint returned no readings. Trying tenant aggregation…");
          await aggregateBuildingViaTenants(buildingId, endDate, qs);
          usedEnd = endDate;
        }
        // Load comparison datasets for the exact period that was used
        await loadComparisonFor(buildingId, usedEnd);
        await loadYearlyFor(buildingId, usedEnd);
        return;
      }
      if (mode === "tenant") {
        if (!tenantId) throw new Error("Please enter a Tenant ID.");
        const paths = [
          `/billings/tenants/${encodeURIComponent(tenantId)}/period-end/${encodeURIComponent(endDate)}${qs}`,
          `/billings/with-markup/tenants/${encodeURIComponent(tenantId)}/period-end/${encodeURIComponent(endDate)}${qs}`,
          `/billings/tenant/${encodeURIComponent(tenantId)}/${encodeURIComponent(endDate)}${qs}`,
        ];
        const { data, notes } = await tryPaths(api, paths, (m)=>setNote(m));
        if (notes && notes.length) setNote(notes.join("\n"));
        parsePayload(data);
        return;
      }
      if (!meterId) throw new Error("Please enter a Meter ID.");
      const data = await getMeterBillingFor(meterId, endDate, qs);
      parsePayload(data);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Export helpers ---------- */
  const toCsv = (rows: Array<Record<string, string | number | boolean | null | undefined>>): string => {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    const esc = (v:any) => { if (typeof v==="boolean") return v?"TRUE":"FALSE"; const s=v==null?"":String(v); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
    const lines = [headers.join(",")];
    for (const r of rows) lines.push(headers.map((h)=>esc(r[h])).join(","));
    return lines.join("\n");
  };
  const downloadBlob = (filename: string, data: string, mime="text/plain;charset=utf-8;") => {
    if (Platform.OS === "web") {
      const blob = new Blob([data], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } else notify("Download is available on web.");
  };
  const tenantReportLabel = (r: Row) => {
    const id = r.tenant_id ?? "";
    const nm = r.tenant_name ?? "";
    if (id && nm) return `${id} — ${nm}`;
    return id || nm || "";
  };

  const computePhp10AndVat = (r: Row) => {
    const effRate = (mode === "building" ? buildingElectricRate : null) ?? (r.utility_rate ?? null);
    const php10 = effRate != null && r.curr_cons != null ? Number(r.curr_cons) * Number(effRate) : null;
    const vatPct = r.vat_rate != null ? Number(r.vat_rate) : (r.tax_code && vatMap[r.tax_code] != null ? Number(vatMap[r.tax_code]) : null);
    const vatAmt = php10 != null && vatPct != null ? php10 * (vatPct / 100) : null;
    return { php10, vatAmt, vatPct };
  };

// helper: safe number
const num = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

const exportCsv = () => {
  if (!rows.length) {
    notify("Nothing to export", "Generate a report first.");
    return;
  }

  type RowMaybeRates = Row & {
    system_rate?: number | null;
    base?: number | null;
    vat?: number | null;
    wt?: number | null;
    vat_rate?: number | null;
    wt_rate?: number | null;
    tax_code?: string | null;
    whtax_code?: string | null;
  };

  const computeBase = (r: RowMaybeRates): number | null => {
    return num(r.base) ??
      (num(r.system_rate) != null && num(r.curr_cons) != null
        ? num(r.system_rate)! * num(r.curr_cons)!
        : null);
  };

  const computeVatAmtLocal = (r: RowMaybeRates): number | null => {
    if (num(r.vat) != null) return num(r.vat)!;
    const base = computeBase(r);
    return base != null && num(r.vat_rate) != null ? base * num(r.vat_rate)! : null;
  };

  const computeWtAmtLocal = (r: RowMaybeRates): number | null => {
    if (num(r.wt) != null) return num(r.wt)!;
    const base = computeBase(r);
    return base != null && num(r.wt_rate) != null ? base * num(r.wt_rate)! : null;
  };

  const records = rows.map((row) => {
    const r = row as RowMaybeRates;
    const { php10 } = computePhp10AndVat(r);
    const vatAmt = computeVatAmtLocal(r);
    const wtAmt  = computeWtAmtLocal(r);

    return {
      "STALL NO.": r.stall_id ?? "",
      "TENANTS / VENDORS": tenantReportLabel(r),
      "METER NO.": r.meter_sn ?? r.meter_id,
      MULT: r.mult ?? "",
      "READING PREVIOUS": r.prev_index ?? "",
      "READING PRESENT": r.curr_index ?? "",
      "CONSUMED kWhr": r.curr_cons ?? "",
      VAT: vatAmt != null ? fmt(vatAmt, 2) : "",
      WT: wtAmt  != null ? fmt(wtAmt, 2) : "",
      "Php 10/kwhr": php10 != null ? fmt(php10, 2) : "",
      TOTAL: r.total ?? "",
      "CONSUMED kWhr (Jan.)": r.prev_cons ?? "",
      "Rate of Change": r.rate_of_change != null ? `${fmt(r.rate_of_change, 0)}%` : "",
      "TAX CODE": r.tax_code ?? "",
      "WHTAX CODE": r.whtax_code ?? "",
      MEMO: r.memo ?? "",
      PENALTY: r.for_penalty ? "TRUE" : "",
    };
  });

  const fn =
    mode === "building"
      ? `billing_${buildingId}_${endDate}.csv`
      : mode === "tenant"
      ? `billing_${tenantId}_${endDate}.csv`
      : `billing_${meterId}_${endDate}.csv`;

  const csv = toCsv(records as any[]);
  downloadBlob(fn, csv, "text/csv;charset=utf-8;");
};

// local helpers so we can safely derive WT if needed
type RowMaybeRates = Row & {
  system_rate?: number | null;
  wt_rate?: number | null;
  base?: number | null;
  wt?: number | null;
  vat?: number | null;
  tax_code?: string | null;
  whtax_code?: string | null;
};

const deriveBase = (r: RowMaybeRates) => {
  if (num(r.base) != null) return num(r.base)!;
  if (num(r.system_rate) != null && num(r.curr_cons) != null) {
    return num(r.system_rate)! * num(r.curr_cons)!;
  }
  const total = num(r.total);
  const vat = num(r.vat) ?? 0;
  const wt = num(r.wt) ?? 0;
  const pen = num((r as any).penalty) ?? 0;
  if (total != null) return Math.max(0, total - vat - wt - pen);
  return null;
};

const deriveWt = (r: RowMaybeRates, base: number | null) => {
  if (num(r.wt) != null) return num(r.wt)!;
  if (base != null && num(r.wt_rate) != null) return base * num(r.wt_rate)!;
  return null;
};

const exportHtmlReport = () => {
  if (!rows.length) { notify("Nothing to export", "Generate a report first."); return; }

  // unique local helpers (no name collisions)
  const toNum = (v: any): number | null =>
    v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

  type RowMaybeRates = Row & {
    system_rate?: number | null;
    base?: number | null;
    vat?: number | null;
    wt?: number | null;
    vat_rate?: number | null;
    wt_rate?: number | null;
    tax_code?: string | null;
    whtax_code?: string | null;
  };

  const deriveBaseForHtml = (r: RowMaybeRates) => {
    if (toNum(r.base) != null) return toNum(r.base)!;
    if (toNum(r.system_rate) != null && toNum(r.curr_cons) != null) {
      return toNum(r.system_rate)! * toNum(r.curr_cons)!;
    }
    const total = toNum(r.total);
    const vat = toNum(r.vat) ?? 0;
    const wt  = toNum(r.wt)  ?? 0;
    const pen = toNum((r as any).penalty) ?? 0;
    if (total != null) return Math.max(0, total - vat - wt - pen);
    return null;
  };

  // ✅ VAT: prefer r.vat; else base × vat_rate (distinct from WT)
  const deriveVatForHtml = (r: RowMaybeRates, base: number | null) => {
    if (toNum(r.vat) != null) return toNum(r.vat)!;
    if (base != null && toNum(r.vat_rate) != null) return base * toNum(r.vat_rate)!;
    return null;
  };

  // ✅ WT: prefer r.wt; else base × wt_rate
  const deriveWtForHtml = (r: RowMaybeRates, base: number | null) => {
    if (toNum(r.wt) != null) return toNum(r.wt)!;
    if (base != null && toNum(r.wt_rate) != null) return base * toNum(r.wt_rate)!;
    return null;
  };

  // Charges has VAT + WT + Php10 + TOTAL
  const header = `<tr>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">STALL<br/>NO.</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">TENANTS / VENDORS</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">METER<br/>NO.</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">MULT</th>
  <th colspan="2" style="border:1px solid #bbb;padding:6px;">READING</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">CONSUMED<br/>kWhr</th>
  <th colspan="4" style="border:1px solid #bbb;padding:6px;">Charges</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">CONSUMED<br/>kWhr (Last Mo.)</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">Rate of change</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">TAX CODE</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">WHTAX CODE</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">MEMO</th>
  <th rowspan="2" style="border:1px solid #bbb;padding:6px;">PENALTY</th>
</tr>
<tr>
  <th style="border:1px solid #bbb;padding:6px;">PREVIOUS</th>
  <th style="border:1px solid #bbb;padding:6px;">PRESENT</th>
  <th style="border:1px solid #bbb;padding:6px;">VAT</th>
  <th style="border:1px solid #bbb;padding:6px;">WT</th>
  <th style="border:1px solid #bbb;padding:6px;">Php 10/kwhr</th>
  <th style="border:1px solid #bbb;padding:6px;">TOTAL</th>
</tr>`;

  let totalVat = 0, totalWt = 0, totalPhp10 = 0;

  const rowsHtml = rows.map((row) => {
    const r = row as RowMaybeRates;
    const roc = r.rate_of_change;
    const rocHtml = roc == null ? "" : `<span style="color:#c1121f;font-weight:700;">${fmt(roc, 0)}%</span>`;

    const base  = deriveBaseForHtml(r);
    const vatAmt = deriveVatForHtml(r, base);           // distinct VAT
    const wtAmt  = deriveWtForHtml(r, base);

    // Php10: try your existing helper; fallback to kWh*10
    let php10: number | null = null;
    try { const m:any = (computePhp10AndVat as any)(r); if (m && m.php10 != null) php10 = Number(m.php10); } catch {}
    if (php10 == null && (r.curr_cons != null && !isNaN(Number(r.curr_cons)))) php10 = Number(r.curr_cons) * 10;

    if (vatAmt != null) totalVat += vatAmt;
    if (wtAmt  != null) totalWt  += wtAmt;
    if (php10  != null) totalPhp10 += php10;

    return `<tr>
      <td style="border:1px solid #ddd;padding:6px;">${r.stall_id ?? ""}</td>
      <td style="border:1px solid #ddd;padding:6px;">${tenantReportLabel(r)}</td>
      <td style="border:1px solid #ddd;padding:6px;">${r.meter_sn ?? r.meter_id}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${r.mult ?? ""}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${fmt(r.prev_index, 2)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${fmt(r.curr_index, 2)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${fmt(r.curr_cons, 2)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${vatAmt != null ? peso(vatAmt) : ""}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${wtAmt  != null ? peso(wtAmt)  : ""}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${php10  != null ? peso(php10)  : ""}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;font-weight:700;">${peso(r.total ?? 0)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${fmt(r.prev_cons, 2)}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${rocHtml}</td>
      <td style="border:1px solid #ddd;padding:6px;">${r.tax_code ?? ""}</td>
      <td style="border:1px solid #ddd;padding:6px;">${r.whtax_code ?? ""}</td>
      <td style="border:1px solid #ddd;padding:6px;">${r.memo ?? ""}</td>
      <td style="border:1px solid #ddd;padding:6px;">${r.for_penalty ? "TRUE" : ""}</td>
    </tr>`;
  }).join("\n");

  const totalPrevCons = rows.reduce((s, r) => s + Number(r.prev_cons ?? 0), 0);
  const totalCurrCons = summary?.consumption ?? rows.reduce((s, r) => s + Number(r.curr_cons ?? 0), 0);
  const totalAmt      = summary?.total ?? rows.reduce((s, r) => s + Number(r.total ?? 0), 0);

  const sumHtml = `
  <tr>
    <td colspan="6" style="border:1px solid #bbb;padding:6px;font-weight:700;text-align:center;">TOTAL OF ALL CONSUMED kWhr</td>
    <td style="border:1px solid #bbb;padding:6px;text-align:right;font-weight:700;">${fmt(totalCurrCons, 2)}</td>
    <td style="border:1px solid #bbb;padding:6px;text-align:right;font-weight:700;">${peso(totalVat)}</td>
    <td style="border:1px solid #bbb;padding:6px;text-align:right;font-weight:700;">${peso(totalWt)}</td>
    <td style="border:1px solid #bbb;padding:6px;text-align:right;font-weight:700;">${peso(totalPhp10)}</td>
    <td style="border:1px solid #bbb;padding:6px;text-align:right;font-weight:700;">${peso(totalAmt)}</td>
    <td colspan="6" style="border:1px solid #bbb;padding:6px;"></td>
  </tr>
  <tr>
    <td colspan="11" style="border:1px solid #bbb;padding:6px;"></td>
    <td style="border:1px solid #bbb;padding:6px;text-align:right;font-weight:700;">${fmt(totalPrevCons, 2)}</td>
    <td colspan="5" style="border:1px solid #bbb;padding:6px;text-align:center;font-weight:700;">TOTAL OF ALL CONSUMED kWhr LAST MONTH</td>
  </tr>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Billing Report</title>
</head>
<body>
<h4 style="font-family:Arial;margin:4px 0;">KILOWATT HOUR (ELECTRICAL) CONSUMPTION</h4>
<p style="font-family:Arial;margin:0 0 8px 0;color:#444;">For the Period ending ${endDate}</p>
<table style="border-collapse:collapse;font-family:Arial;font-size:12px;">
  <thead>${header}</thead>
  <tbody>
  ${rowsHtml}
  ${sumHtml}
  </tbody>
</table>
<p style="font-family:Arial;color:#555;">Generated at: ${generatedAt || new Date().toISOString()}</p>
</body></html>`;

  const fn =
    mode === "building" ? `billing_${buildingId}_${endDate}.html`
    : mode === "tenant" ? `billing_${tenantId}_${endDate}.html`
    : `billing_${meterId}_${endDate}.html`;

  downloadBlob(fn, html, "text/html;charset=utf-8;");
};

// NEW: Export Comparison CSV (Monthly / Quarterly / Yearly)
const exportComparisonCsv = () => {
  if (mode !== "building") {
    notify("Export comparison is only available in the per-building report.");
    return;
  }

  const rowsOut: Array<Record<string, any>> = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let filename = `comparison-${buildingId || "building"}-${cmpMode}-${stamp}.csv`;

  if (cmpMode === "monthly") {
    if (!cmpMonthly) { notify("Nothing to export", "No monthly totals were loaded."); return; }
    const p = cmpMonthly.period?.current;
    rowsOut.push({
      scope: "Monthly (current window)",
      window_start: p?.start ?? "",
      window_end: p?.end ?? "",
      electric_units: cmpMonthly.totals.electric,
      water_units: cmpMonthly.totals.water,
      lpg_units: cmpMonthly.totals.lpg,
    });
  }

  if (cmpMode === "quarterly") {
    if (!cmpFour) { notify("Nothing to export", "No four-month comparison was loaded."); return; }
    for (const m of (cmpFour.four_months?.periods || [])) {
      rowsOut.push({
        scope: "Quarterly (rolling 21→20)",
        month: m.month,
        window_start: m.start,
        window_end: m.end,
        electric_units: m.totals.electric,
        water_units: m.totals.water,
        lpg_units: m.totals.lpg,
      });
    }
  }

  if (cmpMode === "yearly") {
    if (!cmpYearly || !cmpYearly.yearly?.months?.length) {
      notify("Nothing to export", "No yearly comparison was loaded.");
      return;
    }
    filename = `comparison-${buildingId || "building"}-${cmpYearly.yearly.year}-${stamp}.csv`;
    for (const m of cmpYearly.yearly.months) {
      rowsOut.push({
        scope: `Yearly ${cmpYearly.yearly.year}`,
        month: m.month,
        window_start: m.start,
        window_end: m.end,
        electric_units: m.totals.electric,
        water_units: m.totals.water,
        lpg_units: m.totals.lpg,
      });
    }
  }

  if (!rowsOut.length) { notify("Nothing to export"); return; }
  downloadBlob(filename, toCsv(rowsOut), "text/csv;charset=utf-8;");
};


  /* ==================== UI ==================== */
  const Header = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.title}>Billing Analytics</Text>
          <Text style={styles.subtitle}>Generate comprehensive billing reports</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="analytics" size={28} color="#6366f1" />
        </View>
      </View>
      <View style={styles.modeSwitch}>
        <TouchableOpacity style={[styles.modeBtn, mode === "building" && styles.modeBtnActive]} onPress={() => setMode("building")}>
          <Ionicons name="business" size={18} color={mode === "building" ? "#fff" : "#64748b"} />
          <Text style={[styles.modeBtnText, mode === "building" && styles.modeBtnTextActive]}>Building</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === "tenant" && styles.modeBtnActive]} onPress={() => setMode("tenant")}>
          <Ionicons name="person" size={18} color={mode === "tenant" ? "#fff" : "#64748b"} />
          <Text style={[styles.modeBtnText, mode === "tenant" && styles.modeBtnTextActive]}>Tenant</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeBtn, mode === "meter" && styles.modeBtnActive]} onPress={() => setMode("meter")}>
          <Ionicons name="speedometer" size={18} color={mode === "meter" ? "#fff" : "#64748b"} />
          <Text style={[styles.modeBtnText, mode === "meter" && styles.modeBtnTextActive]}>Meter</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const Controls = () => (
    <View style={styles.controls}>
      {mode === "building" && (
        <View style={styles.field}>
          <Text style={styles.label}>Building ID</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="business-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput value={buildingId} onChangeText={setBuildingId} placeholder="e.g. BLDG-1" style={styles.input} autoCapitalize="characters" placeholderTextColor="#cbd5e1" />
          </View>
          <TouchableOpacity style={styles.btnMini} onPress={loadBuildings}>
            <Ionicons name="refresh" size={16} color="#6366f1" />
            <Text style={styles.btnTextMini}>Load Buildings</Text>
            {!!myBuildings.length && <View style={styles.badge}><Text style={styles.badgeText}>{myBuildings.length}</Text></View>}
          </TouchableOpacity>
          {!!myBuildings.length && (
            <View style={styles.chipsWrap}>
              {myBuildings.map((id) => (
                <TouchableOpacity key={id} onPress={() => setBuildingId(id)} style={[styles.chip, buildingId === id && styles.chipActive]}>
                  <Text style={[styles.chipText, buildingId === id && styles.chipTextActive]}>{id}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {mode === "tenant" && (
        <View style={styles.field}>
          <Text style={styles.label}>Tenant ID</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="person-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput value={tenantId} onChangeText={setTenantId} placeholder="e.g. TNT-1" style={styles.input} autoCapitalize="characters" placeholderTextColor="#cbd5e1" />
          </View>
        </View>
      )}

      {mode === "meter" && (
        <View style={styles.field}>
          <Text style={styles.label}>Meter ID</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="speedometer-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput value={meterId} onChangeText={setMeterId} placeholder="e.g. MTR-1" style={styles.input} autoCapitalize="characters" placeholderTextColor="#cbd5e1" />
          </View>
        </View>
      )}

      <View style={styles.row}>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.label}>Period End Date</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="calendar-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" style={styles.input} autoCapitalize="none" placeholderTextColor="#cbd5e1" />
          </View>
        </View>
        <View style={[styles.field, { width: 140, marginLeft: 12 }]}>
          <Text style={styles.label}>Penalty Rate %</Text>
          <View style={styles.inputWrapper}>
            <Ionicons name="warning-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
            <TextInput value={penaltyRate} onChangeText={setPenaltyRate} placeholder="0.00" style={styles.input} keyboardType="numeric" placeholderTextColor="#cbd5e1" />
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onGenerate} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" size="small" /> : (
            <>
              <Ionicons name="flash" size={20} color="#fff" />
              <Text style={styles.btnText}>Generate Report</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={exportCsv} disabled={!rows.length}>
          <Ionicons name="document-text" size={20} color="#6366f1" />
          <Text style={[styles.btnText, styles.btnTextSecondary]}>Export CSV</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => setReportOpen(true)} disabled={!rows.length}>
          <Ionicons name="open" size={20} color="#6366f1" />
          <Text style={[styles.btnText, styles.btnTextSecondary]}>HTML Report</Text>
        </TouchableOpacity>

        {/* NEW: Comparison export controls (only for building mode) */}
        {mode === "building" && (
          <View style={{ flexBasis: "100%", height: 0 }} />
        )}
        {mode === "building" && (
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap", width: "100%" }}>
            <TouchableOpacity onPress={() => setCmpMode("monthly")} style={[styles.chip, cmpMode === "monthly" && styles.chipActive]}>
              <Text style={[styles.chipText, cmpMode === "monthly" && styles.chipTextActive]}>Monthly</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCmpMode("quarterly")} style={[styles.chip, cmpMode === "quarterly" && styles.chipActive]}>
              <Text style={[styles.chipText, cmpMode === "quarterly" && styles.chipTextActive]}>Quarterly</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCmpMode("yearly")} style={[styles.chip, cmpMode === "yearly" && styles.chipActive]}>
              <Text style={[styles.chipText, cmpMode === "yearly" && styles.chipTextActive]}>Yearly</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, styles.btnSecondary, { flexGrow: 1 }]} onPress={exportComparisonCsv}>
              <Ionicons name="download-outline" size={20} color="#6366f1" />
              <Text style={[styles.btnText, styles.btnTextSecondary]}>Export Comparison CSV</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {!!error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={20} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {!!note && !error && (
        <View style={styles.noteBox}>
          <Ionicons name="information-circle" size={20} color="#3b82f6" />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      )}
      {!!generatedAt && (
        <View style={styles.timestampBox}>
          <Ionicons name="time-outline" size={16} color="#64748b" />
          <Text style={styles.timestampText}>Generated: {generatedAt}</Text>
        </View>
      )}
    </View>
  );

  const RocText = ({ value }: { value: number | null | undefined }) =>
    value == null ? <Text style={styles.rowVal}>—</Text> :
    <View style={styles.rocBadge}>
      <Text style={styles.rocText}>{fmt(value, 0)}%</Text>
    </View>;

  const RowItem = ({ item }: { item: Row }) => (
    <View style={styles.rowItem}>
      <View style={styles.rowHeader}>
        <View style={styles.meterInfo}>
          <View style={styles.meterIconBox}>
            <Ionicons name="speedometer" size={20} color="#6366f1" />
          </View>
          <View style={styles.meterDetails}>
            <Text style={styles.meterIdText}>{item.meter_id}</Text>
            {item.meter_sn && <Text style={styles.meterSn}>SN: {item.meter_sn}</Text>}
          </View>
        </View>
        {item.stall_id && (
          <View style={styles.stallBadge}>
            <Text style={styles.stallText}>{item.stall_id}</Text>
          </View>
        )}
      </View>

      <View style={styles.divider} />

      <View style={styles.rowGrid}>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Previous Index</Text>
          <Text style={styles.gridValue}>{fmt(item.prev_index, 2)}</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Current Index</Text>
          <Text style={styles.gridValue}>{fmt(item.curr_index, 2)}</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={styles.gridLabel}>Prev Consumption</Text>
          <Text style={styles.gridValue}>{fmt(item.prev_cons, 2)} kWh</Text>
        </View>
        <View style={styles.gridItem}>
          <Text style={[styles.gridLabel]}>Curr Consumption</Text>
          <Text style={[styles.gridValue, styles.highlight]}>{fmt(item.curr_cons, 2)} kWh</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.chargesSection}>
        <Text style={styles.sectionTitle}>Billing Breakdown</Text>
        <View style={styles.chargesGrid}>
          <View style={styles.chargeItem}>
            <Text style={styles.chargeLabel}>Base</Text>
            <Text style={styles.chargeValue}>{peso(item.base)}</Text>
          </View>
          <View style={styles.chargeItem}>
            <Text style={styles.chargeLabel}>VAT</Text>
            <Text style={styles.chargeValue}>{peso(item.vat)}</Text>
          </View>
          <View style={styles.chargeItem}>
            <Text style={styles.chargeLabel}>W/Tax</Text>
            <Text style={styles.chargeValue}>{peso(item.wt)}</Text>
          </View>
          <View style={styles.chargeItem}>
            <Text style={styles.chargeLabel}>Penalty</Text>
            <Text style={styles.chargeValue}>{peso(item.penalty)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.totalSection}>
        <Text style={styles.totalLabel}>Total Amount</Text>
        <Text style={styles.totalValue}>{peso(item.total)}</Text>
      </View>

      <View style={styles.rocSection}>
        <Text style={styles.rocLabel}>Rate of Change</Text>
        <RocText value={item.rate_of_change} />
      </View>

      {!!item.tenant_id && (
        <View style={styles.tenantSection}>
          <Ionicons name="person" size={16} color="#64748b" />
          <Text style={styles.tenantText}>{item.tenant_id}{item.tenant_name ? ` • ${item.tenant_name}` : ""}</Text>
        </View>
      )}
    </View>
  );

  const SummaryBar = () => summary ? (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>Summary</Text>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryItem}>
          <Ionicons name="flash" size={24} color="#f59e0b" />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>Consumption</Text>
            <Text style={styles.summaryValue}>{fmt(summary.consumption)} kWh</Text>
          </View>
        </View>
        <View style={styles.summaryItem}>
          <Ionicons name="cash" size={24} color="#10b981" />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>Base Charge</Text>
            <Text style={styles.summaryValue}>{peso(summary.base)}</Text>
          </View>
        </View>
        <View style={styles.summaryItem}>
          <Ionicons name="calculator" size={24} color="#6366f1" />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>VAT</Text>
            <Text style={styles.summaryValue}>{peso(summary.vat)}</Text>
          </View>
        </View>
        <View style={styles.summaryItem}>
          <Ionicons name="receipt" size={24} color="#8b5cf6" />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>W/Tax</Text>
            <Text style={styles.summaryValue}>{peso(summary.wt)}</Text>
          </View>
        </View>
        <View style={styles.summaryItem}>
          <Ionicons name="warning" size={24} color="#ef4444" />
          <View style={styles.summaryContent}>
            <Text style={styles.summaryLabel}>Penalty</Text>
            <Text style={styles.summaryValue}>{peso(summary.penalty)}</Text>
          </View>
        </View>
        <View style={[styles.summaryItem, styles.summaryTotal]}>
          <Ionicons name="wallet" size={28} color="#fff" />
          <View style={styles.summaryContent}>
            <Text style={[styles.summaryLabel, { color: '#fff' }]}>Total Amount</Text>
            <Text style={[styles.summaryValue, { color: '#fff', fontSize: 24 }]}>{peso(summary.total)}</Text>
          </View>
        </View>
      </View>
    </View>
  ) : null;

  /** ── Comparison section (building mode) ───────────────────────── */
  const Comparison = () => {
    if (mode !== "building") return null;
    if (!cmpMonthly && !cmpFour) return null;

    return (
      <View style={styles.cmpCard}>
        <Text style={styles.cmpTitle}>Comparison</Text>

        {/* Mode chips + Export */}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <TouchableOpacity onPress={() => setCmpMode("monthly")} style={[styles.chip, cmpMode === "monthly" && styles.chipActive]}>
            <Text style={[styles.chipText, cmpMode === "monthly" && styles.chipTextActive]}>Monthly</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCmpMode("quarterly")} style={[styles.chip, cmpMode === "quarterly" && styles.chipActive]}>
            <Text style={[styles.chipText, cmpMode === "quarterly" && styles.chipTextActive]}>Quarterly</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCmpMode("yearly")} style={[styles.chip, cmpMode === "yearly" && styles.chipActive]}>
            <Text style={[styles.chipText, cmpMode === "yearly" && styles.chipTextActive]}>Yearly</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary, { flexGrow: 1 }]} onPress={exportComparisonCsv}>
            <Ionicons name="download-outline" size={18} color="#6366f1" />
            <Text style={[styles.btnText, styles.btnTextSecondary]}>Export Comparison CSV</Text>
          </TouchableOpacity>
        </View>

        {cmpMonthly && (
          <View style={styles.cmpBlock}>
            <Text style={styles.cmpBlockTitle}>Monthly totals (current window)</Text>
            <View style={styles.cmpKpis}>
              <View style={styles.cmpKpi}>
                <Ionicons name="flash" size={18} color="#f59e0b" />
                <Text style={styles.cmpKpiLabel}>Electric</Text>
                <Text style={styles.cmpKpiValue}>{fmt(cmpMonthly.totals.electric)}</Text>
              </View>
              <View style={styles.cmpKpi}>
                <Ionicons name="water" size={18} color="#06b6d4" />
                <Text style={styles.cmpKpiLabel}>Water</Text>
                <Text style={styles.cmpKpiValue}>{fmt(cmpMonthly.totals.water)}</Text>
              </View>
              <View style={styles.cmpKpi}>
                <Ionicons name="flame" size={18} color="#ef4444" />
                <Text style={styles.cmpKpiLabel}>LPG</Text>
                <Text style={styles.cmpKpiValue}>{fmt(cmpMonthly.totals.lpg)}</Text>
              </View>
            </View>
          </View>
        )}

        {cmpFour && cmpFour.four_months?.periods?.length ? (
          <View style={styles.cmpBlock}>
            <Text style={styles.cmpBlockTitle}>Four-month comparison</Text>

            <View style={styles.cmpTableHeader}>
              <Text style={[styles.cmpTh, { flex: 1.2 }]}>Month</Text>
              <Text style={[styles.cmpTh, { flex: 1 }]}>Electric</Text>
              <Text style={[styles.cmpTh, { flex: 1 }]}>Water</Text>
              <Text style={[styles.cmpTh, { flex: 1 }]}>LPG</Text>
            </View>

            {cmpFour.four_months.periods.map((p) => (
              <View key={p.month} style={styles.cmpRow}>
                <Text style={[styles.cmpTd, { flex: 1.2 }]}>{p.month}</Text>
                <Text style={[styles.cmpTd, { flex: 1, textAlign: "right" }]}>{fmt(p.totals.electric)}</Text>
                <Text style={[styles.cmpTd, { flex: 1, textAlign: "right" }]}>{fmt(p.totals.water)}</Text>
                <Text style={[styles.cmpTd, { flex: 1, textAlign: "right" }]}>{fmt(p.totals.lpg)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  };
  /** ─────────────────────────────────────────────────────────────────── */

  /* ---------- Report Panel ---------- */
  const ReportPanel = () => (
    <Modal visible={reportOpen} animationType="slide" transparent onRequestClose={() => setReportOpen(false)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>Export HTML Report</Text>
              <Text style={styles.modalSubtitle}>Download formatted billing report</Text>
            </View>
            <TouchableOpacity onPress={() => setReportOpen(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.modalBody}>
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Mode</Text>
                <Text style={styles.infoValue}>{mode.toUpperCase()}</Text>
              </View>
              {mode === "building" && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Building</Text>
                  <Text style={styles.infoValue}>{buildingId || "—"}</Text>
                </View>
              )}
              {mode === "tenant" && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Tenant</Text>
                  <Text style={styles.infoValue}>{tenantId || "—"}</Text>
                </View>
              )}
              {mode === "meter" && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Meter</Text>
                  <Text style={styles.infoValue}>{meterId || "—"}</Text>
                </View>
              )}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>End Date</Text>
                <Text style={styles.infoValue}>{endDate}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Records</Text>
                <Text style={styles.infoValue}>{rows.length}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Building Rate</Text>
                <Text style={styles.infoValue}>{buildingElectricRate != null ? `₱${fmt(buildingElectricRate, 4)}/kWh` : "—"}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>VAT Codes</Text>
                <Text style={styles.infoValue}>{Object.keys(vatMap).length}</Text>
              </View>
            </View>
            
            <View style={styles.hintBox}>
              <Ionicons name="information-circle" size={20} color="#3b82f6" />
              <Text style={styles.hintText}>Report includes VAT calculation based on (Consumed × Rate) × VAT%. Tax codes from row data will be included.</Text>
            </View>
          </View>
          
          <View style={styles.modalActions}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary, { flex: 1 }]} onPress={exportHtmlReport}>
              <Ionicons name="download" size={20} color="#fff" />
              <Text style={styles.btnText}>Download HTML</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnGhost, { flex: 1 }]} onPress={() => setReportOpen(false)}>
              <Text style={[styles.btnText, { color: '#64748b' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <Header />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Controls />
        <SummaryBar />
        {/* NEW: comparison visuals */}
        <Comparison />

        {busy ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#6366f1" />
            <Text style={styles.loadingText}>Generating report...</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={64} color="#cbd5e1" />
            <Text style={styles.emptyTitle}>No Records Yet</Text>
            <Text style={styles.emptyText}>Configure the options above and generate your billing report</Text>
          </View>
        ) : (
          <View style={styles.resultsSection}>
            <Text style={styles.resultsTitle}>{rows.length} Record{rows.length !== 1 ? 's' : ''} Found</Text>
            <FlatList 
              data={rows} 
              keyExtractor={(r, i) => `${r.meter_id}-${i}`} 
              renderItem={RowItem} 
              ItemSeparatorComponent={() => <View style={{ height: 16 }} />} 
              contentContainerStyle={{ paddingVertical: 8 }} 
              scrollEnabled={false}
            />
          </View>
        )}
      </ScrollView>
      <ReportPanel />
    </View>
  );
}

/* ==================== Styles ==================== */
const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: "#f8fafc" 
  },
  
  // Header
  header: { 
    paddingTop: 16, 
    paddingHorizontal: 20, 
    paddingBottom: 16, 
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: { 
    fontSize: 28, 
    fontWeight: "800", 
    color: "#0f172a",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 2,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#eef2ff",
    justifyContent: "center",
    alignItems: "center",
  },
  
  // Mode Switch
  modeSwitch: { 
    flexDirection: "row", 
    gap: 12,
    padding: 4,
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
  },
  modeBtn: { 
    flex: 1,
    paddingVertical: 12, 
    paddingHorizontal: 16, 
    borderRadius: 10, 
    backgroundColor: "transparent",
    flexDirection: "row", 
    alignItems: "center", 
    justifyContent: "center",
    gap: 8,
  },
  modeBtnActive: { 
    backgroundColor: "#6366f1",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modeBtnText: { 
    color: "#64748b", 
    fontWeight: "700",
    fontSize: 15,
  },
  modeBtnTextActive: { 
    color: "#fff" 
  },

  // Scroll Content
  scrollContent: {
    padding: 20,
  },

  // Controls
  controls: { 
    backgroundColor: "#fff", 
    borderRadius: 20, 
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  field: { 
    marginBottom: 20 
  },
  label: { 
    fontSize: 14, 
    color: "#475569", 
    marginBottom: 8,
    fontWeight: "600",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#e2e8f0",
  },
  inputIcon: {
    marginLeft: 16,
  },
  input: { 
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14, 
    fontSize: 15,
    color: "#0f172a",
    fontWeight: "500",
  },
  row: { 
    flexDirection: "row", 
    alignItems: "flex-end" 
  },

  // Buttons
  actions: { 
    flexDirection: "row", 
    gap: 12, 
    marginTop: 8,
    flexWrap: "wrap",
  },
  btn: { 
    paddingHorizontal: 20, 
    paddingVertical: 14, 
    borderRadius: 12, 
    flexDirection: "row", 
    alignItems: "center", 
    justifyContent: "center",
    gap: 8,
    flex: 1,
    minWidth: 120,
  },
  btnPrimary: {
    backgroundColor: "#6366f1",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  btnSecondary: { 
    backgroundColor: "#f1f5f9",
    borderWidth: 2,
    borderColor: "#e2e8f0",
  },
  btnGhost: {
    backgroundColor: "transparent",
  },
  btnText: { 
    color: "#fff", 
    fontWeight: "700",
    fontSize: 15,
  },
  btnTextSecondary: {
    color: "#6366f1",
  },
  btnMini: { 
    backgroundColor: "#f1f59", 
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 10, 
    flexDirection: "row", 
    alignItems: "center", 
    gap: 8,
    borderWidth: 2,
    borderColor: "#e2e8f0",
    marginTop: 8,
  },
  btnTextMini: { 
    color: "#6366f1", 
    fontWeight: "700", 
    fontSize: 13 
  },
  badge: {
    backgroundColor: "#6366f1",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginLeft: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  // Chips
  chipsWrap: { 
    flexDirection: "row", 
    flexWrap: "wrap", 
    gap: 8, 
    marginTop: 12 
  },
  chip: { 
    paddingHorizontal: 16, 
    paddingVertical: 8, 
    borderRadius: 999, 
    backgroundColor: "#f8fafc", 
    borderWidth: 2, 
    borderColor: "#e2e8f0" 
  },
  chipActive: { 
    backgroundColor: "#eef2ff", 
    borderColor: "#6366f1" 
  },
  chipText: { 
    color: "#64748b", 
    fontWeight: "600", 
    fontSize: 13 
  },
  chipTextActive: { 
    color: "#6366f1" 
  },

  // Messages
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fef2f2",
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#ef4444",
  },
  errorText: { 
    color: "#dc2626", 
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  noteBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#eff6ff",
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#3b82f6",
  },
  noteText: { 
    color: "#1e40af", 
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  timestampBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  timestampText: { 
    color: "#64748b", 
    fontSize: 13,
    fontStyle: "italic",
  },

  // Summary Card
  summaryCard: { 
    backgroundColor: "#fff",
    borderRadius: 20, 
    padding: 20,
    marginTop: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 16,
  },
  summaryGrid: {
    gap: 12,
  },
  summaryItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  summaryTotal: {
    backgroundColor: "#6366f1",
    borderColor: "#6366f1",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  summaryContent: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "600",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
  },

  // NEW: Comparison styles
  cmpCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    marginTop: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  cmpTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
  },
  cmpBlock: { marginTop: 10 },
  cmpBlockTitle: { fontSize: 13, fontWeight: "700", color: "#334155", marginBottom: 8 },
  cmpKpis: { flexDirection: "row", gap: 12 },
  cmpKpi: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    gap: 4,
  },
  cmpKpiLabel: { fontSize: 12, fontWeight: "600", color: "#64748b" },
  cmpKpiValue: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  cmpTableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 8,
    marginTop: 6,
  },
  cmpTh: { fontSize: 12, color: "#64748b", fontWeight: "700" },
  cmpRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e2e8f0",
  },
  cmpTd: { fontSize: 14, color: "#0f172a" },

  // Results Section
  resultsSection: {
    marginTop: 20,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },

  // Row Item
  rowItem: { 
    backgroundColor: "#fff", 
    borderRadius: 16, 
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  meterInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  meterIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
    justifyContent: "center",
    alignItems: "center",
  },
  meterDetails: {
    flex: 1,
  },
  meterIdText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  meterSn: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 2,
  },
  stallBadge: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  stallText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  divider: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: 16,
  },
  rowGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gridItem: {
    flex: 1,
    minWidth: "45%",
  },
  gridLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
    marginBottom: 4,
  },
  gridValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0f172a",
  },
  highlight: {
    color: "#6366f1",
  },
  chargesSection: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 12,
  },
  chargesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  chargeItem: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#f8fafc",
    padding: 12,
    borderRadius: 10,
  },
  chargeLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: "600",
    marginBottom: 4,
  },
  chargeValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  totalSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    padding: 16,
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#bbf7d0",
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#166534",
  },
  totalValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#15803d",
  },
  rocSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  rocLabel: {
    fontSize: 13,
    color: "#64748b",
    fontWeight: "600",
  },
  rocBadge: {
    backgroundColor: "#fef2f2",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  rocText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#dc2626",
  },
  rowVal: {
    fontSize: 14,
    color: "#94a3b8",
  },
  tenantSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: "#faf5ff",
    borderRadius: 10,
  },
  tenantText: {
    fontSize: 13,
    color: "#7c3aed",
    fontWeight: "600",
  },

  // Loading & Empty States
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    color: "#64748b",
    fontSize: 15,
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0f172a",
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 8,
    textAlign: "center",
  },

  // Modal
  modalBackdrop: { 
    flex: 1, 
    backgroundColor: "rgba(0,0,0,0.5)", 
    justifyContent: "flex-end" 
  },
  modalCard: { 
    backgroundColor: "#fff", 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    padding: 24,
    maxHeight: "80%",
  },
  modalHeader: { 
    flexDirection: "row", 
    alignItems: "flex-start", 
    justifyContent: "space-between", 
    marginBottom: 20 
  },
  modalTitle: { 
    fontSize: 22, 
    fontWeight: "800", 
    color: "#0f172a" 
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 4,
  },
  closeBtn: {
    padding: 4,
  },
  modalBody: { 
    paddingVertical: 8 
  },
  infoCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
  },
  hintBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#eff6ff",
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: "#1e40af",
    lineHeight: 18,
  },
  modalActions: { 
    flexDirection: "row", 
    gap: 12, 
    marginTop: 24 
  },
});