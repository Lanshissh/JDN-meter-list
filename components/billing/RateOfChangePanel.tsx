// components/billing/RateOfChangePanel.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, FlatList, Platform
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

type RocMeter = {
  meter_id: string;
  meter_type: string;
  building_id: string;
  period: { current: { start: string; end: string }, previous: { start: string; end: string } };
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

function notify(title: string, msg?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
    window.alert(msg ? `${title}\n\n${msg}` : title);
  } else {
    Alert.alert(title, msg);
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number | null | undefined, d = 2) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n));
};

export default function RateOfChangePanel({ token }: { token: string | null }) {
  const [mode, setMode] = useState<"tenant" | "meter">("tenant");
  const [endDate, setEndDate] = useState(today());
  const [tenantId, setTenantId] = useState("");
  const [meterId, setMeterId] = useState("");

  const [busy, setBusy] = useState(false);
  const [meterRows, setMeterRows] = useState<RocMeter[] | null>(null);
  const [tenantTotals, setTenantTotals] = useState<RocTenant["totals"] | null>(null);

  const api = useMemo(
    () => axios.create({
      baseURL: BASE_API,
      timeout: 15000,
      headers: { Authorization: `Bearer ${token ?? ""}` }
    }),
    [token]
  );

  const ROC_BASES = ["/rateofchange", "/roc"]; // if your server mounts a shorter alias, we’ll try both.

  async function fetchRocTenant(id: string, date: string): Promise<RocTenant | null> {
    for (const base of ROC_BASES) {
      try {
        const { data } = await api.get<RocTenant>(`${base}/tenants/${encodeURIComponent(id)}/period-end/${date}`);
        return data;
      } catch (e: any) {
        // keep trying next base unless 401/403 (auth/scope)
        if ([401,403].includes(e?.response?.status)) throw e;
      }
    }
    return null;
  }

  async function fetchRocMeter(id: string, date: string): Promise<RocMeter | null> {
    for (const base of ROC_BASES) {
      try {
        const { data } = await api.get<RocMeter>(`${base}/meters/${encodeURIComponent(id)}/period-end/${date}`);
        return data;
      } catch (e: any) {
        if ([401,403].includes(e?.response?.status)) throw e;
      }
    }
    return null;
  }

  const onRun = async () => {
    if (!token) { notify("Not logged in", "Please sign in first."); return; }
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(endDate);
    if (!dateOk) { notify("Invalid end date", "Use YYYY-MM-DD."); return; }

    try {
      setBusy(true);
      setMeterRows(null);
      setTenantTotals(null);

      if (mode === "tenant") {
        if (!tenantId.trim()) { notify("Missing tenant", "Enter a tenant id (e.g. TNT-1)."); return; }
        const res = await fetchRocTenant(tenantId.trim(), endDate);
        if (!res) { notify("Not found", "ROC endpoint not found or tenant has no data for the period."); return; }
        setMeterRows(res.meters || []);
        setTenantTotals(res.totals || null);
      } else {
        if (!meterId.trim()) { notify("Missing meter", "Enter a meter id (e.g. MTR-1)."); return; }
        const row = await fetchRocMeter(meterId.trim(), endDate);
        if (!row) { notify("Not found", "Meter not found or no data for the selected period."); return; }
        setMeterRows([row]);
        setTenantTotals(null);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Server error.";
      notify("Rate of Change failed", msg);
    } finally {
      setBusy(false);
    }
  };

  const Header = () => (
    <View style={styles.headerRow}>
      <Text style={styles.title}>Rate of Change</Text>
      <Text style={styles.subtitle}>Compare current vs previous month consumption by tenant or by meter.</Text>
    </View>
  );

  const Toolbar = () => (
    <View style={styles.toolbar}>
      <View style={styles.modeSwitch}>
        <TouchableOpacity
          onPress={() => setMode("tenant")}
          style={[styles.modeBtn, mode === "tenant" && styles.modeBtnActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === "tenant" }}
        >
          <Ionicons name="people-outline" size={16} color={mode === "tenant" ? "#fff" : "#0f172a"} />
          <Text style={[styles.modeText, mode === "tenant" && styles.modeTextActive]}>Tenant</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setMode("meter")}
          style={[styles.modeBtn, mode === "meter" && styles.modeBtnActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === "meter" }}
        >
          <Ionicons name="speedometer-outline" size={16} color={mode === "meter" ? "#fff" : "#0f172a"} />
          <Text style={[styles.modeText, mode === "meter" && styles.modeTextActive]}>Meter</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputRow}>
        <View style={[styles.inputWrap, { flex: 1 }]}>
          <Ionicons name="calendar-outline" size={16} color="#64748b" style={{ marginRight: 6 }} />
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD (period end)"
            keyboardType="numbers-and-punctuation"
            style={styles.input}
          />
        </View>

        {mode === "tenant" ? (
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Ionicons name="person-outline" size={16} color="#64748b" style={{ marginRight: 6 }} />
            <TextInput
              value={tenantId}
              onChangeText={setTenantId}
              placeholder="Tenant ID (e.g. TNT-1)"
              autoCapitalize="characters"
              style={styles.input}
            />
          </View>
        ) : (
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Ionicons name="barcode-outline" size={16} color="#64748b" style={{ marginRight: 6 }} />
            <TextInput
              value={meterId}
              onChangeText={setMeterId}
              placeholder="Meter ID (e.g. MTR-1)"
              autoCapitalize="characters"
              style={styles.input}
            />
          </View>
        )}

        <TouchableOpacity onPress={onRun} style={styles.runBtn}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.runText}>Run</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  const Row = ({ item }: { item: RocMeter }) => {
    const roc = item.rate_of_change;
    const rocColor = roc == null ? "#334155" : roc > 0 ? "#16a34a" : roc < 0 ? "#dc2626" : "#334155";
    return (
      <View style={styles.row}>
        <View style={styles.cellWide}>
          <Text style={styles.mono}>{item.meter_id}</Text>
          <Text style={styles.caption}>{item.meter_type.toUpperCase()} • {item.building_id}</Text>
        </View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.indices.prev_index)}</Text><Text style={styles.caption}>Prev idx</Text></View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.indices.curr_index)}</Text><Text style={styles.caption}>Curr idx</Text></View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.previous_consumption)}</Text><Text style={styles.caption}>Prev cons</Text></View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.current_consumption)}</Text><Text style={styles.caption}>Curr cons</Text></View>
        <View style={styles.cell}>
          <Text style={[styles.num, { color: rocColor }]}>{roc == null ? "—" : `${fmt(roc, 2)} %`}</Text>
          <Text style={styles.caption}>ROC</Text>
        </View>
      </View>
    );
  };

  const List = () => {
    if (busy) return <ActivityIndicator style={{ marginTop: 16 }} />;
    if (!meterRows) return null;
    if (meterRows.length === 0) return <Text style={styles.empty}>No data for selected period.</Text>;

    return (
      <>
        {tenantTotals && (
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Tenant total</Text>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryKey}>Previous</Text><Text style={styles.summaryVal}>{fmt(tenantTotals.previous_consumption)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryKey}>Current</Text><Text style={styles.summaryVal}>{fmt(tenantTotals.current_consumption)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryKey}>Rate of Change</Text>
              <Text style={[styles.summaryVal, { color: (tenantTotals.rate_of_change ?? 0) > 0 ? "#16a34a" : (tenantTotals.rate_of_change ?? 0) < 0 ? "#dc2626" : "#334155" }]}>
                {tenantTotals.rate_of_change == null ? "—" : `${fmt(tenantTotals.rate_of_change)} %`}
              </Text>
            </View>
          </View>
        )}

        <FlatList
          data={meterRows}
          keyExtractor={(m) => m.meter_id}
          renderItem={Row}
          contentContainerStyle={{ paddingVertical: 6 }}
        />
      </>
    );
  };

  return (
    <View style={styles.card}>
      <Header />
      <Toolbar />
      <List />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 },
  headerRow: { marginBottom: 10 },
  title: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 12, color: "#475569", marginTop: 2 },
  toolbar: { marginTop: 6, marginBottom: 12 },
  modeSwitch: { flexDirection: "row", gap: 8, marginBottom: 8 },
  modeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#e2e8f0" },
  modeBtnActive: { backgroundColor: "#1f2a59" },
  modeText: { color: "#0f172a", fontWeight: "600" },
  modeTextActive: { color: "#fff" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10 },
  input: { flex: 1, color: "#0f172a" },
  runBtn: { backgroundColor: "#1f2a59", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  runText: { color: "#fff", fontWeight: "700" },
  empty: { color: "#475569", padding: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" },
  cellWide: { flex: 1.2 },
  cell: { width: 90, alignItems: "flex-end" },
  num: { fontVariant: ["tabular-nums"], fontSize: 14, color: "#0f172a", fontWeight: "600" },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), color: "#0f172a" },
  caption: { fontSize: 11, color: "#64748b" },
  summary: { marginTop: 6, marginBottom: 6, backgroundColor: "#f8fafc", borderRadius: 8, padding: 10 },
  summaryTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a", marginBottom: 6 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  summaryKey: { color: "#334155" },
  summaryVal: { color: "#0f172a", fontWeight: "700" },
});