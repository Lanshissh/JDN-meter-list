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
import RateOfChangePanel from "../../components/billing/RateOfChangePanel";
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
  prev_consumed_kwh: number | null;
  rate_of_change_pct: number | null;
  utility_rate: number;
  markup_rate: number;
  system_rate: number;
  vat_rate: number;
  vat_amount: number;
  whtax_code: string | null;
  whtax_rate: number | null;
  whtax_amount: number | null;
  tax_code: string | null;
  for_penalty: boolean;
  total_amount: number;
  meter_type: string;
};
type BillingTenant = {
  tenant_id: string | null;
  rows: BillingRow[];
};
type BillingTotals = {
  total_consumed_kwh: number;
  total_amount: number;
};
type BuildingBillingResponse = {
  building_id: string;
  building_name: string | null;
  period: { start: string; end: string };
  tenants: BillingTenant[];
  totals: BillingTotals;
  generated_at: string;
};
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
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount);
};
const downloadCsv = (filename: string, content: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const blob = new Blob([content], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } else {
    notify("CSV generated", "Download is only available on web.");
  }
};
const buildCsvFromPayload = (payload: BuildingBillingResponse | null) => {
  if (!payload) return "";
  const header = [
    "Building ID",
    "Building Name",
    "Period Start",
    "Period End",
    "Stall",
    "Tenant SN",
    "Tenant Name",
    "Meter No",
    "Meter Type",
    "Mult",
    "Prev Index",
    "Curr Index",
    "Prev Consumed kWh",
    "Consumed kWh",
    "Rate of Change %",
    "System Rate",
    "VAT Rate %",
    "VAT Amount",
    "WHTax Code",
    "WHTax Rate %",
    "WHTax Amount",
    "Tax Code",
    "For Penalty",
    "Total Amount",
  ];
  const lines: string[] = [];
  lines.push(header.map((h) => `"${h.replace(/"/g, '""')}"`).join(","));
  payload.tenants.forEach((t) => {
    t.rows.forEach((r) => {
      const row = [
        payload.building_id,
        payload.building_name ?? "",
        payload.period.start,
        payload.period.end,
        r.stall_sn || r.stall_no || "",
        r.tenant_sn || "",
        r.tenant_name || "",
        r.meter_no || r.meter_id,
        (r.meter_type || "").toUpperCase(),
        r.mult,
        r.reading_previous,
        r.reading_present,
        r.prev_consumed_kwh ?? "",
        r.consumed_kwh,
        r.rate_of_change_pct ?? "",
        r.system_rate,
        r.vat_rate * 100,
        r.vat_amount,
        r.whtax_code ?? "",
        r.whtax_rate != null ? r.whtax_rate * 100 : "",
        r.whtax_amount ?? "",
        r.tax_code ?? "",
        r.for_penalty ? "YES" : "NO",
        r.total_amount,
      ];
      lines.push(
        row
          .map((v) =>
            v == null
              ? '""'
              : `"${String(v)
                  .replace(/"/g, '""')
                  .replace(/\r?\n/g, " ")
                  .trim()}"`
          )
          .join(",")
      );
    });
  });
  return lines.join("\n");
};
export default function BillingScreen() {
  const { token } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
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
  const [buildingId, setBuildingId] = useState("");
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    return `${y}-${String(m + 1).padStart(2, "0")}-21`;
  });
  const [endDate, setEndDate] = useState<string>(() => today());
  const [penaltyRate, setPenaltyRate] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [payload, setPayload] = useState<BuildingBillingResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [viewMode, setViewMode] = useState<"billing" | "roc">("billing");
  const canRun =
    !!buildingId && isYMD(startDate) && isYMD(endDate) && !!token && !busy;
  const onGenerate = async () => {
    if (!token) return notify("Not logged in", "Please sign in first.");
    if (!buildingId.trim())
      return notify("Missing building", "Enter building ID.");
    if (!isYMD(startDate) || !isYMD(endDate))
      return notify("Invalid dates", "Use YYYY-MM-DD.");
    const penaltyNum = num(penaltyRate);
    if (penaltyNum == null || penaltyNum < 0)
      return notify("Invalid penalty", "Enter a valid percentage.");
    setBusy(true);
    setError("");
    try {
      const res = await api.get<BuildingBillingResponse>(
        `/billings/buildings/${encodeURIComponent(
          buildingId.trim()
        )}/period-start/${encodeURIComponent(
          startDate
        )}/period-end/${encodeURIComponent(endDate)}`,
        {
          params: { penalty_rate_pct: penaltyNum },
        }
      );
      setPayload(res.data);
    } catch (e: any) {
      console.error(e);
      const msg =
        e?.response?.data?.message ??
        e?.response?.data?.error ??
        e?.message ??
        "Unable to generate billing.";
      setError(msg);
      notify("Billing failed", msg);
    } finally {
      setBusy(false);
    }
  };
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
      if (Platform.OS === "android") {
        Alert.alert("CSV Created", "File saved. Check your Downloads folder.");
      } else {
        Alert.alert("CSV Created", "Use Share/Save dialog on your device.");
      }
    }
  }
  const onExportCsv = () => {
    if (!payload) {
      return notify("Nothing to export", "Generate a report first.");
    }
    const rateFor = (r: BillingRow) =>
      (r.system_rate != null ? r.system_rate : (r.utility_rate != null ? r.utility_rate : 0));
    const php10For = (r: BillingRow) => (Number(r.consumed_kwh || 0) * Number(rateFor(r) || 0));
    const vatFor   = (r: BillingRow) => (php10For(r) * Number(r.vat_rate || 0));
    const pctFmt = (v: number | null | undefined) => {
      if (v == null || !isFinite(Number(v))) return "";
      const n = Number(v);
      const pct = Math.abs(n) <= 1 ? (n * 100) : n;
      const sign = pct < 0 ? "-" : (pct > 0 ? "" : "");
      return `${sign}${Math.abs(pct).toFixed(0)}%`;
    };
    const headers = [
      "STALL NO.",
      "TENANTS / VENDORS",
      "METER NO.",
      "MULT",
      "READING PREVIOUS",
      "READING PRESENT",
      "CONSUMED KwHr",
      "VAT (0.12)",
      "Php 10/kwh",
      "TOTAL",
      "CONSUMED KwHr (Last Month)",
      "Rate of change",
      "TAX CODE",
      "WHTAX CODE",
      "MEMO",
      "FOR PENALTY",
    ];
    const allRows: BillingRow[] = (payload.tenants || []).flatMap(t => t.rows || []);
    const lines: string[] = [];
    lines.push(headers.join(",")); 
    for (const r of allRows) {
      const tenantLabel = [r.tenant_sn, r.tenant_name].filter(Boolean).join(" ").trim();
      const php10 = php10For(r);
      const vat   = vatFor(r);
      const row = [
        r.stall_sn ?? r.stall_no ?? "",                   
        tenantLabel,                                       
        r.meter_no ?? "",                                  
        r.mult ?? "",                                      
        r.reading_previous ?? "",                          
        r.reading_present ?? "",                           
        (r.consumed_kwh ?? ""),                            
        (vat ? vat.toFixed(2) : ""),                       
        (php10 ? php10.toFixed(2) : ""),                   
        (r.total_amount != null ? r.total_amount.toFixed(2) : ""), 
        (r.prev_consumed_kwh ?? ""),                       
        pctFmt(r.rate_of_change_pct),                      
        r.tax_code ?? "",                                   
        r.whtax_code ?? "",                                 
        "",                                                
        r.for_penalty ? "TRUE" : "FALSE",                  
      ];
      const esc = (v: any) => {
        const s = String(v);
        return (s.includes(",") || s.includes("\""))
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      lines.push(row.map(esc).join(","));
    }
    const csv = lines.join("\n");
    const fname = `BILLING_${payload.building_id}_${payload.period.start}_${payload.period.end}.csv`;
    saveCsv(fname, csv);
  };
  useEffect(() => {
    setError("");
  }, [buildingId, startDate, endDate]);
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>Billing & Analytics</Text>
          <Text style={styles.subtitle}>
            Generate comprehensive billing reports and analyze consumption trends
          </Text>
        </View>
      </View>
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, viewMode === "billing" && styles.tabActive]}
          onPress={() => setViewMode("billing")}
        >
          <Ionicons
            name="document-text"
            size={18}
            color={viewMode === "billing" ? "#2563EB" : "#64748B"}
          />
          <Text style={[styles.tabText, viewMode === "billing" && styles.tabTextActive]}>
            Billing
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, viewMode === "roc" && styles.tabActive]}
          onPress={() => setViewMode("roc")}
        >
          <Ionicons
            name="analytics"
            size={18}
            color={viewMode === "roc" ? "#2563EB" : "#64748B"}
          />
          <Text style={[styles.tabText, viewMode === "roc" && styles.tabTextActive]}>
            Rate of Change
          </Text>
        </TouchableOpacity>
      </View>
      {viewMode === "billing" ? (
        <View style={styles.content}>
          <View style={styles.inputCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="calculator" size={20} color="#2563EB" />
              <Text style={styles.cardTitle}>Billing Parameters</Text>
            </View>
            <View style={styles.inputGrid}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Building ID</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="business" size={16} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    value={buildingId}
                    onChangeText={setBuildingId}
                    placeholder="BLDG-001"
                    style={styles.textInput}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Start Date</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="calendar" size={16} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholder="YYYY-MM-DD"
                    style={styles.textInput}
                    keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>End Date</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="calendar" size={16} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholder="YYYY-MM-DD"
                    style={styles.textInput}
                    keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Penalty Rate (%)</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="alert-circle" size={16} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    value={penaltyRate}
                    onChangeText={setPenaltyRate}
                    placeholder="0"
                    style={styles.textInput}
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.primaryButton, !canRun && styles.buttonDisabled]}
                onPress={onGenerate}
                disabled={!canRun}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="flash" size={16} color="#FFFFFF" />
                )}
                <Text style={styles.primaryButtonText}>
                  {busy ? "Generating..." : "Generate Billing"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryButton, !payload && styles.buttonDisabled]}
                onPress={onExportCsv}
                disabled={!payload}
              >
                <Ionicons name="download" size={16} color="#2563EB" />
                <Text style={styles.secondaryButtonText}>Export CSV</Text>
              </TouchableOpacity>
            </View>
            {error ? (
              <View style={styles.errorCard}>
                <Ionicons name="warning" size={20} color="#DC2626" />
                <View style={styles.errorContent}>
                  <Text style={styles.errorTitle}>Request Failed</Text>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              </View>
            ) : null}
          </View>
          {payload ? (
            <View style={styles.resultsSection}>
              <View style={styles.summaryCard}>
                <View style={styles.cardHeader}>
                  <Ionicons name="business" size={20} color="#2563EB" />
                  <Text style={styles.cardTitle}>Billing Summary</Text>
                </View>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Building</Text>
                    <Text style={styles.summaryValue}>
                      {payload.building_id}
                      {payload.building_name ? ` • ${payload.building_name}` : ""}
                    </Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Billing Period</Text>
                    <Text style={styles.summaryValue}>
                      {payload.period.start} → {payload.period.end}
                    </Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Total Consumption</Text>
                    <Text style={styles.summaryValue}>
                      {fmt(payload.totals.total_consumed_kwh, 2)} kWh
                    </Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Total Amount</Text>
                    <Text style={[styles.summaryValue, styles.amountValue]}>
                      {formatCurrency(payload.totals.total_amount)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.generatedAt}>
                  Generated at {new Date(payload.generated_at).toLocaleString()}
                </Text>
              </View>
              {payload.tenants.map((tenant, tenantIndex) => (
                <View key={tenant.tenant_id || `tenant-${tenantIndex}`} style={styles.tenantCard}>
                  <View style={styles.tenantHeader}>
                    <Ionicons name="person" size={18} color="#374151" />
                    <View style={styles.tenantInfo}>
                      <Text style={styles.tenantName}>
                        {tenant.rows[0]?.tenant_name || tenant.tenant_id || "Unassigned Tenant"}
                      </Text>
                      {tenant.rows[0]?.tenant_sn && (
                        <Text style={styles.tenantId}>{tenant.rows[0].tenant_sn}</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.compactTable}>
                    <View style={styles.compactTableHeader}>
                      <View style={[styles.compactCell, styles.compactCellHeader, { flex: 2 }]}>
                        <Text style={styles.compactHeaderText}>Stall/Meter</Text>
                      </View>
                      <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1.5 }]}>
                        <Text style={styles.compactHeaderText}>Readings</Text>
                      </View>
                      <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1 }]}>
                        <Text style={styles.compactHeaderText}>Consumption</Text>
                      </View>
                      <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1 }]}>
                        <Text style={styles.compactHeaderText}>ROC</Text>
                      </View>
                      <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1.5 }]}>
                        <Text style={styles.compactHeaderText}>Rates & Taxes</Text>
                      </View>
                      <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1 }]}>
                        <Text style={styles.compactHeaderText}>Amount</Text>
                      </View>
                    </View>
                    {tenant.rows.map((row, rowIndex) => (
                      <View
                        key={`${row.meter_id}-${rowIndex}`}
                        style={[
                          styles.compactTableRow,
                          rowIndex % 2 === 0 && styles.compactTableRowEven,
                        ]}
                      >
                        <View style={[styles.compactCell, { flex: 2 }]}>
                          <Text style={styles.compactCellPrimary}>
                            {row.stall_sn || row.stall_no || "—"}
                          </Text>
                          <Text style={styles.compactCellSecondary}>
                            {row.meter_no || row.meter_id}
                          </Text>
                          <View style={styles.meterTypeBadge}>
                            <Text style={styles.meterTypeText}>
                              {(row.meter_type || "").toUpperCase()}
                            </Text>
                            <Text style={styles.multiplierText}>×{fmt(row.mult, 0)}</Text>
                          </View>
                        </View>
                        <View style={[styles.compactCell, { flex: 1.5 }]}>
                          <View style={styles.readingPair}>
                            <Text style={styles.readingLabel}>Prev:</Text>
                            <Text style={styles.readingValue}>{fmt(row.reading_previous, 0)}</Text>
                          </View>
                          <View style={styles.readingPair}>
                            <Text style={styles.readingLabel}>Curr:</Text>
                            <Text style={styles.readingValue}>{fmt(row.reading_present, 0)}</Text>
                          </View>
                        </View>
                        <View style={[styles.compactCell, { flex: 1 }]}>
                          <Text style={styles.consumptionValue}>
                            {fmt(row.consumed_kwh, 0)} kWh
                          </Text>
                          {row.prev_consumed_kwh && (
                            <Text style={styles.previousConsumption}>
                              Prev: {fmt(row.prev_consumed_kwh, 0)}
                            </Text>
                          )}
                        </View>
                        <View style={[styles.compactCell, { flex: 1 }]}>
                          <Text style={[
                            styles.rocValue,
                            row.rate_of_change_pct && row.rate_of_change_pct > 0 
                              ? styles.rocPositive 
                              : styles.rocNegative
                          ]}>
                            {row.rate_of_change_pct == null
                              ? "—"
                              : `${fmt(row.rate_of_change_pct, 0)}%`}
                          </Text>
                        </View>
                        <View style={[styles.compactCell, { flex: 1.5 }]}>
                          <View style={styles.ratesContainer}>
                            <Text style={styles.rateText}>
                              System: {row.system_rate == null ? "—" : fmt(row.system_rate, 4)}
                            </Text>
                            <Text style={styles.rateText}>
                              VAT: {row.vat_rate == null ? "—" : `${fmt((row.vat_rate as number) * 100, 1)}%`}
                            </Text>
                            {row.whtax_code && (
                              <Text style={styles.rateText}>
                                WHT: {row.whtax_code}
                              </Text>
                            )}
                            <Text style={[
                              styles.penaltyBadge,
                              row.for_penalty ? styles.penaltyYes : styles.penaltyNo
                            ]}>
                              {row.for_penalty ? "PENALTY" : "NO PENALTY"}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.compactCell, { flex: 1 }]}>
                          <Text style={styles.amountText}>
                            {formatCurrency(row.total_amount)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                  <View style={styles.tenantTotal}>
                    <Text style={styles.tenantTotalLabel}>Tenant Total:</Text>
                    <Text style={styles.tenantTotalAmount}>
                      {formatCurrency(tenant.rows.reduce((sum, row) => sum + row.total_amount, 0))}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.placeholderCard}>
              <Ionicons name="document-text" size={48} color="#CBD5E1" />
              <Text style={styles.placeholderTitle}>No Billing Data</Text>
              <Text style={styles.placeholderText}>
                Enter building details and generate billing to see results
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.rocSection}>
          <RateOfChangePanel />
        </View>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  headerContent: {
    maxWidth: 1200,
    width: "100%",
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#64748B",
    lineHeight: 24,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingHorizontal: 24,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    gap: 8,
  },
  tabActive: {
    borderBottomColor: "#2563EB",
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  tabTextActive: {
    color: "#2563EB",
  },
  content: {
    padding: 24,
    maxWidth: 1200,
    width: "100%",
    alignSelf: "center",
  },
  rocSection: {
    padding: 24,
  },
  inputCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    gap: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#0F172A",
  },
  inputGrid: {
    gap: 20,
    marginBottom: 24,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
  },
  inputIcon: {
    padding: 12,
  },
  textInput: {
    flex: 1,
    padding: 12,
    fontSize: 16,
    color: "#111827",
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2563EB",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#2563EB",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    gap: 8,
  },
  secondaryButtonText: {
    color: "#2563EB",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    gap: 12,
  },
  errorContent: {
    flex: 1,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#DC2626",
    marginBottom: 4,
  },
  errorText: {
    fontSize: 14,
    color: "#7F1D1D",
    lineHeight: 20,
  },
  resultsSection: {
    gap: 24,
  },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  summaryGrid: {
    gap: 16,
    marginBottom: 16,
  },
  summaryItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  summaryLabel: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 16,
    color: "#0F172A",
    fontWeight: "600",
  },
  amountValue: {
    color: "#059669",
  },
  generatedAt: {
    fontSize: 12,
    color: "#94A3B8",
    textAlign: "center",
  },
  tenantCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  tenantHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    gap: 12,
  },
  tenantInfo: {
    flex: 1,
  },
  tenantName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  tenantId: {
    fontSize: 14,
    color: "#64748B",
    marginTop: 2,
  },
  compactTable: {
    width: "100%",
  },
  compactTableHeader: {
    flexDirection: "row",
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  compactTableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingVertical: 12,
    minHeight: 80,
  },
  compactTableRowEven: {
    backgroundColor: "#F8FAFC",
  },
  compactCell: {
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  compactCellHeader: {
    paddingVertical: 12,
  },
  compactHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
  },
  compactCellPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 2,
  },
  compactCellSecondary: {
    fontSize: 12,
    color: "#64748B",
    marginBottom: 4,
  },
  meterTypeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  meterTypeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#FFFFFF",
    backgroundColor: "#2563EB",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  multiplierText: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "500",
  },
  readingPair: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  readingLabel: {
    fontSize: 11,
    color: "#64748B",
  },
  readingValue: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  consumptionValue: {
    fontSize: 12,
    fontWeight: "600",
    color: "#059669",
    marginBottom: 2,
  },
  previousConsumption: {
    fontSize: 10,
    color: "#64748B",
  },
  rocValue: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  rocPositive: {
    color: "#DC2626",
  },
  rocNegative: {
    color: "#059669",
  },
  ratesContainer: {
    gap: 2,
  },
  rateText: {
    fontSize: 10,
    color: "#374151",
    lineHeight: 14,
  },
  penaltyBadge: {
    fontSize: 9,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 2,
    textAlign: "center",
  },
  penaltyYes: {
    backgroundColor: "#FEF2F2",
    color: "#DC2626",
  },
  penaltyNo: {
    backgroundColor: "#F0FDF4",
    color: "#059669",
  },
  amountText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#059669",
    textAlign: "center",
  },
  tenantTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#F0FDF4",
    borderTopWidth: 1,
    borderTopColor: "#D1FAE5",
  },
  tenantTotalLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#065F46",
  },
  tenantTotalAmount: {
    fontSize: 16,
    fontWeight: "700",
    color: "#065F46",
  },
  placeholderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 16,
    marginBottom: 8,
  },
  placeholderText: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 20,
  },
});