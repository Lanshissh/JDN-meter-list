// components/billing/RateOfChangePanel.tsx
import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, FlatList, Platform, ScrollView,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

/* ==================== Types (match backend) ==================== */
type RocPeriod = { start: string; end: string };
type RocMeter = {
  meter_id: string;
  meter_type: string;
  building_id?: string;
  period: { current: RocPeriod; previous: RocPeriod };
  indices: { prev_index: number; curr_index: number };
  current_consumption: number;
  previous_consumption: number | null;
  rate_of_change: number | null;
  error?: string;
};

type RocTenant = {
  tenant_id: string;
  period?: { current: RocPeriod; previous: RocPeriod };
  end_date?: string; // legacy shape
  meters: RocMeter[];
  totals?: { current_consumption: number; previous_consumption: number; rate_of_change: number | null };
};

type RocBuildingTenantGroup = {
  tenant_id: string | null;
  meters: RocMeter[];
  totals: {
    current_consumption: number;
    previous_consumption: number;
    rate_of_change: number | null;
  };
};

type RocBuildingGrouped = {
  building_id: string;
  building_name?: string | null;
  period: { current: RocPeriod; previous: RocPeriod };
  tenants: RocBuildingTenantGroup[];
};

type BuildingMonthlyTotals = {
  building_id: string;
  building_name?: string | null;
  period: { current: RocPeriod }; // backend returns display window for current
  totals: { electric: number; water: number; lpg: number };
};

type BuildingFourMonths = {
  building_id: string;
  building_name?: string | null;
  four_months: {
    periods: Array<{
      month: string; start: string; end: string;
      totals: { electric: number; water: number; lpg: number };
    }>;
  };
};

/* ==================== Utils ==================== */
function notify(title: string, msg?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
    window.alert(msg ? `${title}\n\n${msg}` : title);
  } else {
    Alert.alert(title, msg);
  }
}
const today = () => new Date().toISOString().slice(0, 10);
const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const fmt = (n: number | string | null | undefined, digits = 2): string => {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
};
const pctBadge = (p: number | null | undefined) => (p == null ? null : Math.round(Number(p)));

/* ==================== Component ==================== */
export default function RateOfChangePanel({ token }: { token: string | null }) {
  type Mode = "tenant" | "meter" | "building";
  const [mode, setMode] = useState<Mode>("tenant");
  const [endDate, setEndDate] = useState(today());
  const [tenantId, setTenantId] = useState("");
  const [meterId, setMeterId] = useState("");
  const [buildingId, setBuildingId] = useState("");

  const [busy, setBusy] = useState(false);

  // results
  const [meterRows, setMeterRows] = useState<RocMeter[] | null>(null);
  const [tenantTotals, setTenantTotals] = useState<RocTenant["totals"] | null>(null);

  // building extras
  const [buildingGrouped, setBuildingGrouped] = useState<RocBuildingGrouped | null>(null);
  const [buildingMonthly, setBuildingMonthly] = useState<BuildingMonthlyTotals | null>(null);
  const [buildingFour, setBuildingFour] = useState<BuildingFourMonths | null>(null);

  // axios
  const api = useMemo(
    () => axios.create({
      baseURL: BASE_API,
      timeout: 20000,
      headers: { Authorization: `Bearer ${token ?? ""}` },
    }),
    [token]
  );

  // Your server can mount at /rateofchange; some stacks also alias to /roc. Try both. :contentReference[oaicite:4]{index=4}
  const ROC_BASES = ["/rateofchange", "/roc"];

  /* ==================== API calls ==================== */
  async function getJSON<T>(paths: string[]): Promise<T | null> {
    for (const base of ROC_BASES) {
      for (const path of paths) {
        try {
          const { data } = await api.get<T>(`${base}${path}`);
          return data;
        } catch (e: any) {
          if ([401, 403].includes(e?.response?.status)) throw e; // auth/scope error — stop trying
          // otherwise, try next route/base
        }
      }
    }
    return null;
  }

  const fetchRocMeter = (id: string, date: string) =>
    getJSON<RocMeter>([`/meters/${encodeURIComponent(id)}/period-end/${date}`]); // per-meter

  const fetchRocTenant = (id: string, date: string) =>
    getJSON<RocTenant>([`/tenants/${encodeURIComponent(id)}/period-end/${date}`]); // per-tenant

  // Building (grouped by tenant) — compares current vs previous across tenants. :contentReference[oaicite:5]{index=5}
  const fetchRocBuildingGrouped = (id: string, date: string) =>
    getJSON<RocBuildingGrouped>([`/buildings/${encodeURIComponent(id)}/period-end/${date}`]);

  // Building monthly totals (current period only). Backend route: monthly-comparison. :contentReference[oaicite:6]{index=6}
  const fetchRocBuildingMonthly = (id: string, date: string) =>
    getJSON<BuildingMonthlyTotals>([`/buildings/${encodeURIComponent(id)}/period-end/${date}/monthly-comparison`]);

  // Building four-month comparison (four consecutive 21→20 windows). :contentReference[oaicite:7]{index=7}
  const fetchRocBuildingFour = (id: string, date: string) =>
    getJSON<BuildingFourMonths>([
      `/buildings/${encodeURIComponent(id)}/period-end/${date}/four-month-comparison`,
    ]);

  /* ==================== Run ==================== */
  const onRun = async () => {
    if (!token) { notify("Not logged in", "Please sign in first."); return; }
    if (!isYMD(endDate)) { notify("Invalid end date", "Use YYYY-MM-DD."); return; }

    try {
      setBusy(true);
      setMeterRows(null);
      setTenantTotals(null);
      setBuildingGrouped(null);
      setBuildingMonthly(null);
      setBuildingFour(null);

      if (mode === "tenant") {
        if (!tenantId.trim()) { notify("Missing tenant", "Enter a tenant id (e.g. TNT-1)."); return; }
        const res = await fetchRocTenant(tenantId.trim(), endDate);
        if (!res) { notify("Not found", "No data for the period."); return; }
        setMeterRows(res.meters || []);
        setTenantTotals(res.totals || null);
      } else if (mode === "meter") {
        if (!meterId.trim()) { notify("Missing meter", "Enter a meter id (e.g. MTR-1)."); return; }
        const row = await fetchRocMeter(meterId.trim(), endDate);
        if (!row) { notify("Not found", "Meter not found or no data for the period."); return; }
        setMeterRows([row]);
      } else {
        if (!buildingId.trim()) { notify("Missing building", "Enter a building id (e.g. BLDG-1)."); return; }
        const [grouped, monthly, four] = await Promise.all([
          fetchRocBuildingGrouped(buildingId.trim(), endDate),
          fetchRocBuildingMonthly(buildingId.trim(), endDate),
          fetchRocBuildingFour(buildingId.trim(), endDate),
        ]);
        if (!grouped) { notify("Not found", "Building not found or no data for the period."); return; }
        setBuildingGrouped(grouped);
        setBuildingMonthly(monthly || null);
        setBuildingFour(four || null);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || "Server error.";
      notify("Rate of Change failed", msg);
    } finally {
      setBusy(false);
    }
  };

  /* ==================== Render helpers ==================== */
  const ROCRow = ({ item }: { item: RocMeter }) => {
    const warn = (item.rate_of_change ?? 0) >= 20; // warning badge ≥20%
    const badge = pctBadge(item.rate_of_change);

    return (
      <View style={styles.row}>
        <View style={[styles.cellWide, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
          <Text style={styles.mono}>{item.meter_id}</Text>
          {!!badge && (
            <View style={[styles.badge, warn && styles.badgeWarn]}>
              {warn ? <Ionicons name="alert-circle" size={12} color="#fff" /> : null}
              <Text style={[styles.badgeText]}>{badge}%</Text>
            </View>
          )}
        </View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.indices.prev_index, 0)}</Text></View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.indices.curr_index, 0)}</Text></View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.previous_consumption)}</Text></View>
        <View style={styles.cell}><Text style={styles.num}>{fmt(item.current_consumption)}</Text></View>
      </View>
    );
  };

  /* ==================== UI ==================== */
  const Header = () => (
    <View style={styles.headerRow}>
      <Text style={styles.title}>Rate of Change</Text>
      <Text style={styles.subtitle}>
        Compare current vs previous (21→20) periods by tenant, meter, or building.
      </Text>
    </View>
  );

  const Toolbar = () => (
    <View style={styles.toolbar}>
      {/* Mode switch */}
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

        <TouchableOpacity
          onPress={() => setMode("building")}
          style={[styles.modeBtn, mode === "building" && styles.modeBtnActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === "building" }}
        >
          <Ionicons name="business-outline" size={16} color={mode === "building" ? "#fff" : "#0f172a"} />
          <Text style={[styles.modeText, mode === "building" && styles.modeTextActive]}>Building</Text>
        </TouchableOpacity>
      </View>

      {/* Inputs */}
      <View style={styles.inputRow}>
        <View style={styles.inputWrap}>
          <Ionicons name="calendar-outline" size={16} color="#0f172a" style={{ marginRight: 6 }} />
          <TextInput
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            style={styles.input}
            autoCapitalize="none"
          />
        </View>

        {mode === "tenant" && (
          <View style={styles.inputWrap}>
            <Ionicons name="person-circle-outline" size={16} color="#0f172a" style={{ marginRight: 6 }} />
            <TextInput
              value={tenantId}
              onChangeText={setTenantId}
              placeholder="TNT-1"
              style={styles.input}
              autoCapitalize="none"
            />
          </View>
        )}
        {mode === "meter" && (
          <View style={styles.inputWrap}>
            <Ionicons name="bonfire-outline" size={16} color="#0f172a" style={{ marginRight: 6 }} />
            <TextInput
              value={meterId}
              onChangeText={setMeterId}
              placeholder="MTR-1"
              style={styles.input}
              autoCapitalize="none"
            />
          </View>
        )}
        {mode === "building" && (
          <View style={styles.inputWrap}>
            <Ionicons name="home-outline" size={16} color="#0f172a" style={{ marginRight: 6 }} />
            <TextInput
              value={buildingId}
              onChangeText={setBuildingId}
              placeholder="BLDG-1"
              style={styles.input}
              autoCapitalize="none"
            />
          </View>
        )}

        <TouchableOpacity onPress={onRun} style={styles.runBtn}>
          <Text style={styles.runText}>Run</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <Header />
      <Toolbar />

      {busy ? (
        <ActivityIndicator size="small" color="#1f2a59" />
      ) : (
        <>
          {/* Tenant / Meter modes */}
          {mode !== "building" && (
            <>
              {!meterRows ? (
                <Text style={styles.empty}>Enter details and tap Run.</Text>
              ) : (
                <>
                  {/* Table header */}
                  <View style={[styles.row, { borderBottomColor: "transparent" }]}>
                    <View style={[styles.cellWide]}><Text style={styles.caption}>Meter</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>Prev Index</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>Present Index</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>Prev Cons.</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>Current Cons.</Text></View>
                  </View>

                  <FlatList
                    data={meterRows}
                    keyExtractor={(r) => r.meter_id}
                    renderItem={ROCRow}
                  />

                  {tenantTotals ? (
                    <View style={styles.summary}>
                      <Text style={styles.summaryTitle}>Tenant totals</Text>
                      <View style={styles.summaryRow}><Text style={styles.summaryKey}>Previous</Text><Text style={styles.summaryVal}>{fmt(tenantTotals.previous_consumption)}</Text></View>
                      <View style={styles.summaryRow}><Text style={styles.summaryKey}>Current</Text><Text style={styles.summaryVal}>{fmt(tenantTotals.current_consumption)}</Text></View>
                      <View style={styles.summaryRow}><Text style={styles.summaryKey}>Rate of change</Text><Text style={styles.summaryVal}>{tenantTotals.rate_of_change == null ? "—" : `${Math.round(tenantTotals.rate_of_change)}%`}</Text></View>
                    </View>
                  ) : null}
                </>
              )}
            </>
          )}

          {/* Building mode */}
          {mode === "building" && (
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              {/* Grouped by tenant (per-meters returned) */}
              {buildingGrouped ? (
                <>
                  <View style={styles.headerRow2}>
                    <Text style={styles.sectionTitle}>Building — grouped by tenant</Text>
                    <Text style={styles.caption}>
                      Current vs previous periods across all meters assigned to each tenant.
                    </Text>
                  </View>
                  {buildingGrouped.tenants.length === 0 ? (
                    <Text style={styles.empty}>No tenants found for this building.</Text>
                  ) : (
                    buildingGrouped.tenants.map((t, idx) => (
                      <View key={idx} style={[styles.summary, { marginBottom: 12 }]}>
                        <Text style={styles.summaryTitle}>
                          {t.tenant_id ?? "UNASSIGNED"}
                        </Text>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryKey}>Previous</Text>
                          <Text style={styles.summaryVal}>{fmt(t.totals.previous_consumption)}</Text>
                        </View>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryKey}>Current</Text>
                          <Text style={styles.summaryVal}>{fmt(t.totals.current_consumption)}</Text>
                        </View>
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryKey}>Rate of change</Text>
                          <Text style={styles.summaryVal}>
                            {t.totals.rate_of_change == null ? "—" : `${Math.round(Number(t.totals.rate_of_change))}%`}
                          </Text>
                        </View>

                        {/* Small per-meter list with warnings */}
                        {t.meters?.length ? (
                          <>
                            <View style={[styles.row, { marginTop: 8, borderBottomColor: "transparent" }]}>
                              <View style={[styles.cellWide]}><Text style={styles.caption}>Meter</Text></View>
                              <View style={styles.cell}><Text style={styles.caption}>Prev</Text></View>
                              <View style={styles.cell}><Text style={styles.caption}>Present</Text></View>
                              <View style={styles.cell}><Text style={styles.caption}>Prev Cons.</Text></View>
                              <View style={styles.cell}><Text style={styles.caption}>Curr Cons.</Text></View>
                            </View>
                            {t.meters.map((m) => <ROCRow key={m.meter_id} item={m} />)}
                          </>
                        ) : null}
                      </View>
                    ))
                  )}
                </>
              ) : null}

              {/* Monthly totals */}
              {buildingMonthly ? (
                <>
                  <View style={styles.headerRow2}>
                    <Text style={styles.sectionTitle}>Monthly totals (current window)</Text>
                    <Text style={styles.caption}>Electric / Water / LPG totals for current period.</Text>
                  </View>
                  <View style={styles.summary}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Electric</Text>
                      <Text style={styles.summaryVal}>{fmt(buildingMonthly.totals.electric)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Water</Text>
                      <Text style={styles.summaryVal}>{fmt(buildingMonthly.totals.water)}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>LPG</Text>
                      <Text style={styles.summaryVal}>{fmt(buildingMonthly.totals.lpg)}</Text>
                    </View>
                  </View>
                </>
              ) : null}

              {/* Four-month comparison */}
              {buildingFour ? (
                <>
                  <View style={styles.headerRow2}>
                    <Text style={styles.sectionTitle}>Four-month comparison</Text>
                    <Text style={styles.caption}>Rolling 21→20 windows (oldest → latest).</Text>
                  </View>
                  <View style={[styles.row, { borderBottomColor: "transparent" }]}>
                    <View style={[styles.cellWide]}><Text style={styles.caption}>Month</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>Electric</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>Water</Text></View>
                    <View style={styles.cell}><Text style={styles.caption}>LPG</Text></View>
                  </View>
                  {buildingFour.four_months.periods.map((p) => (
                    <View key={p.month} style={styles.row}>
                      <View style={styles.cellWide}><Text style={styles.mono}>{p.month}</Text></View>
                      <View style={styles.cell}><Text style={styles.num}>{fmt(p.totals.electric)}</Text></View>
                      <View style={styles.cell}><Text style={styles.num}>{fmt(p.totals.water)}</Text></View>
                      <View style={styles.cell}><Text style={styles.num}>{fmt(p.totals.lpg)}</Text></View>
                    </View>
                  ))}
                </>
              ) : null}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

/* ==================== Styles ==================== */
const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, backgroundColor: "#fff" },
  headerRow: { marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  subtitle: { color: "#475569", marginTop: 2 },

  toolbar: { gap: 10, marginBottom: 12 },
  modeSwitch: { flexDirection: "row", gap: 8 },
  modeBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#e2e8f0" },
  modeBtnActive: { backgroundColor: "#1f2a59" },
  modeText: { color: "#0f172a", fontWeight: "600" },
  modeTextActive: { color: "#fff" },

  inputRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  inputWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10 },
  input: { minWidth: 120, color: "#0f172a" },
  runBtn: { backgroundColor: "#1f2a59", paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  runText: { color: "#fff", fontWeight: "700" },

  headerRow2: { marginTop: 6, marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },

  empty: { color: "#475569", padding: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" },
  cellWide: { flex: 1.2 },
  cell: { width: 100, alignItems: "flex-end" },

  num: { fontVariant: ["tabular-nums"], fontSize: 14, color: "#0f172a", fontWeight: "600" },
  mono: { fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), color: "#0f172a" },
  caption: { fontSize: 11, color: "#64748b" },

  summary: { marginTop: 6, marginBottom: 6, backgroundColor: "#f8fafc", borderRadius: 8, padding: 10 },
  summaryTitle: { fontSize: 13, fontWeight: "700", color: "#0f172a", marginBottom: 6 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  summaryKey: { color: "#334155" },
  summaryVal: { color: "#0f172a", fontWeight: "700" },

  // % badge
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "#334155" },
  badgeWarn: { backgroundColor: "#dc2626" },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
});