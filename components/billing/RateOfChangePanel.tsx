import React, { useMemo, useState, memo } from "react";
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
} from "react-native";
import axios from "axios";
// If you don't use Expo icons, remove this import safely.
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
// If you don’t have a constants file, just set: const BASE_API = process.env.EXPO_PUBLIC_API ?? "";
import { BASE_API } from "../../constants/api";

/** ======================= Types (loose to match backend variations) ======================= */
type RocMeter = {
  meter_id: string;
  current_consumption?: number | null;
  previous_consumption?: number | null;
  rate_of_change?: number | null;
  error?: string;
  [k: string]: any;
};

type RocTenant = {
  tenant_id?: string | null;
  period?: {
    current?: { start?: string; end?: string };
    previous?: { start?: string; end?: string; month?: string };
    anchor?: { start?: string; end?: string; month?: string };
  };
  groups?: Record<
    string,
    {
      meters?: RocMeter[];
      totals?: {
        current_consumption?: number | null;
        previous_consumption?: number | null;
        rate_of_change?: number | null;
      };
    }
  >;
};

type RocBuilding = {
  building_id?: string;
  building_name?: string | null;
  period?: {
    current?: { start?: string; end?: string };
    previous?: { start?: string; end?: string };
  };
  tenants?: Array<{
    tenant_id?: string | null;
    meters?: RocMeter[];
    totals?: {
      current_consumption?: number | null;
      previous_consumption?: number | null;
      rate_of_change?: number | null;
    };
  }>;
};

type MonthlyComparison = {
  building_id?: string;
  building_name?: string | null;
  period?: { start?: string; end?: string };
  totals?: { electric?: number; water?: number; lpg?: number };
};

type QuarterlyComparison = {
  building_id?: string;
  building_name?: string | null;
  window?: { start?: string; end?: string };
  months?: Array<{
    label?: string; // YYYY-MM
    start?: string;
    end?: string;
    previous?: { month?: string; start?: string; end?: string };
    totals?: { electric?: number; water?: number; lpg?: number };
  }>;
  totals_all?: { electric?: number; water?: number; lpg?: number; all_utilities?: number };
};

type YearlyComparison = {
  building_id?: string;
  building_name?: string | null;
  year?: number;
  months?: Array<{
    label?: string; // YYYY-MM
    start?: string;
    end?: string;
    previous?: { month?: string; start?: string; end?: string };
    totals?: { electric?: number; water?: number; lpg?: number };
  }>;
  totals_all?: { electric?: number; water?: number; lpg?: number; all_utilities?: number };
};

/** ======================= Utils ======================= */
const isWeb = Platform.OS === "web";

const notify = (title: string, message?: string) => {
  // Avoid calling window.alert in SSR or exotic runtimes
  if (isWeb && typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    try {
      Alert.alert(title, message);
    } catch {
      // last-resort fallback
      console.warn(`${title}${message ? `: ${message}` : ""}`);
    }
  }
};

const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

const fmt = (v: any, d = 2) => {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
};

function dl(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  if (!(isWeb && typeof window !== "undefined")) {
    notify("CSV created", "Use your device’s share or downloads feature.");
    return;
  }
  const blob = new Blob([content], { type: mime });
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
}

/** ======================= Component ======================= */
type Props = {
  /** Optional: sync from parent Billing form */
  initialBuildingId?: string;
  initialStart?: string;
  initialEnd?: string;
  initialYear?: string | number;
};

function RateOfChangePanelImpl({
  initialBuildingId = "",
  initialStart = "2025-01-21",
  initialEnd = "2025-02-20",
  initialYear,
}: Props) {
  const { token } = useAuth();

  const headerToken =
    token && /^Bearer\s/i.test(token.trim())
      ? token.trim()
      : token
      ? `Bearer ${token.trim()}`
      : "";

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API ?? "", // safe default
        timeout: 20000,
        headers: headerToken ? { Authorization: headerToken } : {},
      }),
    [headerToken]
  );

  // Inputs
  const [buildingId, setBuildingId] = useState(String(initialBuildingId || ""));
  const [tenantId, setTenantId] = useState("");
  const [meterId, setMeterId] = useState("");
  const [startDate, setStartDate] = useState(String(initialStart || "2025-01-21"));
  const [endDate, setEndDate] = useState(String(initialEnd || "2025-02-20"));
  const [year, setYear] = useState(
    String(
      initialYear != null && String(initialYear).trim()
        ? initialYear
        : new Date().getFullYear()
    )
  );

  // Busy + error banner (render-safe)
  const [busy, setBusy] = useState<string | null>(null);
  const [errText, setErrText] = useState<string>("");

  // Results
  const [meterROC, setMeterROC] = useState<RocMeter | null>(null);
  const [tenantROC, setTenantROC] = useState<RocTenant | null>(null);
  const [buildingROC, setBuildingROC] = useState<RocBuilding | null>(null);
  const [monthlyCmp, setMonthlyCmp] = useState<MonthlyComparison | null>(null);
  const [quarterlyCmp, setQuarterlyCmp] = useState<QuarterlyComparison | null>(null);
  const [yearlyCmp, setYearlyCmp] = useState<YearlyComparison | null>(null);

  const guardDates = () => {
    if (!isYMD(startDate) || !isYMD(endDate)) {
      setErrText("Invalid dates. Use YYYY-MM-DD.");
      notify("Invalid dates", "Use YYYY-MM-DD.");
      return false;
    }
    return true;
  };

  const handleError = (fallbackMsg: string, e: any) => {
    const msg =
      e?.response?.data?.error ||
      e?.response?.data?.message ||
      e?.message ||
      fallbackMsg;
    setErrText(String(msg));
    // Avoid throwing inside render — show banner + toast
    notify("Request failed", String(msg));
  };

  /** ================= Calls (align to rateofchange.js) ================= */
  const runMeter = async () => {
    if (!meterId.trim()) return notify("Missing meter", "Enter a meter ID.");
    if (!guardDates()) return;
    setBusy("meter");
    setErrText("");
    setMeterROC(null);
    try {
      const url = `/rateofchange/meters/${encodeURIComponent(
        meterId.trim()
      )}/period-start/${startDate}/period-end/${endDate}`;
      const res = await api.get<RocMeter>(url);
      setMeterROC(res.data || null);
    } catch (e: any) {
      handleError("Meter ROC error", e);
    } finally {
      setBusy(null);
    }
  };

  const runTenant = async () => {
    if (!tenantId.trim()) return notify("Missing tenant", "Enter a tenant ID.");
    if (!guardDates()) return;
    setBusy("tenant");
    setErrText("");
    setTenantROC(null);
    try {
      const url = `/rateofchange/tenants/${encodeURIComponent(
        tenantId.trim()
      )}/period-start/${startDate}/period-end/${endDate}`;
      const res = await api.get<RocTenant>(url);
      setTenantROC(res.data || null);
    } catch (e: any) {
      handleError("Tenant ROC error", e);
    } finally {
      setBusy(null);
    }
  };

  const runBuilding = async () => {
    if (!buildingId.trim()) return notify("Missing building", "Enter a building ID.");
    if (!guardDates()) return;
    setBusy("building");
    setErrText("");
    setBuildingROC(null);
    try {
      const url = `/rateofchange/buildings/${encodeURIComponent(
        buildingId.trim()
      )}/period-start/${startDate}/period-end/${endDate}`;
      const res = await api.get<RocBuilding>(url);
      setBuildingROC(res.data || null);
    } catch (e: any) {
      handleError("Building ROC error", e);
    } finally {
      setBusy(null);
    }
  };

  const runMonthly = async () => {
    if (!buildingId.trim()) return notify("Missing building", "Enter a building ID.");
    if (!guardDates()) return;
    setBusy("monthly");
    setErrText("");
    setMonthlyCmp(null);
    try {
      const url = `/rateofchange/buildings/${encodeURIComponent(
        buildingId.trim()
      )}/period-start/${startDate}/period-end/${endDate}/monthly-comparison`;
      const res = await api.get<MonthlyComparison>(url);
      setMonthlyCmp(res.data || null);
    } catch (e: any) {
      handleError("Monthly comparison error", e);
    } finally {
      setBusy(null);
    }
  };

  const runQuarterly = async () => {
    if (!buildingId.trim()) return notify("Missing building", "Enter a building ID.");
    if (!guardDates()) return;
    setBusy("quarterly");
    setErrText("");
    setQuarterlyCmp(null);
    try {
      const url = `/rateofchange/buildings/${encodeURIComponent(
        buildingId.trim()
      )}/period-start/${startDate}/period-end/${endDate}/quarterly-comparison`;
      const res = await api.get<QuarterlyComparison>(url);
      setQuarterlyCmp(res.data || null);
    } catch (e: any) {
      handleError("Quarterly comparison error", e);
    } finally {
      setBusy(null);
    }
  };

  const runYearly = async () => {
    if (!buildingId.trim()) return notify("Missing building", "Enter a building ID.");
    if (!/^\d{4}$/.test(String(year))) return notify("Invalid year", "Use YYYY.");
    setBusy("yearly");
    setErrText("");
    setYearlyCmp(null);
    try {
      const url = `/rateofchange/buildings/${encodeURIComponent(
        buildingId.trim()
      )}/year/${encodeURIComponent(String(year))}/yearly-comparison`;
      const res = await api.get<YearlyComparison>(url);
      setYearlyCmp(res.data || null);
    } catch (e: any) {
      handleError("Yearly comparison error", e);
    } finally {
      setBusy(null);
    }
  };

  /** ======================= CSV exports ======================= */
  const exportMonthlyCsv = () => {
    if (!monthlyCmp) return notify("Nothing to export", "Run Monthly comparison first.");
    const bid = monthlyCmp.building_id ?? "";
    const ps = monthlyCmp.period?.start ?? "";
    const pe = monthlyCmp.period?.end ?? "";
    const t = monthlyCmp.totals ?? {};
    const header = ["Building ID", "Period Start", "Period End", "Electric", "Water", "LPG"];
    const row = [bid, ps, pe, t.electric ?? "", t.water ?? "", t.lpg ?? ""]
      .map((s) => `"${String(s ?? "").replace(/"/g, '""')}"`)
      .join(",");
    dl(`monthly_comparison_${bid}_${ps}_${pe}.csv`, `"${header.join('","')}"\n${row}\n`);
  };

  const exportQuarterlyCsv = () => {
    if (!quarterlyCmp) return notify("Nothing to export", "Run Quarterly comparison first.");
    const bid = quarterlyCmp.building_id ?? "";
    const w = quarterlyCmp.window ?? {};
    const header = [
      "Month",
      "Start",
      "End",
      "Prev Month",
      "Prev Start",
      "Prev End",
      "Electric",
      "Water",
      "LPG",
    ];
    const lines = [`"${header.join('","')}"`];
    (quarterlyCmp.months ?? []).forEach((m) => {
      const prev = m.previous ?? {};
      const tot = m.totals ?? {};
      lines.push(
        [
          m.label ?? "",
          m.start ?? "",
          m.end ?? "",
          prev.month ?? "",
          prev.start ?? "",
          prev.end ?? "",
          tot.electric ?? "",
          tot.water ?? "",
          tot.lpg ?? "",
        ]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(",")
      );
    });
    const all = quarterlyCmp.totals_all ?? {};
    lines.push(
      `"\u2211 Totals","","","","","",${all.electric ?? ""},${all.water ?? ""},${all.lpg ?? ""}`
    );
    lines.push(`"All Utilities","","","","","",${all.all_utilities ?? ""},,`);
    dl(
      `quarterly_comparison_${bid}_${w.start ?? ""}_${w.end ?? ""}.csv`,
      lines.join("\n") + "\n"
    );
  };

  const exportYearlyCsv = () => {
    if (!yearlyCmp) return notify("Nothing to export", "Run Yearly comparison first.");
    const bid = yearlyCmp.building_id ?? "";
    const header = ["Month", "Start", "End", "Prev Month", "Prev Start", "Prev End", "Electric", "Water", "LPG"];
    const lines = [`"${header.join('","')}"`];
    (yearlyCmp.months ?? []).forEach((m) => {
      const prev = m.previous ?? {};
      const tot = m.totals ?? {};
      lines.push(
        [
          m.label ?? "",
          m.start ?? "",
          m.end ?? "",
          prev.month ?? "",
          prev.start ?? "",
          prev.end ?? "",
          tot.electric ?? "",
          tot.water ?? "",
          tot.lpg ?? "",
        ]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(",")
      );
    });
    const all = yearlyCmp.totals_all ?? {};
    lines.push(
      `"\u2211 Annual Totals","","","","","",${all.electric ?? ""},${all.water ?? ""},${all.lpg ?? ""}`
    );
    lines.push(`"All Utilities","","","","","",${all.all_utilities ?? ""},,`);
    dl(`yearly_comparison_${bid}_${yearlyCmp.year ?? ""}.csv`, lines.join("\n") + "\n");
  };

  /** ======================= Render helpers ======================= */
  const Action = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={!!disabled} style={[styles.btn, disabled && styles.btnDisabled]}>
      <Ionicons name="flash" size={16} color="#fff" />
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );

  const ExportBtn = ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!!disabled}
      style={[styles.btnSecondary, disabled && styles.btnSecondaryDisabled]}
    >
      <Ionicons name="download" size={16} color="#0f172a" />
      <Text style={styles.btnSecondaryText}>{label}</Text>
    </TouchableOpacity>
  );

  /** ======================= Render ======================= */
  return (
    <View style={styles.wrap}>
      {/* Inputs */}
      <View style={styles.card}>
        <Text style={styles.h1}>Rate of Change & Comparison</Text>
        <Text style={styles.hint}>
          Connects to your <Text style={styles.bold}>rateofchange.js</Text> API (meter, tenant, building; monthly /
          quarterly / yearly).
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Building ID</Text>
          <TextInput
            value={buildingId}
            onChangeText={setBuildingId}
            placeholder="e.g. BLDG-1"
            autoCapitalize={Platform.OS === "web" ? "none" : "characters"}
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Tenant ID</Text>
          <TextInput
            value={tenantId}
            onChangeText={setTenantId}
            placeholder="e.g. TNT-1"
            autoCapitalize="characters"
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Meter ID</Text>
          <TextInput
            value={meterId}
            onChangeText={setMeterId}
            placeholder="e.g. MTR-1"
            autoCapitalize="characters"
            style={styles.input}
          />
        </View>

        <View style={styles.row2}>
          <View style={styles.col}>
            <Text style={styles.label}>Start (YYYY-MM-DD)</Text>
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>End (YYYY-MM-DD)</Text>
            <TextInput
              value={endDate}
              onChangeText={setEndDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Year (YYYY)</Text>
            <TextInput
              value={year}
              onChangeText={(v) => setYear(v.replace(/[^\d]/g, "").slice(0, 4))}
              placeholder="2025"
              keyboardType="numeric"
              style={styles.input}
            />
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={styles.actions}>
            <Action label="Meter ROC" onPress={runMeter} disabled={busy !== null} />
            <Action label="Tenant ROC" onPress={runTenant} disabled={busy !== null} />
            <Action label="Building ROC" onPress={runBuilding} disabled={busy !== null} />
            <Action label="Monthly Comparison" onPress={runMonthly} disabled={busy !== null} />
            <Action label="Quarterly Comparison" onPress={runQuarterly} disabled={busy !== null} />
            <Action label="Yearly Comparison" onPress={runYearly} disabled={busy !== null} />
          </View>
        </ScrollView>

        {!!errText && (
          <View style={styles.errorBox}>
            <Text style={styles.errText}>{String(errText)}</Text>
          </View>
        )}
      </View>

      {busy ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading {busy}…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Meter ROC */}
          {meterROC && (
            <View style={styles.card}>
              <Text style={styles.h2}>Meter ROC</Text>
              {"error" in meterROC && meterROC.error ? (
                <Text style={styles.errText}>{String(meterROC.error)}</Text>
              ) : (
                <View style={styles.grid}>
                  <KV k="Meter ID" v={meterROC.meter_id ?? "—"} />
                  <KV k="Current Consumption" v={`${fmt(meterROC.current_consumption, 2)} kWh`} />
                  <KV k="Previous Consumption" v={`${fmt(meterROC.previous_consumption, 2)} kWh`} />
                  <KV
                    k="Rate of Change"
                    v={
                      meterROC.rate_of_change == null
                        ? "—"
                        : `${fmt(meterROC.rate_of_change, 0)}%`
                    }
                  />
                </View>
              )}
            </View>
          )}

          {/* Tenant ROC */}
          {tenantROC && (
            <View style={styles.card}>
              <Text style={styles.h2}>Tenant ROC</Text>
              <Text style={styles.subtle}>
                {(tenantROC.period?.current?.start ?? "—")} → {(tenantROC.period?.current?.end ?? "—")}{" "}
                {tenantROC.period?.previous?.month ? `(prev ${tenantROC.period?.previous?.month})` : ""}
              </Text>
              {Object.entries(tenantROC.groups ?? {}).map(([type, g]) => (
                <View key={type} style={styles.group}>
                  <Text style={styles.groupTitle}>{String(type || "").toUpperCase()}</Text>
                  {g?.totals && (
                    <View style={styles.grid}>
                      <KV k="Current kWh" v={fmt(g.totals.current_consumption, 2)} />
                      <KV k="Previous kWh" v={fmt(g.totals.previous_consumption, 2)} />
                      <KV
                        k="ROC %"
                        v={
                          g.totals.rate_of_change == null
                            ? "—"
                            : `${fmt(g.totals.rate_of_change, 0)}%`
                        }
                      />
                    </View>
                  )}
                  {(g?.meters ?? []).map((m, i) => (
                    <View key={`${type}-${i}`} style={styles.mRow}>
                      <Text style={styles.meterId}>{m.meter_id ?? "—"}</Text>
                      {"error" in m && m.error ? (
                        <Text style={styles.errTextSmall}>{String(m.error)}</Text>
                      ) : (
                        <Text style={styles.meterLine}>
                          Curr {fmt(m.current_consumption, 2)} • Prev {fmt(m.previous_consumption, 2)} • ROC{" "}
                          {m.rate_of_change == null ? "—" : `${fmt(m.rate_of_change, 0)}%`}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {/* Building ROC */}
          {buildingROC && (
            <View style={styles.card}>
              <Text style={styles.h2}>Building ROC</Text>
              <Text style={styles.subtle}>
                {(buildingROC.building_id ?? "—")}
                {buildingROC.building_name ? ` • ${buildingROC.building_name}` : ""}
              </Text>
              <Text style={styles.subtle}>
                {(buildingROC.period?.current?.start ?? "—")} → {(buildingROC.period?.current?.end ?? "—")}
              </Text>

              {(buildingROC.tenants ?? []).map((t, idx) => (
                <View key={`tenant-${idx}`} style={styles.group}>
                  <Text style={styles.groupTitle}>{t.tenant_id || "Unassigned Tenant"}</Text>
                  {t?.totals && (
                    <View style={styles.grid}>
                      <KV k="Current kWh" v={fmt(t.totals.current_consumption, 2)} />
                      <KV k="Previous kWh" v={fmt(t.totals.previous_consumption, 2)} />
                      <KV
                        k="ROC %"
                        v={t.totals.rate_of_change == null ? "—" : `${fmt(t.totals.rate_of_change, 0)}%`}
                      />
                    </View>
                  )}
                  {(t?.meters ?? []).map((m, i) => (
                    <View key={`m-${idx}-${i}`} style={styles.mRow}>
                      <Text style={styles.meterId}>{m.meter_id ?? "—"}</Text>
                      {"error" in m && m.error ? (
                        <Text style={styles.errTextSmall}>{String(m.error)}</Text>
                      ) : (
                        <Text style={styles.meterLine}>
                          Curr {fmt(m.current_consumption, 2)} • Prev {fmt(m.previous_consumption, 2)} • ROC{" "}
                          {m.rate_of_change == null ? "—" : `${fmt(m.rate_of_change, 0)}%`}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}

          {/* Monthly comparison */}
          {monthlyCmp && (
            <View style={styles.card}>
              <Text style={styles.h2}>Monthly Comparison</Text>
              <Text style={styles.subtle}>
                {(monthlyCmp.building_id ?? "—")}
                {monthlyCmp.building_name ? ` • ${monthlyCmp.building_name}` : ""} |{" "}
                {(monthlyCmp.period?.start ?? "—")} → {(monthlyCmp.period?.end ?? "—")}
              </Text>
              <View style={styles.grid}>
                <KV k="Electric" v={`${fmt(monthlyCmp.totals?.electric, 2)} units`} />
                <KV k="Water" v={`${fmt(monthlyCmp.totals?.water, 2)} units`} />
                <KV k="LPG" v={`${fmt(monthlyCmp.totals?.lpg, 2)} units`} />
              </View>
              <View style={styles.actionsLine}>
                <ExportBtn label="Export CSV" onPress={exportMonthlyCsv} />
              </View>
            </View>
          )}

          {/* Quarterly comparison */}
          {quarterlyCmp && (
            <View style={styles.card}>
              <Text style={styles.h2}>Quarterly Comparison (4 months)</Text>
              <Text style={styles.subtle}>
                {(quarterlyCmp.building_id ?? "—")}
                {quarterlyCmp.building_name ? ` • ${quarterlyCmp.building_name}` : ""} |{" "}
                {(quarterlyCmp.window?.start ?? "—")} → {(quarterlyCmp.window?.end ?? "—")}
              </Text>
              <View style={styles.tableHead}>
                <Text style={[styles.th, { flex: 1.2 }]}>Month</Text>
                <Text style={[styles.th, { flex: 0.9 }]}>Electric</Text>
                <Text style={[styles.th, { flex: 0.9 }]}>Water</Text>
                <Text style={[styles.th, { flex: 0.9 }]}>LPG</Text>
              </View>
              {(quarterlyCmp.months ?? []).map((m, i) => (
                <View key={`q-${i}`} style={styles.tableRow}>
                  <Text style={[styles.td, { flex: 1.2 }]}>{m.label ?? "—"}</Text>
                  <Text style={[styles.td, { flex: 0.9, textAlign: "right" }]}>{fmt(m.totals?.electric, 2)}</Text>
                  <Text style={[styles.td, { flex: 0.9, textAlign: "right" }]}>{fmt(m.totals?.water, 2)}</Text>
                  <Text style={[styles.td, { flex: 0.9, textAlign: "right" }]}>{fmt(m.totals?.lpg, 2)}</Text>
                </View>
              ))}
              <View style={styles.totalLine}>
                <Text style={[styles.totalK, { flex: 1.2 }]}>Σ Totals</Text>
                <Text style={[styles.totalV, { flex: 0.9 }]}>{fmt(quarterlyCmp.totals_all?.electric, 2)}</Text>
                <Text style={[styles.totalV, { flex: 0.9 }]}>{fmt(quarterlyCmp.totals_all?.water, 2)}</Text>
                <Text style={[styles.totalV, { flex: 0.9 }]}>{fmt(quarterlyCmp.totals_all?.lpg, 2)}</Text>
              </View>
              <Text style={styles.allUtil}>All Utilities: {fmt(quarterlyCmp.totals_all?.all_utilities, 2)}</Text>
              <View style={styles.actionsLine}>
                <ExportBtn label="Export CSV" onPress={exportQuarterlyCsv} />
              </View>
            </View>
          )}

          {/* Yearly comparison */}
          {yearlyCmp && (
            <View style={styles.card}>
              <Text style={styles.h2}>Yearly Comparison ({yearlyCmp.year ?? "—"})</Text>
              <Text style={styles.subtle}>
                {(yearlyCmp.building_id ?? "—")}
                {yearlyCmp.building_name ? ` • ${yearlyCmp.building_name}` : ""}
              </Text>
              <View style={styles.tableHead}>
                <Text style={[styles.th, { flex: 1.2 }]}>Month</Text>
                <Text style={[styles.th, { flex: 0.9 }]}>Electric</Text>
                <Text style={[styles.th, { flex: 0.9 }]}>Water</Text>
                <Text style={[styles.th, { flex: 0.9 }]}>LPG</Text>
              </View>
              {(yearlyCmp.months ?? []).map((m, i) => (
                <View key={`y-${i}`} style={styles.tableRow}>
                  <Text style={[styles.td, { flex: 1.2 }]}>{m.label ?? "—"}</Text>
                  <Text style={[styles.td, { flex: 0.9, textAlign: "right" }]}>{fmt(m.totals?.electric, 2)}</Text>
                  <Text style={[styles.td, { flex: 0.9, textAlign: "right" }]}>{fmt(m.totals?.water, 2)}</Text>
                  <Text style={[styles.td, { flex: 0.9, textAlign: "right" }]}>{fmt(m.totals?.lpg, 2)}</Text>
                </View>
              ))}
              <View style={styles.totalLine}>
                <Text style={[styles.totalK, { flex: 1.2 }]}>Σ Totals</Text>
                <Text style={[styles.totalV, { flex: 0.9 }]}>{fmt(yearlyCmp.totals_all?.electric, 2)}</Text>
                <Text style={[styles.totalV, { flex: 0.9 }]}>{fmt(yearlyCmp.totals_all?.water, 2)}</Text>
                <Text style={[styles.totalV, { flex: 0.9 }]}>{fmt(yearlyCmp.totals_all?.lpg, 2)}</Text>
              </View>
              <Text style={styles.allUtil}>All Utilities: {fmt(yearlyCmp.totals_all?.all_utilities, 2)}</Text>
              <View style={styles.actionsLine}>
                <ExportBtn label="Export CSV" onPress={exportYearlyCsv} />
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const KV = ({ k, v }: { k: string; v: string }) => (
  <View style={styles.kv}>
    <Text style={styles.kKey}>{k}</Text>
    <Text style={styles.kVal}>{v}</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: { backgroundColor: "#f8fafc", borderRadius: 12, padding: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderColor: "#e2e8f0",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  h1: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  h2: { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  bold: { fontWeight: "700" },
  hint: { color: "#475569" },

  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  row2: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },
  col: { flexGrow: 1, flexBasis: 180 },

  label: { color: "#334155", fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
  },

  actions: { flexDirection: "row", gap: 8, paddingVertical: 6, paddingRight: 6 },
  actionsLine: { flexDirection: "row", gap: 8, marginTop: 8 },

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

  errorBox: {
    backgroundColor: "#fee2e2",
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
  },
  errText: { color: "#991b1b" },
  errTextSmall: { color: "#b91c1c", fontSize: 12 },

  grid: { gap: 6, marginTop: 6 },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  kKey: { color: "#334155", fontWeight: "700" },
  kVal: { color: "#0f172a" },

  group: { marginTop: 8, paddingTop: 8, borderTopColor: "#e2e8f0", borderTopWidth: 1 },
  groupTitle: { fontWeight: "800", color: "#0f172a", marginBottom: 6 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    borderBottomColor: "#e2e8f0",
    borderBottomWidth: 1,
    marginTop: 8,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomColor: "#f1f5f9",
    borderBottomWidth: 1,
  },
  th: { fontWeight: "800", color: "#334155", paddingRight: 8 },
  td: { color: "#0f172a", paddingRight: 8 },
  totalLine: {
    flexDirection: "row",
    paddingVertical: 8,
    borderTopColor: "#e2e8f0",
    borderTopWidth: 1,
    marginTop: 6,
  },
  totalK: { fontWeight: "800", color: "#334155" },
  totalV: { textAlign: "right", color: "#0f172a", fontWeight: "700" },
  allUtil: { marginTop: 8, fontWeight: "800", color: "#0f172a" },

  meterId: { fontWeight: "700", color: "#0f172a" },
  meterLine: { color: "#0f172a" },
  mRow: { marginBottom: 6 },
});

export default memo(RateOfChangePanelImpl)