// app/(tabs)/billing.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

// 📌 NEW: import your ROC panel (no props required)
import RateOfChangePanel from "../../components/billing/RateOfChangePanel";

/** ================= Types that match /billings (building clean output) ================= */
type BillingRow = {
  stall_no: string | null;
  stall_sn: string | null;
  tenant_id: string | null;
  tenant_sn: string | null;
  tenant_name: string | null;
  meter_no: string | null;
  meter_id: string;
  mult: number;
  reading_previous: number;
  reading_present: number;
  consumed_kwh: number;
  utility_rate: number | null;
  markup_rate: number;
  system_rate: number | null;
  vat_rate: number | null;
  total_amount: number;
  prev_consumed_kwh: number | null;
  rate_of_change_pct: number | null;
  tax_code: string | null;     // VAT code
  whtax_code: string | null;   // WT code
  for_penalty: boolean;
  meter_type: string | null;
};

type BillingTenant = {
  tenant_id: string | null;
  tenant_name?: string | null;
  rows: BillingRow[];
};

type BillingTotals = { total_consumed_kwh: number; total_amount: number };

type BuildingBillingResponse = {
  building_id: string;
  period: { start: string; end: string };
  tenants: BillingTenant[];
  totals: BillingTotals;
  generated_at: string;
};

/** =============== Helpers =============== */
const notify = (title: string, message?: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};
const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: any) =>
  v == null || v === "" || isNaN(Number(v)) ? null : Number(v);
const fmt = (v: number | string | null | undefined, d = 2) => {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n)
    ? Intl.NumberFormat(undefined, {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(Number(n))
    : String(v);
};

/** Make CSV and (on web) trigger a download */
function saveCsv(filename: string, csv: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.URL) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  } else {
    notify("CSV created", "Use Share/Downloads feature on your device.");
  }
}

/** ================= Component ================= */
export default function BillingScreen() {
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const headerToken =
    token && /^Bearer\s/i.test(token.trim())
      ? token.trim()
      : token
      ? `Bearer ${token.trim()}`
      : "";
  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        timeout: 20000,
        headers: headerToken ? { Authorization: headerToken } : {},
      }),
    [headerToken]
  );

  // Inputs
  const [buildingId, setBuildingId] = useState("");
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    return `${y}-${String(m + 1).padStart(2, "0")}-21`;
  });
  const [endDate, setEndDate] = useState<string>(() => today());
  const [penaltyRate, setPenaltyRate] = useState<string>("0"); // percent

  // Data
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<BuildingBillingResponse | null>(null);
  const [error, setError] = useState<string>("");

  const canRun =
    !!buildingId && isYMD(startDate) && isYMD(endDate) && !!token && !busy;

  /** Generate building billing */
  const onGenerate = async () => {
    if (!token) return notify("Not logged in", "Please sign in first.");
    if (!buildingId.trim()) return notify("Missing building", "Enter building ID.");
    if (!isYMD(startDate) || !isYMD(endDate))
      return notify("Invalid dates", "Use YYYY-MM-DD.");

    setBusy(true);
    setError("");
    setPayload(null);

    try {
      const url = `/billings/buildings/${encodeURIComponent(
        buildingId.trim()
      )}/period-start/${startDate}/period-end/${endDate}`;
      const res = await api.get<BuildingBillingResponse>(url, {
        params: { penalty_rate: num(penaltyRate) ?? 0 },
      });
      setPayload(res.data || null);
    } catch (e: any) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Server error.";
      setError(String(msg));
      notify("Generate failed", String(msg));
    } finally {
      setBusy(false);
    }
  };

  /** Export CSV for whole building (tenants + rows) */
  const onExportCsv = () => {
    if (!payload) return notify("Nothing to export", "Generate a report first.");
    const lines: string[] = [];
    lines.push(
      [
        "Building ID",
        "Period Start",
        "Period End",
        "Tenant ID",
        "Tenant Name",
        "Stall No",
        "Stall SN",
        "Meter ID",
        "Meter SN",
        "Type",
        "Mult",
        "Prev Index",
        "Curr Index",
        "Prev kWh",
        "Curr kWh",
        "Rate of Change %",
        "Utility Rate",
        "Markup Rate",
        "System Rate",
        "VAT Rate",
        "VAT Code",
        "WHTAX Code",
        "For Penalty",
        "Total Amount",
      ]
        .map((h) => `"${h}"`)
        .join(",")
    );

    payload.tenants.forEach((t) => {
      t.rows.forEach((r) => {
        lines.push(
          [
            payload.building_id,
            payload.period.start,
            payload.period.end,
            r.tenant_id ?? "",
            r.tenant_name ?? "",
            r.stall_no ?? "",
            r.stall_sn ?? "",
            r.meter_id,
            r.meter_no ?? "",
            r.meter_type ?? "",
            r.mult ?? "",
            r.reading_previous,
            r.reading_present,
            r.prev_consumed_kwh ?? "",
            r.consumed_kwh,
            r.rate_of_change_pct ?? "",
            r.utility_rate ?? "",
            r.markup_rate ?? "",
            r.system_rate ?? "",
            r.vat_rate ?? "",
            r.tax_code ?? "",
            r.whtax_code ?? "",
            r.for_penalty ? "YES" : "NO",
            r.total_amount,
          ]
            .map((v) => {
              const s = String(v ?? "");
              return `"${s.replace(/"/g, '""')}"`;
            })
            .join(",")
        );
      });
    });

    const fn = `billing_${payload.building_id}_${payload.period.start}_${payload.period.end}.csv`;
    saveCsv(fn, lines.join("\n"));
  };

  const labelW = isMobile ? "100%" : 160;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Title */}
      <View style={styles.header}>
        <Text style={styles.title}>Billing (Per Building)</Text>
        <Text style={styles.subtitle}>
          Generate building billing grouped by tenant with per-meter rows and totals.
        </Text>
      </View>

      {/* Form */}
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={[styles.label, { width: labelW }]}>Building ID</Text>
          <TextInput
            value={buildingId}
            onChangeText={setBuildingId}
            placeholder="e.g. BLDG-1"
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { width: labelW }]}>Period Start</Text>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
            keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { width: labelW }]}>Period End</Text>
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { width: labelW }]}>Penalty Rate (%)</Text>
          <TextInput
            value={penaltyRate}
            onChangeText={setPenaltyRate}
            placeholder="0"
            keyboardType="numeric"
            style={styles.input}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            disabled={!canRun}
            style={[styles.btn, !canRun && styles.btnDisabled]}
            onPress={onGenerate}
          >
            <Ionicons name="flash" size={16} color="#fff" />
            <Text style={styles.btnText}>Generate</Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!payload}
            style={[styles.btnSecondary, !payload && styles.btnSecondaryDisabled]}
            onPress={onExportCsv}
          >
            <Ionicons name="download" size={16} color="#0f172a" />
            <Text style={styles.btnSecondaryText}>Export CSV</Text>
          </TouchableOpacity>
        </View>
      </View>

      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Computing billing…</Text>
        </View>
      ) : error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : payload ? (
        <View style={{ gap: 12 }}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>
              {payload.building_id} • {payload.period.start} → {payload.period.end}
            </Text>
            <Text style={styles.summaryLine}>
              Total Consumption: <Text style={styles.kbd}>{fmt(payload.totals.total_consumed_kwh, 2)}</Text> kWh
            </Text>
            <Text style={styles.summaryLine}>
              Total Amount: <Text style={styles.kbd}>₱ {fmt(payload.totals.total_amount, 2)}</Text>
            </Text>
            <Text style={styles.summaryAt}>Generated at {payload.generated_at}</Text>
          </View>

          {/* Tenants */}
          {payload.tenants.map((t, ti) => (
            <View key={`${ti}-${t.tenant_id}`} style={styles.tenantCard}>
              <View style={styles.tenantHeader}>
                <Ionicons name="person" size={16} color="#0ea5e9" />
                <Text style={styles.tenantTitle}>
                  {t.rows[0]?.tenant_sn ? `${t.rows[0].tenant_sn} • ` : ""}
                  {t.rows[0]?.tenant_name ?? t.tenant_id ?? "Tenant"}
                </Text>
              </View>

              {/* Table header */}
              <View style={[styles.tableRow, styles.tableHead]}>
                {[
                  "Stall",
                  "Meter",
                  "Type",
                  "Mult",
                  "PrevIdx",
                  "CurrIdx",
                  "Prev kWh",
                  "Curr kWh",
                  "ROC %",
                  "Sys Rate",
                  "VAT %",
                  "VAT Code",
                  "WT Code",
                  "Penalty",
                  "Total (₱)",
                ].map((h) => (
                  <Text key={h} style={[styles.cell, styles.hCell]}>
                    {h}
                  </Text>
                ))}
              </View>

              {/* Rows */}
              {t.rows.map((r, ri) => (
                <View key={`${ri}-${r.meter_id}`} style={styles.tableRow}>
                  <Text style={styles.cell}>{r.stall_sn || r.stall_no || "—"}</Text>
                  <Text style={styles.cell}>{r.meter_no || r.meter_id}</Text>
                  <Text style={styles.cell}>{(r.meter_type || "").toUpperCase()}</Text>
                  <Text style={[styles.cell, styles.right]}>{fmt(r.mult, 0)}</Text>
                  <Text style={[styles.cell, styles.right]}>{fmt(r.reading_previous, 0)}</Text>
                  <Text style={[styles.cell, styles.right]}>{fmt(r.reading_present, 0)}</Text>
                  <Text style={[styles.cell, styles.right]}>{fmt(r.prev_consumed_kwh, 0)}</Text>
                  <Text style={[styles.cell, styles.right]}>{fmt(r.consumed_kwh, 0)}</Text>
                  <Text style={[styles.cell, styles.right]}>
                    {r.rate_of_change_pct == null ? "—" : `${fmt(r.rate_of_change_pct, 0)}%`}
                  </Text>
                  <Text style={[styles.cell, styles.right]}>
                    {r.system_rate == null ? "—" : fmt(r.system_rate, 4)}
                  </Text>
                  <Text style={[styles.cell, styles.right]}>
                    {r.vat_rate == null ? "—" : `${fmt((r.vat_rate as number) * 100, 2)}%`}
                  </Text>
                  <Text style={styles.cell}>{r.tax_code || "—"}</Text>
                  <Text style={styles.cell}>{r.whtax_code || "—"}</Text>
                  <Text style={styles.cell}>{r.for_penalty ? "YES" : "NO"}</Text>
                  <Text style={[styles.cell, styles.right]}>₱ {fmt(r.total_amount, 2)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.blank}>
          <Text style={styles.blankText}>Enter details above and tap Generate.</Text>
        </View>
      )}

      {/* =========================================================
         Rate of Change & Comparisons (embedded panel)
         ---------------------------------------------------------
         - Uses your updated RateOfChangePanel that reads token
           from AuthContext (no props needed).
         - Lets you quickly run Building/Tenant/Meter comparisons
           without leaving the Billing tab.
         ========================================================= */}
      <View style={{ marginTop: 18 }}>
        <Text style={styles.sectionTitle}>Rate of Change & Comparisons</Text>
        <Text style={styles.sectionNote}>
          Run ROC and monthly/quarterly/yearly comparisons. (This panel uses the same auth session.)
        </Text>
        <RateOfChangePanel />
      </View>
    </ScrollView>
  );
}

/** =============== Styles =============== */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  header: { padding: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#475569", marginTop: 4 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  label: { color: "#334155", fontSize: 13, fontWeight: "600", marginRight: 10 },
  input: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
  },

  actions: { flexDirection: "row", gap: 10, marginTop: 8, flexWrap: "wrap" },
  btn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: "#0ea5e9",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnDisabled: { opacity: 0.5 },

  btnSecondary: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnSecondaryText: { color: "#0f172a", fontWeight: "700" },
  btnSecondaryDisabled: { opacity: 0.5 },

  loading: { alignItems: "center", paddingVertical: 24 },
  loadingText: { marginTop: 8, color: "#475569" },

  errorWrap: {
    backgroundColor: "#fee2e2",
    borderRadius: 10,
    padding: 10,
    marginHorizontal: 16,
    marginTop: 8,
  },
  errorText: { color: "#991b1b" },

  summaryCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 6,
    borderColor: "#e2e8f0",
    borderWidth: 1,
  },
  summaryTitle: { fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  summaryLine: { color: "#334155", marginTop: 2 },
  summaryAt: { color: "#64748b", fontSize: 12, marginTop: 8 },
  kbd: {
    backgroundColor: "#0ea5e91A",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    fontWeight: "700",
  },

  tenantCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 10,
    marginHorizontal: 16,
    marginTop: 12,
    borderColor: "#e2e8f0",
    borderWidth: 1,
  },
  tenantHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  tenantTitle: { fontWeight: "700", color: "#0f172a" },

  tableRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    borderBottomColor: "#eef2f7",
    borderBottomWidth: 1,
  },
  tableHead: { backgroundColor: "#f8fafc" },
  cell: { flexBasis: 120, paddingVertical: 6, paddingRight: 8, color: "#0f172a" },
  hCell: { fontWeight: "700", color: "#334155" },
  right: { textAlign: "right" },

  blank: { alignItems: "center", padding: 24 },
  blankText: { color: "#64748b" },

  sectionTitle: {
    marginHorizontal: 16,
    marginTop: 6,
    fontSize: 16,
    fontWeight: "700",
    color: "#0f172a",
  },
  sectionNote: { marginHorizontal: 16, color: "#334155", marginBottom: 6 },
});