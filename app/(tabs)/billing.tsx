import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";

/* ===================== helpers ===================== */
const today = () => new Date().toISOString().slice(0, 10);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Alert that never shows [object Object] */
const alertx = (t: string, m?: unknown) => {
  const toMsg = (v: unknown) => {
    if (v === undefined || v === null) return "";
    if (typeof v === "string") return v;
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  };
  const body = toMsg(m);
  if (Platform.OS === "web") {
    window.alert(body ? `${t}\n\n${body}` : t);
  } else {
    Alert.alert(t, body || undefined);
  }
};

/** Robust error -> readable string */
const errText = (e: unknown): string => {
  const anyE = e as any;
  const r = anyE?.response;
  const d = r?.data;

  if (typeof d === "string") return d;
  if (d && (typeof d.error === "string" || typeof d.message === "string")) {
    return String(d.error || d.message);
  }
  if (r?.status) {
    const st = r.statusText ? ` ${r.statusText}` : "";
    try { return `HTTP ${r.status}${st}${d ? `\n${JSON.stringify(d)}` : ""}`; }
    catch { return `HTTP ${r.status}${st}`; }
  }
  if (anyE?.message) return String(anyE.message);
  try { return JSON.stringify(anyE); } catch { return "Server error."; }
};

/* stringify ANY value safely so <Text> never receives an object */
function isObj(v: any) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function truncate(s: string, n = 120) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function toText(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return truncate(v.map(toText).join(", "));
  if (isObj(v)) {
    if ("previous" in v || "current" in v) {
      const prev = toText((v as any).previous);
      const curr = toText((v as any).current);
      return `${prev} → ${curr}`;
    }
    if ("name" in v || "label" in v || "id" in v) {
      const name = (v as any).name ?? (v as any).label ?? (v as any).id;
      return toText(name);
    }
    try { return truncate(JSON.stringify(v)); } catch { return "[object]"; }
  }
  return String(v);
}

/* smart visual formatters */
function fmtDate(d?: string) { return d || "—"; }

type PeriodObj =
  | { start?: string; end?: string }
  | { previous?: { start?: string; end?: string }; current?: { start?: string; end?: string } }
  | any;

function renderPeriod(value: PeriodObj) {
  if (!value || typeof value !== "object") return <Text style={styles.fieldValue}>{toText(value)}</Text>;
  if ("previous" in value || "current" in value) {
    const prev = (value as any).previous || {};
    const curr = (value as any).current || {};
    return (
      <View style={{ gap: 2, alignItems: "flex-end" }}>
        <Text style={styles.fieldValue}>{fmtDate(prev.start)} – {fmtDate(prev.end)}</Text>
        <Text style={[styles.muted, { marginTop: -2 }]}>→</Text>
        <Text style={styles.fieldValue}>{fmtDate(curr.start)} – {fmtDate(curr.end)}</Text>
      </View>
    );
  }
  const start = (value as any).start, end = (value as any).end;
  if (start || end) return <Text style={styles.fieldValue}>{fmtDate(start)} – {fmtDate(end)}</Text>;
  return <Text style={styles.fieldValue}>{toText(value)}</Text>;
}

type TenantObj = { tenant_id?: string; tenant_name?: string; vat_code?: any; wt_code?: any; for_penalty?: any } | any;
function renderTenant(value: TenantObj) {
  if (!value || typeof value !== "object") return <Text style={styles.fieldValue}>{toText(value)}</Text>;
  const id = value.tenant_id ?? value.id;
  const name = value.tenant_name ?? value.name ?? value.label;
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={styles.fieldValue}>{name ?? "—"}</Text>
      {id ? <Text style={styles.muted}>{id}</Text> : null}
    </View>
  );
}

type MeterObj = { meter_id?: string; meter_sn?: string; meter_type?: string; meter_mult?: number } | any;
function renderMeter(value: MeterObj) {
  if (!value || typeof value !== "object") return <Text style={styles.fieldValue}>{toText(value)}</Text>;
  const id = value.meter_id ?? value.id;
  const sn = value.meter_sn ?? value.sn ?? value.serial_no;
  const type = value.meter_type ?? value.type;
  const mult = value.meter_mult ?? value.multiplier ?? value.mult;
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Text style={styles.fieldValue}>{id ?? "—"}</Text>
      <Text style={styles.muted}>
        {sn ? `SN: ${sn}` : ""}{sn && (type || mult) ? " · " : ""}{type ? `${type}` : ""}{type && mult ? " · " : ""}{mult ? `x${mult}` : ""}
      </Text>
    </View>
  );
}

/* small UI atoms */
const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
  </TouchableOpacity>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <View style={{ flex: 1 }}>{children}</View>
  </View>
);
const Divider = () => <View style={styles.divider} />;
const Field = ({ label, value }: { label: string; value: any }) => (
  <View style={styles.fieldRow}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Text style={styles.fieldValue}>{toText(value)}</Text>
  </View>
);

/* ===================== pretty renderers (no JSON walls) ===================== */
function BillingSummary({ data }: { data: any }) {
  if (!data) return <Text style={styles.muted}>No data yet.</Text>;

  // tolerant to various shapes
  const hdr = data.header || data.meta || data.summary || data;
  const totals = data.grand_totals || data.totals || data.result || {};
  const lines = data.meters || data.lines || data.items || [];

  const building = hdr.building_name || hdr.building || hdr.building_id;
  const tenant = hdr.tenant || hdr.tenant_obj || hdr.tenant_data || hdr.tenant_name || hdr.tenant_id;
  const meter = hdr.meter || hdr.meter_obj || hdr.meter_data || hdr.meter_id;
  const periodField = hdr.period ?? hdr.period_end ?? hdr.endDate ?? hdr.date;

  const prevRead = hdr.prev_reading ?? hdr.previous_reading ?? hdr.prev;
  const currRead = hdr.curr_reading ?? hdr.current_reading ?? hdr.curr;
  const usage = hdr.usage_kwh ?? hdr.usage ?? hdr.consumption_kwh ?? hdr.consumption;
  const demand = hdr.demand_kw ?? hdr.demand ?? hdr.kw_demand;

  const energy = totals.energy ?? totals.energy_amount ?? totals.kwh_amount;
  const demandAmt = totals.demand ?? totals.demand_amount;
  const other = totals.other_charges ?? totals.other ?? totals.adjustments;
  const vat = totals.vat ?? totals.vat_amount;
  const wt = totals.wt ?? totals.withholding_tax;
  const total = totals.grand_total ?? totals.total ?? totals.amount_due ?? totals.net_total;

  return (
    <View>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Header</Text>
      </View>
      <View style={styles.cardLite}>
        {/* Period (smart) */}
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Period</Text>
          {renderPeriod(periodField)}
        </View>

        {/* Tenant (smart) */}
        {tenant ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Tenant</Text>
            {typeof tenant === "object" ? renderTenant(tenant) : <Text style={styles.fieldValue}>{toText(tenant)}</Text>}
          </View>
        ) : null}

        {/* Building */}
        {building ? <Field label="Building" value={building} /> : null}

        {/* Meter (smart) */}
        {meter ? (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Meter</Text>
            {typeof meter === "object" ? renderMeter(meter) : <Text style={styles.fieldValue}>{toText(meter)}</Text>}
          </View>
        ) : null}

        {(prevRead ?? currRead ?? usage ?? demand) ? <Divider /> : null}
        {prevRead != null ? <Field label="Previous Reading" value={prevRead} /> : null}
        {currRead != null ? <Field label="Current Reading" value={currRead} /> : null}
        {usage != null ? <Field label="Usage (kWh)" value={usage} /> : null}
        {demand != null ? <Field label="Demand (kW)" value={demand} /> : null}
      </View>

      {Array.isArray(lines) && lines.length > 0 && (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Meters / Lines</Text>
          </View>
          <View style={styles.tableWrap}>
            <View style={[styles.tr, styles.trHead]}>
              <Text style={[styles.td, styles.colWide]}>Item</Text>
              <Text style={styles.td}>Usage</Text>
              <Text style={styles.td}>Rate</Text>
              <Text style={[styles.td, styles.tdRight]}>Amount</Text>
            </View>
            {lines.map((row: any, i: number) => {
              const name = row.meter_id || row.item || row.description || `Line ${i + 1}`;
              const usageCell = row.usage_kwh ?? row.consumption ?? row.kwh ?? row.qty ?? "—";
              const rateCell = row.rate_per_kwh ?? row.rate ?? row.price ?? "—";
              const amountCell = row.amount ?? row.line_total ?? row.subtotal ?? "—";
              return (
                <View key={i} style={styles.tr}>
                  <Text style={[styles.td, styles.colWide]} numberOfLines={1}>{toText(name)}</Text>
                  <Text style={styles.td}>{toText(usageCell)}</Text>
                  <Text style={styles.td}>{toText(rateCell)}</Text>
                  <Text style={[styles.td, styles.tdRight]}>{toText(amountCell)}</Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Totals</Text>
      </View>
      <View style={styles.cardLite}>
        {energy != null ? <Field label="Energy" value={energy} /> : null}
        {demandAmt != null ? <Field label="Demand" value={demandAmt} /> : null}
        {other != null ? <Field label="Other Charges" value={other} /> : null}
        {vat != null ? <Field label="VAT" value={vat} /> : null}
        {wt != null ? <Field label="Withholding Tax" value={wt} /> : null}
        <Divider />
        {total != null ? <Field label="Grand Total" value={total} /> : <Text style={styles.muted}>No total provided.</Text>}
      </View>
    </View>
  );
}

function RocSummary({ data, error }: { data: any; error?: string | null }) {
  if (error) return <Text style={[styles.muted, { color: "#b91c1c" }]}>{error}</Text>;
  if (!data) return <Text style={styles.muted}>No ROC data.</Text>;
  const meta = data.meta || data.header || data;
  const prev = data.prev || data.previous || data.previous_reading || meta.prev_reading;
  const curr = data.curr || data.current || data.current_reading || meta.curr_reading;
  const days = data.days || data.days_between || meta.days_between;
  const delta = (prev != null && curr != null) ? Number(curr) - Number(prev) : undefined;
  const roc = data.roc ?? data.rate_of_change ?? data.kwh_per_day ?? data.kw_per_day;

  return (
    <View style={styles.cardLite}>
      {meta.meter_id ? <Field label="Meter" value={meta.meter_id} /> : null}
      {meta.period_end ? <Field label="Period End" value={meta.period_end} /> : null}
      <Divider />
      {prev != null ? <Field label="Previous" value={prev} /> : null}
      {curr != null ? <Field label="Current" value={curr} /> : null}
      {days != null ? <Field label="Days" value={days} /> : null}
      {delta != null ? <Field label="Delta" value={delta} /> : null}
      {roc != null ? <Field label="Rate of Change" value={roc} /> : null}
    </View>
  );
}

/* ===================== main screen ===================== */
type Mode = "meter" | "tenant";

export default function Billings() {
  const { token } = useAuth();
  const [mode, setMode] = useState<Mode>("meter");
  const [meterId, setMeterId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [endDate, setEndDate] = useState(today());

  const [busyBill, setBusyBill] = useState(false);
  const [busyRoc, setBusyRoc] = useState(false);

  const [billing, setBilling] = useState<any>(null);
  const [roc, setRoc] = useState<any>(null);
  const [rocError, setRocError] = useState<string | null>(null);

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        timeout: 20000,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }),
    [token]
  );

  const computeBilling = async () => {
    if (!token) return alertx("Not logged in", "Please log in first.");
    if (!isYmd(endDate)) return alertx("Invalid endDate", "Use YYYY-MM-DD.");
    if (mode === "meter" && !meterId.trim()) return alertx("Missing meter_id");
    if (mode === "tenant" && !tenantId.trim()) return alertx("Missing tenant_id");

    try {
      setBusyBill(true);
      setBilling(null);
      setRoc(null);
      setRocError(null);

      const url =
        mode === "meter"
          ? `/billings/meters/${encodeURIComponent(meterId.trim())}/period-end/${endDate}`
          : `/billings/tenants/${encodeURIComponent(tenantId.trim())}/period-end/${endDate}`;

      const { data } = await api.get(url);
      setBilling(data);
    } catch (e: unknown) {
      const msg = errText(e);
      alertx("Billing failed", msg);
      const ax = e as { response?: { data?: any } } | undefined;
      console.error("Billing error:", ax?.response?.data ?? e);
    } finally {
      setBusyBill(false);
    }
  };

  const computeRoc = async () => {
    if (!token) return alertx("Not logged in", "Please log in first.");
    if (!isYmd(endDate)) return alertx("Invalid endDate", "Use YYYY-MM-DD.");
    if (!meterId.trim()) return alertx("Missing meter_id", "ROC requires a meter.");

    try {
      setBusyRoc(true);
      setRoc(null);
      setRocError(null);
      // Backend is /rateofchange (no hyphen)
      const { data } = await api.get(
        `/rateofchange/meters/${encodeURIComponent(meterId.trim())}/period-end/${endDate}`
      );
      setRoc(data);
    } catch (e: unknown) {
      const msg = errText(e);
      setRocError(msg);
      alertx("Rate of Change failed", msg);
      const ax = e as { response?: { data?: any } } | undefined;
      console.error("Rate of Change error:", ax?.response?.data ?? e);
    } finally {
      setBusyRoc(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        {/* header */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Billings</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={styles.btnPrimary} onPress={computeBilling} disabled={busyBill}>
              {busyBill ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Compute</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnGhost}
              onPress={computeRoc}
              disabled={busyRoc || mode !== "meter"}
            >
              <Ionicons name="trending-up-outline" size={16} color="#0f172a" style={{ marginRight: 6 }} />
              <Text style={styles.btnGhostText}>Rate of Change</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* mode chips */}
        <View style={styles.chipsRow}>
          <Chip label="By Meter" active={mode === "meter"} onPress={() => setMode("meter")} />
          <Chip label="By Tenant" active={mode === "tenant"} onPress={() => setMode("tenant")} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
          {mode === "meter" ? (
            <Row label="Meter ID">
              <View style={styles.inputWrap}>
                <Ionicons name="speedometer-outline" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
                <TextInput
                  value={meterId}
                  onChangeText={setMeterId}
                  placeholder="e.g. MTR-1001"
                  placeholderTextColor="#9aa5b1"
                  style={styles.input}
                  autoCapitalize="characters"
                />
              </View>
            </Row>
          ) : (
            <Row label="Tenant ID">
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
                <TextInput
                  value={tenantId}
                  onChangeText={setTenantId}
                  placeholder="e.g. TNT-001"
                  placeholderTextColor="#9aa5b1"
                  style={styles.input}
                  autoCapitalize="none"
                />
              </View>
            </Row>
          )}

          <Row label="Period End (YYYY-MM-DD)">
            <View style={styles.inputWrap}>
              <Ionicons name="calendar-outline" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9aa5b1"
                style={styles.input}
                autoCapitalize="none"
              />
            </View>
          </Row>

          {/* results */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Billing Result</Text>
            <Text style={styles.muted}>Clean summary and totals.</Text>
          </View>
          <View style={styles.resultCard}>
            {busyBill ? <ActivityIndicator /> : <BillingSummary data={billing} />}
          </View>

          {mode === "meter" && (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Rate of Change</Text>
                <Text style={styles.muted}>Usage trend for the selected meter.</Text>
              </View>
              <View style={styles.resultCard}>
                {busyRoc ? <ActivityIndicator /> : <RocSummary data={roc} error={rocError} />}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/* ===================== styles ===================== */
const styles = StyleSheet.create({
  page: { padding: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    ...(Platform.select({ web: { boxShadow: "0 6px 24px rgba(16,42,67,.08)" } }) as any),
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#0f172a" },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "#cbd5e1" },
  chipActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  chipIdle: {},
  chipText: { fontSize: 12, color: "#0f172a" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  chipTextIdle: {},

  row: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  label: { width: 170, color: "#334155", fontWeight: "700" },

  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#fff",
  },
  input: { flex: 1, minHeight: 20, color: "#0f172a" },

  btnPrimary: { backgroundColor: "#2563eb", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  btnPrimaryText: { color: "#fff", fontWeight: "800" },
  btnGhost: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#e2e8f0", borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10,
  },
  btnGhostText: { color: "#0f172a", fontWeight: "800" },

  sectionHead: { marginTop: 10, marginBottom: 6 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  muted: { fontSize: 12, color: "#6b7280" },

  resultCard: {
    backgroundColor: "#f8fafc", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#e2e8f0",
    marginBottom: 10,
  },

  /* pretty cards */
  cardLite: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, padding: 10 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 },
  fieldLabel: { color: "#475569", fontWeight: "600" },
  fieldValue: { color: "#0f172a", fontWeight: "700", textAlign: "right", maxWidth: "70%" },
  divider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 6 },

  /* minimalist table */
  tableWrap: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 10, overflow: "hidden" },
  tr: { flexDirection: "row" },
  trHead: { backgroundColor: "#eef2ff" },
  td: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  colWide: { flex: 1.6 },
  tdRight: { textAlign: "right" },
});