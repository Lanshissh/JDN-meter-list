// app/(tabs)/billing.tsx
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  Platform,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";

/* ==================== Types ==================== */
type BillingV2 = {
  meter: { meter_id: string; meter_sn: string; meter_type: "electric" | "water" | "lpg" | "other" | string; meter_mult?: number | null };
  stall?: { stall_id?: string; building_id?: string; tenant_id?: string };
  tenant?: { tenant_id?: string; tenant_name?: string; vat_code?: string; wt_code?: string; for_penalty?: boolean };
  period: { current: { start: string; end: string }; previous: { start: string; end: string } };
  indices: { prev_index: number | null; curr_index: number | null };
  billing: { consumption: number; base: number; vat: number; wt: number; penalty: number; total: number };
  totals?: { consumption: number; base: number; vat: number; wt: number; penalty: number; total: number };
  generated_at: string;
};

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

type RocMeter = {
  meter_id: string;
  meter_type: string;
  building_id: string;
  period: { current: { start: string; end: string }; previous: { start: string; end: string } };
  indices: { prev_index: number; curr_index: number };
  current_consumption: number;
  previous_consumption: number | null;
  rate_of_change: number | null;
  error?: string;
};
type RocTenant = {
  tenant_id: string;
  end_date: string;
  meters: RocMeter[];
  consumption_by_type?: Record<string, { current_consumption: number; previous_consumption: number; meters: number }>;
  totals: { current_consumption: number; previous_consumption: number; rate_of_change: number | null };
};

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
  const msg =
    typeof data === "string"
      ? data
      : (data && (data.message || data.error)) || e?.message || "Unknown error";
  const parts: string[] = [];
  if (status) parts.push(`HTTP ${status}`);
  if (url) parts.push(url);
  if (msg) parts.push(String(msg));
  return parts.length ? parts.join(" — ") : fallback;
};

const penaltyQS = (rateStr: string): string => {
  const n = Number(rateStr);
  return Number.isFinite(n) && n >= 0 ? `?penalty_rate=${encodeURIComponent(String(n))}` : "";
};

const getSafe = async <T,>(
  api: ReturnType<typeof axios.create>,
  path: string,
  onError?: (msg: string) => void
): Promise<T | null> => {
  try {
    const { data } = await api.get<T>(path);
    return data;
  } catch (e: any) {
    const status = e?.response?.status;
    const raw = e?.response?.data;
    const msg =
      typeof raw === "string"
        ? raw
        : (raw && (raw.error || raw.message)) || (raw ? JSON.stringify(raw) : "") || e?.message || "Unknown error";
    const note = `${status ?? ""} ${msg}`.trim();
    console.warn("Optional fetch failed:", path, note);
    onError?.(note);
    return null;
  }
};

const normNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function pickByRegex<T = unknown>(obj: unknown, patterns: RegExp[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) if (patterns.some((p) => p.test(k))) return v as T;
  for (const v of Object.values(o)) if (v && typeof v === "object") {
    const inner = pickByRegex<T>(v, patterns);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

const pickPrevConsDeep = (obj: unknown): number | null => {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const container =
    (o["previous"] as unknown) ??
    (o["prev"] as unknown) ??
    (o["last"] as unknown) ??
    (o["prior"] as unknown) ??
    pickByRegex<Record<string, unknown>>(o, [/^prev(ious)?$/i, /^last$/i, /^prior$/i]);

  if (container && typeof container === "object") {
    const c = container as Record<string, unknown>;
    return normNum(c["consumption"]) ?? normNum(c["usage"]) ?? normNum(c["kwh"]) ?? normNum(c["value"]) ?? null;
  }
  return null;
};

function normalizeLegacyMeter(m: unknown): MeterBillingLegacy {
  const mm = (m ?? {}) as Record<string, unknown>;
  const meter_id =
    mm["meter_id"] ?? mm["meterId"] ?? mm["id"] ??
    pickByRegex<string>(mm, [/^meter.*id$/i, /^id$/i, /meterid/i]) ?? "";
  const meter_typeRaw =
    mm["meter_type"] ?? mm["meterType"] ?? mm["type"] ?? pickByRegex<string>(mm, [/type$/i, /meter.*type/i]);
  const stall_id = mm["stall_id"] ?? mm["stallId"] ?? pickByRegex<string>(mm, [/stall.*id/i]) ?? "";

  const current_index = normNum(
    mm["current_index"] ?? mm["currentIndex"] ?? mm["current_reading"] ?? mm["currentReading"] ??
    pickByRegex<number>(mm, [/^curr(ent)?_?(idx|index|reading)$/i, /^reading_?curr/i, /current.*read/i])
  );
  const previous_index = normNum(
    mm["previous_index"] ?? mm["previousIndex"] ?? mm["previous_reading"] ?? mm["previousReading"] ??
    pickByRegex<number>(mm, [/^prev(ious)?_?(idx|index|reading)$/i, /^reading_?prev/i, /prev.*read/i])
  );

  const current_consumption = normNum(
    mm["current_consumption"] ?? mm["currentConsumption"] ??
    pickByRegex<number>(mm, [/^consumption$/i, /^usage$/i, /consumed/i, /(kwh|m3|liters?)$/i, /curr.*cons/i])
  );
  const previous_consumption =
    normNum(mm["previous_consumption"] ?? mm["previousConsumption"] ?? pickByRegex<number>(mm, [/^prev.*cons/i, /previous.*cons/i])) ??
    pickPrevConsDeep(mm);

  let charge =
    normNum(
      mm["charge"] ?? mm["total"] ?? mm["amount"] ?? mm["totalCharge"] ?? mm["amount_due"] ??
      pickByRegex<number>(mm, [/charge$/i, /total(_?amount)?$/i, /amount(_?due)?$/i, /bill(total)?$/i])
    ) ?? null;

  if (charge === null) {
    const base = normNum(mm["base"] ?? pickByRegex<number>(mm, [/\b(sub)?total\b/i, /\bbase\b/i, /charge_?base/i])) ?? 0;
    const vat = normNum(mm["vat"] ?? pickByRegex<number>(mm, [/\bvat\b/i, /\bvalue[_ ]?added/i])) ?? 0;
    const wt = normNum(mm["wt"] ?? mm["withholding"] ?? pickByRegex<number>(mm, [/\bwithholding\b/i, /\bwt\b/i])) ?? 0;
    const penalty = normNum(mm["penalty"] ?? pickByRegex<number>(mm, [/\bpenalt(y|ies)\b/i])) ?? 0;
    const nestedTotal =
      normNum(pickByRegex<number>(mm, [/^total$/i])) ??
      normNum(pickByRegex<number>(mm, [/billing/i])) ??
      normNum(pickByRegex<number>(mm, [/charges?/i])) ?? null;
    charge = nestedTotal ?? (base + vat + penalty - wt);
    if (!Number.isFinite(charge)) charge = null;
  }

  return {
    meter_id: String(meter_id || ""),
    meter_type: String(meter_typeRaw ?? "").toLowerCase(),
    stall_id: String(stall_id || ""),
    current_index,
    previous_index,
    current_consumption,
    previous_consumption,
    charge,
  };
}

function normalizeLegacyTenant(payload: unknown): TenantBillingLegacy {
  const p = (payload ?? {}) as Record<string, unknown>;
  const metersSource =
    (Array.isArray(p["meters"]) ? (p["meters"] as unknown[]) : null) ??
    (Array.isArray(p["meter_list"]) ? (p["meter_list"] as unknown[]) : null) ?? [];
  const meters: MeterBillingLegacy[] = metersSource.map((x) => normalizeLegacyMeter(x));

  const currentSum = meters.reduce<number>((sum, m2) => sum + (m2.current_consumption ?? 0), 0);
  const previousSum = meters.reduce<number>((sum, m2) => sum + (m2.previous_consumption ?? 0), 0);
  const chargeSum = meters.reduce<number>((sum, m2) => sum + (m2.charge ?? 0), 0);

  const gt = (p["grand_totals"] ?? p["grandTotals"] ?? p["totals"] ?? {}) as Record<string, unknown>;

  const grand_totals = {
    current_consumption:
      (gt["current_consumption"] as number | undefined) ??
      (gt["currentConsumption"] as number | undefined) ??
      (gt["consumption"] as number | undefined) ??
      (gt["total_consumption"] as number | undefined) ??
      currentSum,
    previous_consumption:
      (gt["previous_consumption"] as number | undefined) ??
      (gt["previousConsumption"] as number | undefined) ??
      (gt["prevConsumption"] as number | undefined) ??
      previousSum,
    meters: (Number(gt["meters"]) || meters.length) as number,
    charge:
      (gt["charge"] as number | undefined) ??
      (gt["total"] as number | undefined) ??
      (gt["amount"] as number | undefined) ??
      (gt["amount_due"] as number | undefined) ??
      (gt["totalCharge"] as number | undefined) ??
      chargeSum,
  };

  return {
    tenant_id: String(p["tenant_id"] ?? p["tenantId"] ?? ""),
    end_date: String(p["end_date"] ?? p["endDate"] ?? ""),
    meters,
    totals_by_type: (p["totals_by_type"] ?? p["totalsByType"]) as TenantBillingLegacy["totals_by_type"],
    grand_totals,
    generated_at: String(p["generated_at"] ?? p["generatedAt"] ?? new Date().toISOString()),
  };
}

const computeROC = (curr?: number | null, prev?: number | null): number | null => {
  if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
};

const Badge = ({ value }: { value: number | null | undefined }) => {
  const isUp = value != null && value >= 0;
  const boxStyle = value == null ? styles.badgeNeutralBox : isUp ? styles.badgeUpBox : styles.badgeDownBox;
  const textStyle = value == null ? styles.badgeNeutralText : isUp ? styles.badgeUpText : styles.badgeDownText;
  const icon = value == null ? null : isUp ? "trending-up" : "trending-down";
  
  return (
    <View style={[styles.badgeBox, boxStyle]}>
      {icon && <Ionicons name={icon} size={14} color={isUp ? "#166534" : "#991b1b"} style={{ marginRight: 4 }} />}
      <Text style={[styles.badgeText, textStyle]}>{value == null ? "N/A" : `${value > 0 ? '+' : ''}${value}%`}</Text>
    </View>
  );
};

const ROC_BASES = ["/rateofchange", "/roc"];

async function getRocMeter(api: any, id: string, ymd: string) {
  for (const base of ROC_BASES) {
    try {
      const { data } = await api.get(`${base}/meters/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}`);
      return data as RocMeter;
    } catch (e: any) {
      if ([401, 403].includes(e?.response?.status)) throw e;
    }
  }
  return null;
}
async function getRocTenant(api: any, id: string, ymd: string) {
  for (const base of ROC_BASES) {
    try {
      const { data } = await api.get(`${base}/tenants/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}`);
      return data as RocTenant;
    } catch (e: any) {
      if ([401, 403].includes(e?.response?.status)) throw e;
    }
  }
  return null;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ==================== Screen ==================== */
export default function BillingScreen() {
  const { token } = useAuth();

  type Mode = "tenant" | "meter" | "v2";
  const [mode, setMode] = useState<Mode>("v2");
  const [busy, setBusy] = useState(false);

  const [tenantId, setTenantId] = useState("");
  const [meterId, setMeterId] = useState("");
  const [endDate, setEndDate] = useState(today());
  const [penaltyRate, setPenaltyRate] = useState<string>("");

  const [legacy, setLegacy] = useState<TenantBillingLegacy | null>(null);
  const [v2, setV2] = useState<BillingV2 | null>(null);

  const [rocMeter, setRocMeter] = useState<RocMeter | null>(null);
  const [rocTenant, setRocTenant] = useState<RocTenant | null>(null);

  const [rocMap, setRocMap] = useState<Record<string, number | null>>({});
  const [rocErr, setRocErr] = useState<string | null>(null);

  const api = useMemo(() => {
    const inst = axios.create({ baseURL: BASE_API, timeout: 20000 });
    inst.interceptors.request.use((cfg) => {
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });
    return inst;
  }, [token]);

  const canRun =
    (mode === "tenant" ? !!tenantId.trim() : mode === "meter" ? !!meterId.trim() : tenantId.trim() || meterId.trim()) &&
    isYMD(endDate.trim());

  const run = async () => {
    if (!token) return notify("Not logged in", "Please log in to generate billing.");
    const ymd = endDate.trim();
    if (!isYMD(ymd)) return notify("Invalid end date", "Use format YYYY-MM-DD.");

    setBusy(true);
    setLegacy(null);
    setV2(null);
    setRocMeter(null);
    setRocTenant(null);
    setRocMap({});
    setRocErr(null);

    try {
      if (mode === "v2") {
        if (meterId.trim()) {
          const q = penaltyQS(penaltyRate);
          const billRes = await api.get<BillingV2>(`/billings/meters/${encodeURIComponent(meterId.trim())}/period-end/${encodeURIComponent(ymd)}${q}`);
          setV2(billRes.data);

          const rm = await getRocMeter(api, meterId.trim(), ymd);
          if (!rm) setRocErr("ROC endpoint not found (tried /rateofchange and /roc).");
          setRocMeter(rm);
        } else if (tenantId.trim()) {
          const id = tenantId.trim().toUpperCase();
          const q = penaltyQS(penaltyRate);
          const billRes = await api.get(`/billings/tenants/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}${q}`);

          if (Array.isArray(billRes.data) && billRes.data.length && (billRes.data[0] as any)?.meter) {
            const items = billRes.data as BillingV2[];
            const rollup = items.reduce(
              (a, it) => {
                const b = it.billing;
                a.consumption += b.consumption || 0; a.base += b.base || 0; a.vat += b.vat || 0;
                a.wt += b.wt || 0; a.penalty += b.penalty || 0; a.total += b.total || 0;
                return a;
              },
              { consumption: 0, base: 0, vat: 0, wt: 0, penalty: 0, total: 0 }
            );
            const first = items[0];
            setV2({ ...first, totals: rollup, tenant: { ...(first.tenant || {}), tenant_id: id } });
          } else if ((billRes.data as any)?.meter && (billRes.data as any)?.billing) {
            setV2(billRes.data as BillingV2);
          } else {
            const normalized = normalizeLegacyTenant(billRes.data);
            setLegacy(normalized);
            if (!normalized.meters.length) notify("No meters in legacy response", "Tenant found, but no readable meter rows.");
            setMode("tenant");

            const ids = (normalized.meters || []).map(m => m.meter_id).filter(Boolean);
            const results = await Promise.all(ids.map(id2 => getRocMeter(api, id2, ymd)));
            const map: Record<string, number | null> = {};
            results.forEach(r => { if (r) map[r.meter_id] = r.rate_of_change ?? null; });
            setRocMap(map);
          }

          const rt = await getRocTenant(api, id, ymd);
          if (!rt) setRocErr("ROC endpoint not found (tried /rateofchange and /roc).");
          setRocTenant(rt);
        } else {
          notify("Missing ID", "Enter a Meter ID or Tenant ID.");
        }
      } else if (mode === "meter") {
        const q = penaltyQS(penaltyRate);
        const billRes = await api.get(`/billings/meters/${encodeURIComponent(meterId.trim())}/period-end/${encodeURIComponent(ymd)}${q}`);
        if ((billRes.data as any)?.meter && (billRes.data as any)?.billing) setV2(billRes.data as BillingV2);
        else {
          const one = normalizeLegacyMeter(billRes.data);
          const pack: TenantBillingLegacy = {
            tenant_id: "(single meter)", end_date: ymd, meters: [one], totals_by_type: undefined,
            grand_totals: { current_consumption: Number(one.current_consumption || 0), previous_consumption: Number(one.previous_consumption || 0), charge: Number(one.charge || 0), meters: 1 },
            generated_at: new Date().toISOString(),
          };
          setLegacy(pack);
        }

        const rm = await getRocMeter(api, meterId.trim(), ymd);
        if (!rm) setRocErr("ROC endpoint not found (tried /rateofchange and /roc).");
        setRocMeter(rm);
      } else {
        const id = tenantId.trim().toUpperCase();
        const q = penaltyQS(penaltyRate);
        const billRes = await api.get(`/billings/tenants/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}${q}`);
        const normalized = normalizeLegacyTenant(billRes.data);
        setLegacy(normalized);

        const ids = (normalized.meters || []).map(m => m.meter_id).filter(Boolean);
        const results = await Promise.all(ids.map(mid => getRocMeter(api, mid, ymd)));
        const map: Record<string, number | null> = {};
        results.forEach(r => { if (r) map[r.meter_id] = r.rate_of_change ?? null; });
        setRocMap(map);

        const rt = await getRocTenant(api, id, ymd);
        if (!rt) setRocErr("ROC endpoint not found (tried /rateofchange and /roc).");
        setRocTenant(rt);

        if (!billRes.data || typeof billRes.data !== "object") notify("Unexpected response", "Server returned a non-object for legacy tenant.");
        else if ((billRes.data as any).error) notify("Server error", String((billRes.data as any).error));
        else if (!Array.isArray(normalized.meters)) notify("Unexpected shape", "No 'meters' array in response.");
      }
    } catch (err) {
      notify("Billing failed", errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const stamp = (endDate || today()).replace(/-/g, "");
    const esc = (s: unknown): string => {
      const v = s == null ? "" : String(s);
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };

    if (v2) {
      const r = v2;
      const rows: string[] = [];
      rows.push(`Generated At,${esc(r.generated_at)}`);
      rows.push(`Period Current,${esc(r.period.current.start)} to ${esc(r.period.current.end)}`);
      rows.push(`Period Previous,${esc(r.period.previous.start)} to ${esc(r.period.previous.end)}`);
      rows.push("");
      rows.push("Tenant ID,Tenant Name,VAT Code,WT Code,For Penalty");
      rows.push([esc(r.tenant?.tenant_id || ""), esc(r.tenant?.tenant_name || ""), esc(r.tenant?.vat_code || ""), esc(r.tenant?.wt_code || ""), esc(r.tenant?.for_penalty ? "Yes" : "No")].join(","));
      rows.push("");
      rows.push("Meter ID,Meter SN,Type,Multiplier,Prev Index,Curr Index,Consumption,Base,VAT,WT,Penalty,Total");
      rows.push(
        [
          esc(r.meter.meter_id),
          esc(r.meter.meter_sn),
          esc(r.meter.meter_type),
          esc(r.meter.meter_mult ?? ""),
          esc(r.indices.prev_index ?? ""),
          esc(r.indices.curr_index ?? ""),
          esc(r.billing.consumption),
          esc(r.billing.base),
          esc(r.billing.vat),
          esc(r.billing.wt),
          esc(r.billing.penalty),
          esc(r.billing.total),
        ].join(",")
      );
      rows.push("");
      rows.push("Totals Consumption,Totals Base,Totals VAT,Totals WT,Totals Penalty,Totals Total");
      rows.push(
        [
          esc(r.totals?.consumption ?? r.billing.consumption),
          esc(r.totals?.base ?? r.billing.base),
          esc(r.totals?.vat ?? r.billing.vat),
          esc(r.totals?.wt ?? r.billing.wt),
          esc(r.totals?.penalty ?? r.billing.penalty),
          esc(r.totals?.total ?? r.billing.total),
        ].join(",")
      );
      const csv = rows.join("\n");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `billing_${r.meter.meter_id}_${stamp}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else notify("CSV ready", csv);
      return;
    }

    if (legacy) {
      const r = legacy;
      const rows: string[] = [];
      rows.push(`Tenant ID,${esc(r.tenant_id)}`);
      rows.push(`Period End,${esc(r.end_date)}`);
      rows.push(`Generated At,${esc(r.generated_at)}`);
      rows.push("");
      rows.push("Meter ID,Type,Stall,Current Index,Previous Index,Current Cons.,Previous Cons.,Charge");
      (r.meters || []).forEach((m) => {
        rows.push(
          [
            esc(m.meter_id),
            esc(m.meter_type),
            esc(m.stall_id || ""),
            esc(m.current_index ?? ""),
            esc(m.previous_index ?? ""),
            esc(m.current_consumption ?? ""),
            esc(m.previous_consumption ?? ""),
            esc(m.charge ?? ""),
          ].join(",")
        );
      });
      rows.push("");
      rows.push(["Grand Totals", r.grand_totals.current_consumption, r.grand_totals.previous_consumption ?? "", r.grand_totals.meters, r.grand_totals.charge].map(esc).join(","));
      const csv = rows.join("\n");
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `billing_${r.tenant_id}_${stamp}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else notify("CSV ready", csv);
    } else {
      notify("Nothing to export", "Run a billing first.");
    }
  };

  const Header = (
    <View style={styles.headerContainer}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.title}>Billing Generator</Text>
          <Text style={styles.subtitle}>Generate and export billing reports</Text>
        </View>
        <View style={styles.iconCircle}>
          <Ionicons name="receipt-outline" size={24} color="#3b82f6" />
        </View>
      </View>
      <View style={styles.modeChips}>
        <Chip label="New JSON" active={mode === "v2"} onPress={() => setMode("v2")} />
        <Chip label="Tenant (legacy)" active={mode === "tenant"} onPress={() => setMode("tenant")} />
        <Chip label="Meter (legacy)" active={mode === "meter"} onPress={() => setMode("meter")} />
      </View>
    </View>
  );

  const Inputs = (
    <View style={styles.inputsCard}>
      <View style={styles.inputRow}>
        {mode !== "meter" && (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              <Ionicons name="person-outline" size={14} color="#64748b" /> Tenant ID
            </Text>
            <TextInput
              value={tenantId}
              onChangeText={setTenantId}
              placeholder="e.g., TNT-1"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="characters"
            />
          </View>
        )}
        {mode !== "tenant" && (
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>
              <Ionicons name="speedometer-outline" size={14} color="#64748b" /> Meter ID
            </Text>
            <TextInput
              value={meterId}
              onChangeText={setMeterId}
              placeholder="e.g., MTR-1"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="characters"
            />
          </View>
        )}
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>
            <Ionicons name="calendar-outline" size={14} color="#64748b" /> Period End
          </Text>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>
            <Ionicons name="alert-circle-outline" size={14} color="#64748b" /> Penalty %
          </Text>
          <TextInput
            value={penaltyRate}
            onChangeText={setPenaltyRate}
            placeholder="Optional"
            placeholderTextColor="#94a3b8"
            keyboardType="numeric"
            style={styles.input}
          />
        </View>
      </View>
      
      <View style={styles.actionRow}>
        <TouchableOpacity 
          style={[styles.btnPrimary, (!canRun || busy) && styles.btnDisabled]} 
          onPress={run} 
          disabled={!canRun || busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="flash" size={18} color="#fff" />
              <Text style={styles.btnPrimaryText}>Generate</Text>
            </>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.btnSecondary, !(v2 || legacy) && styles.btnSecondaryDisabled]} 
          onPress={exportCsv} 
          disabled={!(v2 || legacy)}
        >
          <Ionicons name="download" size={18} color="#3b82f6" />
          <Text style={styles.btnSecondaryText}>Export CSV</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const UsageTrendCard = ({ curr, prev, roc }: { curr: number | null | undefined; prev: number | null | undefined; roc: number | null | undefined }) => {
    const computed = computeROC(curr ?? null, prev ?? null);
    const displayRoc = roc ?? computed;
    
    return (
      <View style={styles.trendCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.iconBadge}>
              <Ionicons name="analytics" size={18} color="#8b5cf6" />
            </View>
            <Text style={styles.cardTitle}>Usage Trend</Text>
          </View>
          <Badge value={displayRoc} />
        </View>
        
        <View style={styles.trendContent}>
          <View style={styles.trendItem}>
            <Text style={styles.trendLabel}>Current Period</Text>
            <Text style={styles.trendValue}>{fmt(curr, 0)}</Text>
            <Text style={styles.trendUnit}>kWh</Text>
          </View>
          
          <View style={styles.trendDivider} />
          
          <View style={styles.trendItem}>
            <Text style={styles.trendLabel}>Previous Period</Text>
            <Text style={styles.trendValue}>{fmt(prev, 0)}</Text>
            <Text style={styles.trendUnit}>kWh</Text>
          </View>
        </View>
      </View>
    );
  };

  const V2Block = ({ r }: { r: BillingV2 }) => (
    <View style={styles.resultsContainer}>
      {/* Period Info */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Ionicons name="time-outline" size={16} color="#64748b" />
          <Text style={styles.infoText}>
            Generated {new Date(r.generated_at).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.periodRow}>
          <View style={styles.periodItem}>
            <Text style={styles.periodLabel}>Current Period</Text>
            <Text style={styles.periodValue}>{r.period.current.start} → {r.period.current.end}</Text>
          </View>
          <View style={styles.periodItem}>
            <Text style={styles.periodLabel}>Previous Period</Text>
            <Text style={styles.periodValue}>{r.period.previous.start} → {r.period.previous.end}</Text>
          </View>
        </View>
      </View>

      {/* Tenant Card */}
      <View style={styles.dataCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.iconBadge, { backgroundColor: '#dbeafe' }]}>
              <Ionicons name="business" size={18} color="#3b82f6" />
            </View>
            <Text style={styles.cardTitle}>Tenant Information</Text>
          </View>
        </View>
        <View style={styles.dataGrid}>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>ID</Text>
            <Text style={styles.dataValue}>{r.tenant?.tenant_id || "—"}</Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Name</Text>
            <Text style={styles.dataValue}>{r.tenant?.tenant_name || "—"}</Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>VAT Code</Text>
            <Text style={styles.dataValue}>{r.tenant?.vat_code ?? "—"}</Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>WT Code</Text>
            <Text style={styles.dataValue}>{r.tenant?.wt_code ?? "—"}</Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Penalty Applied</Text>
            <View style={[styles.statusBadge, r.tenant?.for_penalty ? styles.statusActive : styles.statusInactive]}>
              <Text style={[styles.statusText, r.tenant?.for_penalty ? styles.statusActiveText : styles.statusInactiveText]}>
                {r.tenant?.for_penalty ? "Yes" : "No"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Meter Card */}
      <View style={styles.dataCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.iconBadge, { backgroundColor: '#fef3c7' }]}>
              <Ionicons name="speedometer" size={18} color="#f59e0b" />
            </View>
            <Text style={styles.cardTitle}>Meter Details</Text>
          </View>
          <View style={styles.meterTypeBadge}>
            <Text style={styles.meterTypeText}>{String(r.meter.meter_type).toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.dataGrid}>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Meter ID</Text>
            <Text style={styles.dataValue}>{r.meter.meter_id}</Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Serial Number</Text>
            <Text style={styles.dataValue}>{r.meter.meter_sn}</Text>
          </View>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>Multiplier</Text>
            <Text style={styles.dataValue}>{r.meter.meter_mult ?? "—"}</Text>
          </View>
        </View>
        
        <View style={styles.readingsRow}>
          <View style={styles.readingBox}>
            <Text style={styles.readingLabel}>Previous</Text>
            <Text style={styles.readingValue}>{fmt(r.indices.prev_index, 0)}</Text>
          </View>
          <Ionicons name="arrow-forward" size={24} color="#cbd5e1" />
          <View style={styles.readingBox}>
            <Text style={styles.readingLabel}>Current</Text>
            <Text style={styles.readingValue}>{fmt(r.indices.curr_index, 0)}</Text>
          </View>
        </View>
      </View>

      {/* Charges Card */}
      <View style={styles.dataCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.iconBadge, { backgroundColor: '#dcfce7' }]}>
              <Ionicons name="calculator" size={18} color="#16a34a" />
            </View>
            <Text style={styles.cardTitle}>Billing Breakdown</Text>
          </View>
        </View>
        
        <View style={styles.chargeRow}>
          <Text style={styles.chargeLabel}>Consumption</Text>
          <Text style={styles.chargeValue}>{fmt(r.billing.consumption, 0)} kWh</Text>
        </View>
        
        <View style={styles.chargeRow}>
          <Text style={styles.chargeLabel}>Base Charge</Text>
          <Text style={styles.chargeValue}>{peso(r.billing.base)}</Text>
        </View>

        <View style={styles.chargeRow}>
          <Text style={styles.chargeLabel}>VAT (12%)</Text>
          <Text style={styles.chargeValue}>{peso(r.billing.vat)}</Text>
        </View>
        {r.billing.vat === 0 && (
          <Text style={styles.warningText}>
            <Ionicons name="information-circle" size={12} /> No VAT applied
          </Text>
        )}

        <View style={styles.chargeRow}>
          <Text style={styles.chargeLabel}>Withholding Tax</Text>
          <Text style={[styles.chargeValue, { color: '#dc2626' }]}>-{peso(r.billing.wt)}</Text>
        </View>
        {r.billing.wt === 0 && (
          <Text style={styles.warningText}>
            <Ionicons name="information-circle" size={12} /> No withholding applied
          </Text>
        )}

        <View style={styles.chargeRow}>
          <Text style={styles.chargeLabel}>
            Penalty {r.tenant?.for_penalty === false && "(disabled)"}
          </Text>
          <Text style={styles.chargeValue}>{peso(r.billing.penalty)}</Text>
        </View>

        <View style={styles.dividerLine} />
        
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL AMOUNT DUE</Text>
          <Text style={styles.totalValue}>{peso(r.billing.total)}</Text>
        </View>
      </View>

      {/* Usage Trend */}
      <UsageTrendCard
        curr={rocMeter?.meter_id === r.meter.meter_id ? rocMeter?.current_consumption : r.billing.consumption}
        prev={rocMeter?.meter_id === r.meter.meter_id ? rocMeter?.previous_consumption : undefined}
        roc={rocMeter?.meter_id === r.meter.meter_id ? rocMeter?.rate_of_change : undefined}
      />

      {/* Totals if available */}
      {r.totals && (
        <View style={styles.dataCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.iconBadge, { backgroundColor: '#e0e7ff' }]}>
                <Ionicons name="list" size={18} color="#6366f1" />
              </View>
              <Text style={styles.cardTitle}>Summary Totals</Text>
            </View>
          </View>
          
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Total Consumption</Text>
            <Text style={styles.chargeValue}>{fmt(r.totals.consumption, 0)} kWh</Text>
          </View>
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Total Base</Text>
            <Text style={styles.chargeValue}>{peso(r.totals.base)}</Text>
          </View>
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Total VAT</Text>
            <Text style={styles.chargeValue}>{peso(r.totals.vat)}</Text>
          </View>
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Total Withholding</Text>
            <Text style={[styles.chargeValue, { color: '#dc2626' }]}>-{peso(r.totals.wt)}</Text>
          </View>
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Total Penalty</Text>
            <Text style={styles.chargeValue}>{peso(r.totals.penalty)}</Text>
          </View>
          
          <View style={styles.dividerLine} />
          
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>GRAND TOTAL</Text>
            <Text style={styles.totalValue}>{peso(r.totals.total)}</Text>
          </View>
        </View>
      )}
    </View>
  );

  const LegacyBlock = ({ r }: { r: TenantBillingLegacy }) => {
    const empty = !r.meters || r.meters.length === 0;

    const meterROC = (m: MeterBillingLegacy): number | null => {
      const fromTenant = rocTenant?.meters?.find(x => x.meter_id === m.meter_id)?.rate_of_change;
      if (fromTenant != null) return fromTenant;

      if (m.meter_id && Object.prototype.hasOwnProperty.call(rocMap, m.meter_id)) {
        return rocMap[m.meter_id] ?? null;
      }

      const local = computeROC(m.current_consumption ?? null, m.previous_consumption ?? null);
      if (local != null) return local;

      if (rocMeter?.meter_id === m.meter_id) return rocMeter.rate_of_change ?? null;

      return null;
    };

    const sumPrevFromMeters = (r.meters || []).reduce(
      (s, m) => s + (typeof m.previous_consumption === "number" ? m.previous_consumption : 0),
      0
    );
    const sumCurrFromMeters = (r.meters || []).reduce(
      (s, m) => s + (typeof m.current_consumption === "number" ? m.current_consumption : 0),
      0
    );

    const trendPrev =
      (rocTenant?.totals?.previous_consumption ?? null) ??
      (typeof r.grand_totals.previous_consumption === "number" ? r.grand_totals.previous_consumption : null) ??
      (sumPrevFromMeters > 0 ? sumPrevFromMeters : null);

    const trendCurr =
      (rocTenant?.totals?.current_consumption ?? null) ??
      (typeof r.grand_totals.current_consumption === "number" ? r.grand_totals.current_consumption : null) ??
      (sumCurrFromMeters > 0 ? sumCurrFromMeters : null);

    const trendROC =
      (rocTenant?.totals?.rate_of_change ?? null) ??
      computeROC(trendCurr, trendPrev);

    return (
      <View style={styles.resultsContainer}>
        {/* Header Info */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Ionicons name="business-outline" size={16} color="#64748b" />
            <Text style={styles.infoText}>Tenant: <Text style={styles.infoBold}>{r.tenant_id}</Text></Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={16} color="#64748b" />
            <Text style={styles.infoText}>Period End: <Text style={styles.infoBold}>{r.end_date}</Text></Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={16} color="#64748b" />
            <Text style={styles.infoText}>Generated: <Text style={styles.infoBold}>{new Date(r.generated_at).toLocaleDateString()}</Text></Text>
          </View>
        </View>

        {empty && (
          <View style={styles.emptyCard}>
            <Ionicons name="alert-circle" size={48} color="#f59e0b" style={{ marginBottom: 12 }} />
            <Text style={styles.emptyTitle}>No Meters Found</Text>
            <Text style={styles.emptyDesc}>
              Check the tenant ID, permissions, and meter assignments.
            </Text>
          </View>
        )}

        {!empty && (
          <View style={styles.dataCard}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <View style={[styles.iconBadge, { backgroundColor: '#fef3c7' }]}>
                  <Ionicons name="speedometer" size={18} color="#f59e0b" />
                </View>
                <Text style={styles.cardTitle}>Meters ({r.meters.length})</Text>
              </View>
            </View>
            
            <FlatList
              data={r.meters || []}
              keyExtractor={(m, i) => (m.meter_id ? String(m.meter_id) : `m-${i}`)}
              renderItem={({ item }) => (
                <View style={styles.meterCard}>
                  <View style={styles.meterHeader}>
                    <View style={styles.meterIdSection}>
                      <Text style={styles.meterIdText}>{item.meter_id || "—"}</Text>
                      <View style={styles.meterTypeBadgeSmall}>
                        <Text style={styles.meterTypeTextSmall}>{String(item.meter_type || "—").toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.meterCharge}>{peso(item.charge)}</Text>
                  </View>
                  
                  <View style={styles.meterDetails}>
                    <View style={styles.meterDetailItem}>
                      <Text style={styles.meterDetailLabel}>Current</Text>
                      <Text style={styles.meterDetailValue}>{fmt(item.current_index)}</Text>
                    </View>
                    <View style={styles.meterDetailItem}>
                      <Text style={styles.meterDetailLabel}>Previous</Text>
                      <Text style={styles.meterDetailValue}>{fmt(item.previous_index)}</Text>
                    </View>
                    <View style={styles.meterDetailItem}>
                      <Text style={styles.meterDetailLabel}>Consumption</Text>
                      <Text style={styles.meterDetailValue}>{fmt(item.current_consumption)}</Text>
                    </View>
                  </View>
                  
                  {(item.previous_consumption !== null && item.previous_consumption !== undefined) && (
                    <Text style={styles.meterPrevCons}>
                      Previous consumption: {fmt(item.previous_consumption)}
                    </Text>
                  )}
                  
                  <View style={styles.meterRocRow}>
                    <Text style={styles.meterRocLabel}>Rate of Change</Text>
                    <Badge value={meterROC(item)} />
                  </View>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={<Text style={styles.emptyText}>No meters found.</Text>}
            />
            
            {rocErr && (
              <Text style={styles.warningText}>
                <Ionicons name="information-circle" size={12} /> {rocErr}
              </Text>
            )}
          </View>
        )}

        {/* Grand Totals */}
        <View style={styles.dataCard}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={[styles.iconBadge, { backgroundColor: '#dcfce7' }]}>
                <Ionicons name="calculator" size={18} color="#16a34a" />
              </View>
              <Text style={styles.cardTitle}>Grand Totals</Text>
            </View>
          </View>
          
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Total Consumption</Text>
            <Text style={styles.chargeValue}>{fmt(r.grand_totals.current_consumption, 0)} kWh</Text>
          </View>
          
          <View style={styles.chargeRow}>
            <Text style={styles.chargeLabel}>Active Meters</Text>
            <Text style={styles.chargeValue}>{fmt(r.grand_totals.meters, 0)}</Text>
          </View>
          
          <View style={styles.dividerLine} />
          
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL CHARGE</Text>
            <Text style={styles.totalValue}>{peso(r.grand_totals.charge)}</Text>
          </View>
        </View>

        <UsageTrendCard curr={trendCurr} prev={trendPrev} roc={trendROC} />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {Header}
        {Inputs}
        
        {!v2 && !legacy ? (
          <View style={styles.placeholderCard}>
            <Ionicons name="document-text-outline" size={64} color="#cbd5e1" style={{ marginBottom: 16 }} />
            <Text style={styles.placeholderTitle}>Ready to Generate</Text>
            <Text style={styles.placeholderText}>
              Enter the required IDs and date above, then tap Generate to create a billing report.
            </Text>
          </View>
        ) : (
          <>
            {v2 && <V2Block r={v2} />}
            {legacy && <LegacyBlock r={legacy} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/* ==================== Styles ==================== */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  scrollView: {
    flex: 1,
  },
  
  // Header
  headerContainer: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    fontWeight: "500",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  
  // Mode Chips
  modeChips: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  chipActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  chipTextActive: {
    color: "#fff",
  },
  
  // Inputs Card
  inputsCard: {
    backgroundColor: "#fff",
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 16,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  inputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  inputGroup: {
    flex: 1,
    minWidth: 140,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
    fontWeight: "500",
  },
  
  // Action Buttons
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3b82f6",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    ...Platform.select({
      ios: {
        shadowColor: "#3b82f6",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  btnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eff6ff",
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  btnSecondaryDisabled: {
    opacity: 0.4,
  },
  btnSecondaryText: {
    color: "#3b82f6",
    fontSize: 15,
    fontWeight: "700",
  },
  
  // Placeholder
  placeholderCard: {
    backgroundColor: "#fff",
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 32,
    borderRadius: 16,
    padding: 48,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#e2e8f0",
    borderStyle: "dashed",
  },
  placeholderTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#334155",
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 20,
  },
  
  // Results Container
  resultsContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 32,
  },
  
  // Info Card
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#64748b",
  },
  infoBold: {
    fontWeight: "700",
    color: "#0f172a",
  },
  periodRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  periodItem: {
    flex: 1,
  },
  periodLabel: {
    fontSize: 12,
    color: "#94a3b8",
    marginBottom: 4,
  },
  periodValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#334155",
  },
  
  // Data Cards
  dataCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cardHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  
  // Data Grid
  dataGrid: {
    gap: 16,
  },
  dataItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  dataLabel: {
    fontSize: 14,
    color: "#64748b",
    fontWeight: "500",
  },
  dataValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  
  // Status Badges
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusActive: {
    backgroundColor: "#dcfce7",
  },
  statusInactive: {
    backgroundColor: "#fee2e2",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
  },
  statusActiveText: {
    color: "#166534",
  },
  statusInactiveText: {
    color: "#991b1b",
  },
  
  // Meter Type Badge
  meterTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#fef3c7",
  },
  meterTypeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#92400e",
  },
  
  // Readings Row
  readingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  readingBox: {
    alignItems: "center",
    flex: 1,
  },
  readingLabel: {
    fontSize: 13,
    color: "#64748b",
    marginBottom: 6,
    fontWeight: "500",
  },
  readingValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0f172a",
  },
  
  // Charge Rows
  chargeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  chargeLabel: {
    fontSize: 15,
    color: "#475569",
    fontWeight: "500",
  },
  chargeValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  
  // Warning Text
  warningText: {
    fontSize: 12,
    color: "#64748b",
    marginTop: -8,
    marginBottom: 8,
    fontStyle: "italic",
  },
  
  // Divider
  dividerLine: {
    height: 1,
    backgroundColor: "#e2e8f0",
    marginVertical: 16,
  },
  
  // Total Row
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: "800",
    color: "#334155",
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 24,
    fontWeight: "900",
    color: "#3b82f6",
  },
  
  // Trend Card
  trendCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    ...Platform.select({
      ios: {
        shadowColor: "#8b5cf6",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  trendContent: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  trendItem: {
    flex: 1,
    alignItems: "center",
  },
  trendLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 8,
    fontWeight: "500",
  },
  trendValue: {
    fontSize: 28,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  trendUnit: {
    fontSize: 13,
    color: "#94a3b8",
    fontWeight: "600",
  },
  trendDivider: {
    width: 1,
    height: 60,
    backgroundColor: "#e2e8f0",
    marginHorizontal: 20,
  },
  
  // ROC Badges
  badgeBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 13,
    fontWeight: "800",
  },
  badgeUpBox: {
    backgroundColor: "#dcfce7",
  },
  badgeUpText: {
    color: "#166534",
  },
  badgeDownBox: {
    backgroundColor: "#fee2e2",
  },
  badgeDownText: {
    color: "#991b1b",
  },
  badgeNeutralBox: {
    backgroundColor: "#f1f5f9",
  },
  badgeNeutralText: {
    color: "#475569",
  },
  
  // Meter Cards (Legacy)
  meterCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  meterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  meterIdSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  meterIdText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  meterTypeBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#fef3c7",
  },
  meterTypeTextSmall: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400e",
  },
  meterCharge: {
    fontSize: 18,
    fontWeight: "800",
    color: "#16a34a",
  },
  meterDetails: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  meterDetailItem: {
    flex: 1,
  },
  meterDetailLabel: {
    fontSize: 11,
    color: "#64748b",
    marginBottom: 4,
    fontWeight: "500",
  },
  meterDetailValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#334155",
  },
  meterPrevCons: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 8,
    fontStyle: "italic",
  },
  meterRocRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  meterRocLabel: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "600",
  },
  
  // Empty States
  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 48,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fef3c7",
    borderStyle: "dashed",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#92400e",
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: "#78350f",
    textAlign: "center",
    lineHeight: 20,
  },
  emptyText: {
    fontSize: 14,
    color: "#94a3b8",
    textAlign: "center",
    paddingVertical: 24,
  },
});