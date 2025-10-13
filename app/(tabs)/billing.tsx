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

// ROC API shapes
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

// Optional GET: returns null on any error and passes a message to onError (stringifies unknown bodies)
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

/* ---------- Normalizers ---------- */
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

  // compute sums (used as fallback if server omitted previous)
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

/* ==================== ROC helpers & Badge ==================== */
const computeROC = (curr?: number | null, prev?: number | null): number | null => {
  if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
};

const Badge = ({ value }: { value: number | null | undefined }) => {
  const isUp = value != null && value >= 0;
  const boxStyle = value == null ? styles.badgeNeutralBox : isUp ? styles.badgeUpBox : styles.badgeDownBox;
  const textStyle = value == null ? styles.badgeNeutralText : isUp ? styles.badgeUpText : styles.badgeDownText;
  return (
    <View style={[styles.badgeBox, boxStyle]}>
      <Text style={[styles.badgeText, textStyle]}>{value == null ? "N/A" : `${value}%`}</Text>
    </View>
  );
};

/* ==================== UI Bits ==================== */
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
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

  // ROC state
  const [rocMeter, setRocMeter] = useState<RocMeter | null>(null);
  const [rocTenant, setRocTenant] = useState<RocTenant | null>(null);

  // Per-meter ROC map & last error note
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
          getSafe<RocMeter>(api, `/rateofchange/meters/${encodeURIComponent(meterId.trim())}/period-end/${encodeURIComponent(ymd)}`, setRocErr)
            .then((roc) => setRocMeter(roc));
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

            // Fan-out per-meter ROC when tenant ROC not available
            const ids = (normalized.meters || []).map(m => m.meter_id).filter(Boolean);
            Promise.all(
              ids.map(id2 =>
                getSafe<RocMeter>(api, `/rateofchange/meters/${encodeURIComponent(id2)}/period-end/${encodeURIComponent(ymd)}`, setRocErr)
              )
            ).then(results => {
              const map: Record<string, number | null> = {};
              results.forEach(r => { if (r) map[r.meter_id] = r.rate_of_change ?? null; });
              setRocMap(map);
            });
          }
          getSafe<RocTenant>(api, `/rateofchange/tenants/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}`, setRocErr)
            .then((roc) => setRocTenant(roc));
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
        getSafe<RocMeter>(api, `/rateofchange/meters/${encodeURIComponent(meterId.trim())}/period-end/${encodeURIComponent(ymd)}`, setRocErr)
          .then((roc) => setRocMeter(roc));
      } else {
        const id = tenantId.trim().toUpperCase();
        const q = penaltyQS(penaltyRate);
        const billRes = await api.get(`/billings/tenants/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}${q}`);
        const normalized = normalizeLegacyTenant(billRes.data);
        setLegacy(normalized);

        // Fan-out per-meter ROC when tenant ROC not available
        const ids = (normalized.meters || []).map(m => m.meter_id).filter(Boolean);
        Promise.all(
          ids.map(mid =>
            getSafe<RocMeter>(api, `/rateofchange/meters/${encodeURIComponent(mid)}/period-end/${encodeURIComponent(ymd)}`, setRocErr)
          )
        ).then(results => {
          const map: Record<string, number | null> = {};
          results.forEach(r => { if (r) map[r.meter_id] = r.rate_of_change ?? null; });
          setRocMap(map);
        });

        getSafe<RocTenant>(api, `/rateofchange/tenants/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ymd)}`, setRocErr)
          .then((roc) => setRocTenant(roc));

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

  /* ==================== CSV (unchanged) ==================== */
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

  /* ==================== Render ==================== */
  const Header = (
    <View style={styles.header}>
      <Text style={styles.title}>Generate Billing</Text>
      <View style={styles.modeChips}>
        <Chip label="New JSON" active={mode === "v2"} onPress={() => setMode("v2")} />
        <Chip label="Tenant (legacy)" active={mode === "tenant"} onPress={() => setMode("tenant")} />
        <Chip label="Meter (legacy)" active={mode === "meter"} onPress={() => setMode("meter")} />
      </View>
    </View>
  );

  const Inputs = (
    <View style={styles.inputs}>
      {mode !== "meter" && (
        <TextInput
          value={tenantId}
          onChangeText={setTenantId}
          placeholder="Tenant ID (e.g., TNT-1)"
          placeholderTextColor="#9aa5b1"
          style={[styles.input, { minWidth: 180 }]}
          autoCapitalize="characters"
        />
      )}
      {mode !== "tenant" && (
        <TextInput
          value={meterId}
          onChangeText={setMeterId}
          placeholder="Meter ID (e.g., MTR-1)"
          placeholderTextColor="#9aa5b1"
          style={[styles.input, { minWidth: 160 }]}
          autoCapitalize="characters"
        />
      )}
      <TextInput
        value={endDate}
        onChangeText={setEndDate}
        placeholder="YYYY-MM-DD (period end)"
        placeholderTextColor="#9aa5b1"
        style={[styles.input, { width: 170 }]}
      />
      <TextInput
        value={penaltyRate}
        onChangeText={setPenaltyRate}
        placeholder="Penalty % (optional)"
        placeholderTextColor="#9aa5b1"
        keyboardType="numeric"
        style={[styles.input, { width: 150 }]}
      />
      <TouchableOpacity style={[styles.btn, (!canRun || busy) && styles.btnDisabled]} onPress={run} disabled={!canRun || busy}>
        {busy ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="flash-outline" size={16} color="#fff" style={{ marginRight: 6 }} /><Text style={styles.btnText}>Generate</Text></>)}
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btnGhost, !(v2 || legacy) && styles.btnGhostDisabled]} onPress={exportCsv} disabled={!(v2 || legacy)}>
        <Ionicons name="download-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
        <Text style={styles.btnGhostText}>Export CSV</Text>
      </TouchableOpacity>
    </View>
  );

  const UsageTrendCard = ({ curr, prev, roc }: { curr: number | null | undefined; prev: number | null | undefined; roc: number | null | undefined }) => {
    const computed = computeROC(curr ?? null, prev ?? null);
    return (
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Usage Trend</Text>
        <View style={styles.row}><Text style={styles.rowKey}>Current Consumption</Text><Text style={styles.rowVal}>{fmt(curr, 0)}</Text></View>
        <View style={styles.row}><Text style={styles.rowKey}>Previous Consumption</Text><Text style={styles.rowVal}>{fmt(prev, 0)}</Text></View>
        <View style={[styles.row, styles.rowStrong]}>
          <Text style={[styles.rowKey, styles.rowStrongText]}>Rate of Change</Text>
          <Badge value={roc ?? computed} />
        </View>
      </View>
    );
  };

  const V2Block = ({ r }: { r: BillingV2 }) => (
    <View>
      <View style={styles.card}>
        <Text style={styles.metaLine}>Generated: <Text style={styles.metaStrong}>{r.generated_at}</Text></Text>
        <Text style={styles.metaLine}>Current Period: <Text style={styles.metaStrong}>{r.period.current.start} → {r.period.current.end}</Text></Text>
        <Text style={styles.metaLine}>Previous Period: <Text style={styles.metaStrong}>{r.period.previous.start} → {r.period.previous.end}</Text></Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Tenant</Text>
        <Text style={styles.metaLine}>ID: <Text style={styles.metaStrong}>{r.tenant?.tenant_id || "—"}</Text></Text>
        <Text style={styles.metaLine}>Name: <Text style={styles.metaStrong}>{r.tenant?.tenant_name || "—"}</Text></Text>
        <Text style={styles.metaLine}>VAT: <Text style={styles.metaStrong}>{r.tenant?.vat_code || "—"}</Text></Text>
        <Text style={styles.metaLine}>WT: <Text style={styles.metaStrong}>{r.tenant?.wt_code || "—"}</Text></Text>
        <Text style={styles.metaLine}>Penalty?: <Text style={styles.metaStrong}>{r.tenant?.for_penalty ? "Yes" : "No"}</Text></Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Meter</Text>
        <Text style={styles.metaLine}>ID: <Text style={styles.metaStrong}>{r.meter.meter_id}</Text></Text>
        <Text style={styles.metaLine}>SN: <Text style={styles.metaStrong}>{r.meter.meter_sn}</Text></Text>
        <Text style={styles.metaLine}>Type: <Text style={styles.metaStrong}>{String(r.meter.meter_type).toUpperCase()}</Text></Text>
        <Text style={styles.metaLine}>Multiplier: <Text style={styles.metaStrong}>{r.meter.meter_mult ?? "—"}</Text></Text>
        <Text style={[styles.metaLine, { marginTop: 8 }]}>Prev Index: <Text style={styles.metaStrong}>{fmt(r.indices.prev_index, 0)}</Text>   •   Curr Index: <Text style={styles.metaStrong}>{fmt(r.indices.curr_index, 0)}</Text></Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Charges</Text>
        <View style={styles.row}><Text style={styles.rowKey}>Consumption</Text><Text style={styles.rowVal}>{fmt(r.billing.consumption, 0)}</Text></View>
        <View style={styles.row}><Text style={styles.rowKey}>Base</Text><Text style={styles.rowVal}>{peso(r.billing.base)}</Text></View>
        <View style={styles.row}><Text style={styles.rowKey}>VAT</Text><Text style={styles.rowVal}>{peso(r.billing.vat)}</Text></View>
        <View style={styles.row}><Text style={styles.rowKey}>Withholding</Text><Text style={styles.rowVal}>{peso(r.billing.wt)}</Text></View>
        <View style={styles.row}>
          <Text style={styles.rowKey}>
            Penalty{r.tenant?.for_penalty === false ? " — disabled for tenant" : ""}
          </Text>
          <Text style={styles.rowVal}>{peso(r.billing.penalty)}</Text>
        </View>
        <View style={[styles.row, styles.rowStrong]}><Text style={[styles.rowKey, styles.rowStrongText]}>TOTAL</Text><Text style={[styles.rowVal, styles.rowStrongText]}>{peso(r.billing.total)}</Text></View>
      </View>

      <UsageTrendCard
        curr={rocMeter?.meter_id === r.meter.meter_id ? rocMeter?.current_consumption : r.billing.consumption}
        prev={rocMeter?.meter_id === r.meter.meter_id ? rocMeter?.previous_consumption : undefined}
        roc={rocMeter?.meter_id === r.meter.meter_id ? rocMeter?.rate_of_change : undefined}
      />

      {r.totals && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Totals (All)</Text>
          <View style={styles.row}><Text style={styles.rowKey}>Consumption</Text><Text style={styles.rowVal}>{fmt(r.totals.consumption, 0)}</Text></View>
          <View style={styles.row}><Text style={styles.rowKey}>Base</Text><Text style={styles.rowVal}>{peso(r.totals.base)}</Text></View>
          <View style={styles.row}><Text style={styles.rowKey}>VAT</Text><Text style={styles.rowVal}>{peso(r.totals.vat)}</Text></View>
          <View style={styles.row}><Text style={styles.rowKey}>Withholding</Text><Text style={styles.rowVal}>{peso(r.totals.wt)}</Text></View>
          <View style={styles.row}><Text style={styles.rowKey}>Penalty</Text><Text style={styles.rowVal}>{peso(r.totals.penalty)}</Text></View>
          <View style={[styles.row, styles.rowStrong]}><Text style={[styles.rowKey, styles.rowStrongText]}>TOTAL</Text><Text style={[styles.rowVal, styles.rowStrongText]}>{peso(r.totals.total)}</Text></View>
        </View>
      )}
    </View>
  );

  const LegacyBlock = ({ r }: { r: TenantBillingLegacy }) => {
    const empty = !r.meters || r.meters.length === 0;

    // Meter ROC chooser: tenant ROC -> fan-out map -> local compute -> single-meter ROC
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

    // ---- Robust trend inputs (ALWAYS try to get prev/curr)
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
    // -----------------------------------------------

    return (
      <View>
        <View style={styles.card}>
          <Text style={styles.metaLine}>Tenant: <Text style={styles.metaStrong}>{r.tenant_id}</Text></Text>
          <Text style={styles.metaLine}>Period End: <Text style={styles.metaStrong}>{r.end_date}</Text></Text>
          <Text style={styles.metaLine}>Generated: <Text style={styles.metaStrong}>{r.generated_at}</Text></Text>
        </View>

        {empty && (
          <View style={[styles.card, { backgroundColor: "#fff7ed", borderColor: "#fdba74" }]}>
            <Text style={{ color: "#9a3412", fontWeight: "700", marginBottom: 4 }}>No meters found for this tenant.</Text>
            <Text style={{ color: "#9a3412" }}>Tips: Check the tenant ID (uppercase), permissions, and meters assignment.</Text>
          </View>
        )}

        {!empty && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Meters</Text>
            <FlatList
              data={r.meters || []}
              keyExtractor={(m, i) => (m.meter_id ? String(m.meter_id) : `m-${i}`)}
              renderItem={({ item }) => (
                <View style={styles.rowItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {(item.meter_id || "—")} <Text style={styles.rowSub}>({String(item.meter_type || "—").toUpperCase()})</Text>
                    </Text>
                    <Text style={styles.rowMetaSmall}>
                      Current: {fmt(item.current_index)} • Previous: {fmt(item.previous_index)} • Cons: {fmt(item.current_consumption)}
                      {item.previous_consumption !== null && item.previous_consumption !== undefined
                        ? ` (prev ${fmt(item.previous_consumption)})`
                        : ""}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={styles.rowMetaSmall}>ROC:</Text>
                      <Badge value={meterROC(item)} />
                    </View>
                  </View>
                  <Text style={styles.charge}>{peso(item.charge)}</Text>
                </View>
              )}
              scrollEnabled={false}
              ListEmptyComponent={<Text style={styles.emptySmall}>No meters found.</Text>}
            />
            {rocErr ? (
              <Text style={{ marginTop: 6, color: "#9a3412" }}>
                ROC note: {rocErr}
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Grand Totals</Text>
          <View style={styles.row}><Text style={styles.rowKey}>Consumption</Text><Text style={styles.rowVal}>{fmt(r.grand_totals.current_consumption, 0)}</Text></View>
          <View style={styles.row}><Text style={styles.rowKey}>Meters</Text><Text style={styles.rowVal}>{fmt(r.grand_totals.meters, 0)}</Text></View>
          <View style={[styles.row, styles.rowStrong, { alignItems: "center" }]}>
            <Text style={[styles.rowKey, styles.rowStrongText]}>Charge</Text>
            <Text style={[styles.rowVal, styles.rowStrongText]}>{peso(r.grand_totals.charge)}</Text>
          </View>
        </View>

        <UsageTrendCard curr={trendCurr} prev={trendPrev} roc={trendROC} />
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      {Header}
      {Inputs}
      {!v2 && !legacy ? (
        <View style={styles.empty}><Text style={styles.emptyText}>Enter IDs and date, then tap Generate.</Text></View>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          {v2 && <V2Block r={v2} />}
          {legacy && <LegacyBlock r={legacy} />}
        </ScrollView>
      )}
    </View>
  );
}

/* ==================== Styles ==================== */
const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, backgroundColor: "#f6f8fb" },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 10, justifyContent: "space-between" },
  title: { fontSize: 18, fontWeight: "700", color: "#102a43" },
  modeChips: { flexDirection: "row", gap: 8 },

  inputs: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 },
  input: {
    backgroundColor: "#fff",
    borderColor: "#dbe2ef",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#102a43",
  },

  btn: { flexDirection: "row", alignItems: "center", backgroundColor: "#2563eb", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "600" },

  btnGhost: { flexDirection: "row", alignItems: "center", backgroundColor: "#e8eefc", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnGhostDisabled: { opacity: 0.5 },
  btnGhostText: { color: "#394e6a", fontWeight: "600" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: "#7b8794" },
  emptySmall: { color: "#7b8794", paddingHorizontal: 8, paddingVertical: 14 },

  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb", padding: 12, marginBottom: 10 },
  sectionTitle: { marginBottom: 6, color: "#0f172a", fontWeight: "700" },
  metaLine: { color: "#334155", marginBottom: 2 },
  metaStrong: { fontWeight: "700" },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#f0f2f7" },
  rowStrong: { borderBottomWidth: 0, paddingTop: 12, backgroundColor: "#f1f5ff", borderRadius: 8 },
  rowKey: { color: "#475569", fontWeight: "700" },
  rowVal: { color: "#1e293b" },
  rowStrongText: { fontWeight: "900", color: "#0f172a", letterSpacing: 0.25, fontSize: 16 },

  rowItem: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e5e7eb", padding: 12, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontWeight: "400" },
  rowMetaSmall: { color: "#64748b", marginTop: 2, fontSize: 12 },
  charge: { fontSize: 16, fontWeight: "800", color: "#111827" },

  chip: { borderRadius: 999, borderWidth: 1, borderColor: "#cbd5e1", paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#fff" },
  chipActive: { backgroundColor: "#e7efff", borderColor: "#93c5fd" },
  chipIdle: {},
  chipText: { fontSize: 12, color: "#0f172a" },
  chipTextActive: { color: "#1d4ed8", fontWeight: "700" },
  chipTextIdle: { color: "#334155" },

  // ROC badges
  badgeBox: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" },
  badgeText: { fontWeight: "800", fontSize: 12 },
  badgeUpBox: { backgroundColor: "#dcfce7" },
  badgeUpText: { color: "#166534" },
  badgeDownBox: { backgroundColor: "#fee2e2" },
  badgeDownText: { color: "#991b1b" },
  badgeNeutralBox: { backgroundColor: "#e5e7eb" },
  badgeNeutralText: { color: "#111827" },
});