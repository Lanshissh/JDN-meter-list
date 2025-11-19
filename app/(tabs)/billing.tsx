// app/(tabs)/billing.tsx
import React, { useEffect, useMemo, useState } from "react";
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
import { Picker } from "@react-native-picker/picker";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";
import RateOfChangePanel from "../../components/billing/RateOfChangePanel";

/* ========================= Types ========================= */

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
  utility_rate: number | null;
  markup_rate: number | null;
  system_rate: number | null;
  vat_rate: number | null;
  vat_amount?: number | null;
  whtax_code: string | null;
  whtax_rate?: number | null;
  whtax_amount?: number | null;
  tax_code: string | null;
  for_penalty: boolean;
  total_amount: number;
  meter_type: string | null;
  // Add these fields that might come from backend
  wt_rate?: number | null;
  wt?: number | null;
  // Add fields for nested data
  billing?: {
    wt?: number | null;
    vat?: number | null;
    base?: number | null;
  };
  totals?: {
    wt?: number | null;
  };
};

type BillingTenant = {
  tenant_id: string | null;
  tenant_sn: string | null;
  tenant_name: string | null;
  rows: BillingRow[];
};

type BillingTotals = {
  total_consumed_kwh: number;
  total_amount: number;
};

type BuildingBillingResponse = {
  building_billing_id?: string;
  building_id: string;
  building_name: string | null;
  period: { start: string; end: string };
  tenants: BillingTenant[];
  totals: BillingTotals;
  generated_at: string;
  penalty_rate_pct: number;
  saved_header?: any;
};

type StoredBilling = {
  building_billing_id: string;
  building_id: string;
  building_name: string | null;
  period: { start: string; end: string };
  totals: { total_consumed_kwh: number; total_amount: number };
  penalty_rate_pct: number;
  generated_at: string | null;
  payload?: any;
};

type BuildingOption = {
  building_id: string;
  building_name: string | null;
};

/* ========================= Helpers ========================= */

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

const formatCurrency = (v: number | null | undefined) => {
  if (v == null || isNaN(Number(v))) return "—";
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: "PHP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(v));
  } catch {
    return `₱${Number(v).toFixed(2)}`;
  }
};

// Temporary debug function
// Fixed debugPayloadStructure function
const debugPayloadStructure = (payload: BuildingBillingResponse) => {
  console.log("=== PAYLOAD STRUCTURE ANALYSIS ===");
  console.log("Payload keys:", Object.keys(payload));
  
  if (payload.tenants && payload.tenants.length > 0) {
    payload.tenants.forEach((tenant, tenantIndex) => {
      console.log(`Tenant ${tenantIndex}:`, Object.keys(tenant));
      
      if (tenant.rows && tenant.rows.length > 0) {
        const firstRow = tenant.rows[0];
        console.log("First row structure:", Object.keys(firstRow));
        console.log("First row full data:", JSON.stringify(firstRow, null, 2));
        
        // Check if there are any nested objects that might contain WTAX - FIXED VERSION
        const rowKeys = Object.keys(firstRow) as (keyof BillingRow)[];
        rowKeys.forEach(key => {
          const value = firstRow[key];
          if (typeof value === 'object' && value !== null) {
            console.log(`Nested object ${String(key)}:`, value);
          }
        });
      }
    });
  }
};

// Php10 and VAT helpers for CSV
const php10For = (r: BillingRow): number | null => {
  if (r.consumed_kwh == null || r.utility_rate == null) return null;
  const base = Number(r.consumed_kwh) * Number(r.utility_rate);
  return Number.isFinite(base) ? base : null;
};

const vatFor = (r: BillingRow): number | null => {
  if (r.vat_rate == null) return null;
  const base = php10For(r);
  if (base == null) return null;
  const v = base * Number(r.vat_rate);
  return Number.isFinite(v) ? v : null;
};

// ULTIMATE WTAX CALCULATION - WILL WORK WITH ANY STRUCTURE
const wtaxFor = (r: BillingRow): number => {
  console.log(`=== WTAX CALCULATION START for ${r.meter_id} ===`);
  
  // Method 1: Direct field access
  if (r.wt != null && !isNaN(Number(r.wt)) && Number(r.wt) > 0) {
    console.log(`✓ Using direct wt field: ${r.wt}`);
    return Number(r.wt);
  }

  // Method 2: Nested billing.wt
  if (r.billing?.wt != null && !isNaN(Number(r.billing.wt)) && Number(r.billing.wt) > 0) {
    console.log(`✓ Using nested billing.wt: ${r.billing.wt}`);
    return Number(r.billing.wt);
  }

  // Method 3: Nested totals.wt
  if (r.totals?.wt != null && !isNaN(Number(r.totals.wt)) && Number(r.totals.wt) > 0) {
    console.log(`✓ Using nested totals.wt: ${r.totals.wt}`);
    return Number(r.totals.wt);
  }

  // Method 4: Calculate from base formula: wt = vat * wt_rate
  const base = php10For(r);
  console.log(`Base amount: ${base}`);
  
  if (base != null) {
    const vatRate = r.vat_rate || 0;
    const vat = base * vatRate;
    console.log(`VAT amount: ${vat} (rate: ${vatRate})`);
    
    // Try different rate fields
    let wtRate = null;
    
    if (r.wt_rate != null && r.wt_rate > 0) {
      wtRate = r.wt_rate;
      console.log(`Using wt_rate: ${wtRate}`);
    } else if (r.whtax_rate != null && r.whtax_rate > 0) {
      wtRate = r.whtax_rate;
      console.log(`Using whtax_rate: ${wtRate}`);
    }
    
    if (wtRate != null && vat > 0) {
      const calculatedWt = vat * wtRate;
      console.log(`✓ Calculated WTAX: ${vat} * ${wtRate} = ${calculatedWt}`);
      return calculatedWt;
    }
  }

  // Method 5: If we have total_amount and can deduce WTAX
  if (r.total_amount != null && base != null) {
    const vatRate = r.vat_rate || 0;
    const vat = base * vatRate;
    const expectedTotalWithoutWt = base + vat;
    
    // If there's a difference, it might be WTAX
    if (r.total_amount < expectedTotalWithoutWt) {
      const deducedWt = expectedTotalWithoutWt - r.total_amount;
      console.log(`✓ Deduced WTAX from total difference: ${deducedWt}`);
      return Math.max(0, deducedWt);
    }
  }

  console.log(`✗ No WTAX data found, returning 0`);
  return 0;
};

// FORCE WTAX CALCULATION - Always returns a value
const forceWtaxCalculation = (r: BillingRow): number => {
  // Always calculate from base principles
  const base = Number(r.consumed_kwh || 0) * Number(r.utility_rate || 0);
  
  if (base > 0) {
    const vatRate = r.vat_rate || 0.12; // Default to 12% VAT if not provided
    const vat = base * vatRate;
    
    // Use a default WTAX rate of 2% if not provided
    const wtRate = r.wt_rate || r.whtax_rate || 0.02;
    const wtax = vat * wtRate;
    
    console.log(`Force calculated WTAX: ${base} * ${vatRate} = ${vat} * ${wtRate} = ${wtax}`);
    return wtax;
  }
  
  return 0;
};

const pctFmt = (v: number | null | undefined) =>
  v == null ? "" : `${v.toFixed(0)}%`;

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
    // React Native (mobile) – just show a message for now
    notify("CSV created", "Use Share/Downloads feature on your device.");
  }
}

/** Build CSV content from a building billing payload */
const makeBillingCsv = (payload: BuildingBillingResponse) => {
  const headers = [
    "STALL NO.",
    "TENANTS / VENDORS",
    "METER NO.",
    "MULT",
    "READING PREVIOUS",
    "READING PRESENT",
    "CONSUMED KwHr",
    "Php/kwh",
    "WTAX",
    "VAT",
    "TOTAL",
    "CONSUMED KwHr (Last Month)",
    "Rate of change",
    "TAX CODE",
    "WHTAX CODE",
    "MEMO",
    "FOR PENALTY",
  ];

  const allRows: BillingRow[] = (payload.tenants || []).flatMap(
    (t) => t.rows || []
  );
  const lines: string[] = [headers.join(",")];

  for (const r of allRows) {
    const tenantLabel = [r.tenant_sn, r.tenant_name]
      .filter(Boolean)
      .join(" ")
      .trim();

    const php10 = php10For(r);
    const vat = vatFor(r);
    
    // Try normal calculation first
    let wtax = wtaxFor(r);
    
    // If still 0, use force calculation
    if (wtax === 0) {
      console.log(`WTAX was 0 for ${r.meter_id}, using force calculation`);
      wtax = forceWtaxCalculation(r);
    }

    console.log(`FINAL VALUES - Meter ${r.meter_id}:`, {
      php10,
      vat,
      wtax,
      total: r.total_amount
    });

    const row = [
      r.stall_sn ?? r.stall_no ?? "",
      tenantLabel,
      r.meter_no ?? "",
      r.mult ?? "",
      r.reading_previous ?? "",
      r.reading_present ?? "",
      r.consumed_kwh ?? "",
      php10 != null ? php10.toFixed(2) : "",
      wtax.toFixed(2), // Always show WTAX, even if 0
      vat != null ? vat.toFixed(2) : "",
      r.total_amount ?? "",
      r.prev_consumed_kwh ?? "",
      pctFmt(r.rate_of_change_pct),
      r.tax_code ?? "",
      r.whtax_code ?? "",
      "",
      r.for_penalty ? "TRUE" : "FALSE",
    ];

    lines.push(
      row
        .map((v) => {
          const s = String(v ?? "");
          return `"${s.replace(/"/g, '""')}"`;
        })
        .join(",")
    );
  }

  const filename = `billing_${payload.building_id}_${payload.period.start}_${payload.period.end}.csv`;
  return { filename, csv: lines.join("\n") };
};

/* ========================= Component ========================= */

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
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);

  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
    const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
    return `${y}-${String(m + 1).padStart(2, "0")}-21`;
  });
  const [endDate, setEndDate] = useState<string>(() => today());
  const [penaltyRate, setPenaltyRate] = useState<string>("0");

  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payload, setPayload] = useState<BuildingBillingResponse | null>(null);
  const [storedBillings, setStoredBillings] = useState<Record<string, StoredBilling>>(
    {}
  );
  const [error, setError] = useState<string>("");

  // old viewMode/actionMode no longer used in UI but kept for compatibility
  const [viewMode, setViewMode] = useState<"billing" | "roc">("billing");
  const [actionMode, setActionMode] = useState<"generate" | "stored">("generate");

  const canRun =
    !!buildingId && isYMD(startDate) && isYMD(endDate) && !!token && !busy;

  /* ========== Load buildings for dropdown ========== */

  useEffect(() => {
    const loadBuildings = async () => {
      if (!token) return;
      try {
        const res = await api.get<BuildingOption[]>("/buildings");
        const list = Array.isArray(res.data) ? res.data : [];
        setBuildings(list);
      } catch (e) {
        console.error("Fetch buildings for billing failed:", e);
      }
    };
    loadBuildings();
  }, [api, token]);

  /* ========== API calls ========== */

  const fetchStoredBillings = async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      // assumes backend returns a record of stored headers keyed by building_billing_id
      const res = await api.get<Record<string, StoredBilling>>("/billings/buildings");
      setStoredBillings(res.data || {});
    } catch (e: any) {
      console.error("Fetch stored billings error:", e);
      const msg =
        e?.response?.data?.error ??
        e?.message ??
        "Unable to fetch stored billings.";
      setError(msg);
      notify("Fetch failed", msg);
    } finally {
      setBusy(false);
    }
  };

  const fetchStoredBilling = async (buildingBillingId: string) => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.get<BuildingBillingResponse>(
        `/billings/${buildingBillingId}`
      );
      setPayload(res.data);
      setActionMode("stored");
    } catch (e: any) {
      console.error("Fetch billing error:", e);
      const msg =
        e?.response?.data?.error ?? e?.message ?? "Unable to fetch billing.";
      setError(msg);
      notify("Fetch failed", msg);
    } finally {
      setBusy(false);
    }
  };

  const onCreateBilling = async () => {
    if (!token) return notify("Not logged in", "Please sign in first.");
    if (!buildingId.trim())
      return notify("Missing building", "Select a building.");
    if (!isYMD(startDate) || !isYMD(endDate))
      return notify("Invalid dates", "Use YYYY-MM-DD.");

    const penaltyNum = num(penaltyRate);
    if (penaltyNum == null || penaltyNum < 0)
      return notify("Invalid penalty", "Enter a valid percentage.");

    setCreating(true);
    setError("");
    try {
      const res = await api.post<BuildingBillingResponse>(
        `/billings/buildings/${encodeURIComponent(
          buildingId.trim()
        )}/period-start/${encodeURIComponent(
          startDate
        )}/period-end/${encodeURIComponent(endDate)}`,
        {},
        { params: { penalty_rate: penaltyNum } }
      );

      // Call the debug function
      debugPayloadStructure(res.data);

      setPayload(res.data);
      setActionMode("generate");
      fetchStoredBillings();
      notify("Success", "Billing created and saved successfully.");
    } catch (e: any) {
      console.error("Create billing error:", e);
      const msg =
        e?.response?.data?.error ??
        e?.message ??
        "Unable to create building billing.";
      setError(msg);
      notify("Request failed", msg);
    } finally {
      setCreating(false);
    }
  };

  const onExportCurrentCsv = () => {
    if (!payload) return;
    
    console.log("=== CSV EXPORT - FULL PAYLOAD ANALYSIS ===");
    console.log("Payload structure:", payload);
    
    if (payload.tenants && payload.tenants.length > 0) {
      payload.tenants.forEach((tenant, tenantIndex) => {
        console.log(`Tenant ${tenantIndex} (${tenant.tenant_name}):`, tenant);
        if (tenant.rows && tenant.rows.length > 0) {
          tenant.rows.forEach((row, rowIndex) => {
            console.log(`  Row ${rowIndex} - Meter ${row.meter_id}:`, {
              ...row,
              // Include nested objects
              billing: row.billing,
              totals: row.totals
            });
          });
        }
      });
    }
    
    const { filename, csv } = makeBillingCsv(payload);
    console.log("Final CSV:", csv);
    saveCsv(filename, csv);
  };

  const onDownloadStoredCsv = async (billing: StoredBilling) => {
    if (!token) return;
    if (!billing.payload) {
      // if payload not attached, fetch full billing then export
      await fetchStoredBilling(billing.building_billing_id);
      if (!payload) return;
      const { filename, csv } = makeBillingCsv(payload);
      saveCsv(filename, csv);
      return;
    }

    try {
      setBusy(true);
      const { filename, csv } = makeBillingCsv(billing.payload);
      saveCsv(filename, csv);
    } catch (e: any) {
      console.error("Download billing CSV failed:", e);
      const msg =
        e?.response?.data?.error ??
        e?.message ??
        "Unable to download billing report.";
      notify("Download failed", msg);
    } finally {
      setBusy(false);
    }
  };

  /* ========================= UI ========================= */

  const [viewTab, setViewTab] = useState<"billing" | "roc">("billing");
  const [modeTab, setModeTab] = useState<"generate" | "stored">("generate");

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>Billing & Statements</Text>
          <Text style={styles.subtitle}>
            Generate per-building billing, export CSV, and manage stored
            billings.
          </Text>
        </View>
      </View>

      {/* Top-level Tab: Billing vs ROC */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[
            styles.tab,
            viewTab === "billing" && styles.tabActive,
          ]}
          onPress={() => setViewTab("billing")}
        >
          <Ionicons
            name="document-text-outline"
            size={16}
            color={viewTab === "billing" ? "#2563EB" : "#64748B"}
          />
          <Text
            style={[
              styles.tabText,
              viewTab === "billing" && styles.tabTextActive,
            ]}
          >
            Billing
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, viewTab === "roc" && styles.tabActive]}
          onPress={() => setViewTab("roc")}
        >
          <Ionicons
            name="trending-up-outline"
            size={16}
            color={viewTab === "roc" ? "#2563EB" : "#64748B"}
          />
          <Text
            style={[
              styles.tabText,
              viewTab === "roc" && styles.tabTextActive,
            ]}
          >
            Rate of Change
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {viewTab === "billing" ? (
          <View>
            {/* Mode: Generate vs Stored */}
            <View style={styles.modeToggle}>
              <TouchableOpacity
                style={[
                  styles.modeTab,
                  modeTab === "generate" && styles.modeTabActive,
                ]}
                onPress={() => setModeTab("generate")}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    modeTab === "generate" && styles.modeTabTextActive,
                  ]}
                >
                  Generate Billing
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeTab,
                  modeTab === "stored" && styles.modeTabActive,
                ]}
                onPress={() => {
                  setModeTab("stored");
                  fetchStoredBillings();
                }}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    modeTab === "stored" && styles.modeTabTextActive,
                  ]}
                >
                  Stored Billings
                </Text>
              </TouchableOpacity>
            </View>

            {modeTab === "generate" ? (
              <>
                {/* Generate Billing Card */}
                <View style={styles.inputCard}>
                  <View className="flex-row items-center mb-4">
                    <View style={styles.cardHeader}>
                      <Ionicons name="calculator" size={20} color="#2563EB" />
                      <Text style={styles.cardTitle}>Billing Parameters</Text>
                    </View>
                  </View>

                  <View style={styles.inputGrid}>
                    {/* Building dropdown */}
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Building *</Text>
                      <View style={styles.inputWrapper}>
                        <Ionicons
                          name="business"
                          size={16}
                          color="#64748B"
                          style={styles.inputIcon}
                        />
                        {buildings.length > 0 ? (
                          <Picker
                            selectedValue={buildingId}
                            onValueChange={(value) =>
                              setBuildingId(String(value))
                            }
                            style={styles.picker}
                            mode={
                              Platform.OS === "android"
                                ? "dropdown"
                                : undefined
                            }
                          >
                            <Picker.Item
                              label="Select building…"
                              value=""
                            />
                            {buildings.map((b) => (
                              <Picker.Item
                                key={b.building_id}
                                label={
                                  b.building_name
                                    ? `${b.building_name} (${b.building_id})`
                                    : b.building_id
                                }
                                value={b.building_id}
                              />
                            ))}
                          </Picker>
                        ) : (
                          <TextInput
                            value={buildingId}
                            onChangeText={setBuildingId}
                            placeholder="BLDG-001"
                            style={styles.textInput}
                            autoCapitalize="characters"
                            autoCorrect={false}
                          />
                        )}
                      </View>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Start Date *</Text>
                      <View style={styles.inputWrapper}>
                        <Ionicons
                          name="calendar"
                          size={16}
                          color="#64748B"
                          style={styles.inputIcon}
                        />
                        <TextInput
                          value={startDate}
                          onChangeText={setStartDate}
                          placeholder="YYYY-MM-DD"
                          style={styles.textInput}
                          keyboardType={
                            Platform.OS === "ios"
                              ? "numbers-and-punctuation"
                              : "default"
                          }
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>End Date *</Text>
                      <View style={styles.inputWrapper}>
                        <Ionicons
                          name="calendar"
                          size={16}
                          color="#64748B"
                          style={styles.inputIcon}
                        />
                        <TextInput
                          value={endDate}
                          onChangeText={setEndDate}
                          placeholder="YYYY-MM-DD"
                          style={styles.textInput}
                          keyboardType={
                            Platform.OS === "ios"
                              ? "numbers-and-punctuation"
                              : "default"
                          }
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Penalty Rate (%) *</Text>
                      <View style={styles.inputWrapper}>
                        <Ionicons
                          name="alert-circle"
                          size={16}
                          color="#64748B"
                          style={styles.inputIcon}
                        />
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
                      style={[
                        styles.primaryButton,
                        !canRun && styles.buttonDisabled,
                      ]}
                      onPress={onCreateBilling}
                      disabled={!canRun || creating}
                    >
                      {creating ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons name="save" size={16} color="#FFFFFF" />
                      )}
                      <Text style={styles.primaryButtonText}>
                        {creating ? "Creating..." : "Create & Save Billing"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.secondaryButton,
                        !payload && styles.buttonDisabled,
                      ]}
                      onPress={onExportCurrentCsv}
                      disabled={!payload}
                    >
                      <Ionicons name="download" size={16} color="#2563EB" />
                      <Text style={styles.secondaryButtonText}>
                        Export CSV
                      </Text>
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

                {/* Billing output */}
                {payload ? (
                  <View style={styles.billingCard}>
                    <View style={styles.cardHeader}>
                      <Ionicons name="business" size={20} color="#2563EB" />
                      <Text style={styles.cardTitle}>Billing Summary</Text>
                      {payload.building_billing_id && (
                        <Text style={styles.billingId}>
                          ID: {payload.building_billing_id}
                        </Text>
                      )}
                    </View>
                    <View style={styles.summaryGrid}>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Building</Text>
                        <Text style={styles.summaryValue}>
                          {payload.building_id}
                          {payload.building_name
                            ? ` • ${payload.building_name}`
                            : ""}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Billing Period</Text>
                        <Text style={styles.summaryValue}>
                          {payload.period.start} → {payload.period.end}
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>
                          Total Consumption
                        </Text>
                        <Text style={styles.summaryValue}>
                          {fmt(payload.totals.total_consumed_kwh, 4)} kWh
                        </Text>
                      </View>
                      <View style={styles.summaryItem}>
                        <Text style={styles.summaryLabel}>Total Amount</Text>
                        <Text
                          style={[styles.summaryValue, styles.amountValue]}
                        >
                          {formatCurrency(payload.totals.total_amount)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.generatedAt}>
                      Generated at{" "}
                      {new Date(payload.generated_at).toLocaleString()}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.placeholderCard}>
                    <Ionicons
                      name="document-text"
                      size={48}
                      color="#CBD5E1"
                    />
                    <Text style={styles.placeholderTitle}>No Billing Data</Text>
                    <Text style={styles.placeholderText}>
                      Enter building details and create billing to see results
                    </Text>
                  </View>
                )}

                {payload && (
                  <View style={{ marginTop: 16, gap: 16 }}>
                    {payload.tenants.map((tenant, tenantIndex) => (
                      <View
                        key={tenant.tenant_id || `tenant-${tenantIndex}`}
                        style={styles.tenantCard}
                      >
                        <View style={styles.tenantHeader}>
                          <Ionicons name="person" size={18} color="#374151" />
                          <View style={styles.tenantInfo}>
                            <Text style={styles.tenantName}>
                              {tenant.tenant_name ||
                                tenant.tenant_id ||
                                "Unassigned Tenant"}
                            </Text>
                            {tenant.tenant_sn && (
                              <Text style={styles.tenantId}>
                                {tenant.tenant_sn}
                              </Text>
                            )}
                          </View>
                        </View>

                        <View style={styles.compactTable}>
                          <View style={styles.compactTableHeader}>
                            <View
                              style={[
                                styles.compactCell,
                                styles.compactCellHeader,
                                { flex: 2 },
                              ]}
                            >
                              <Text style={styles.compactHeaderText}>
                                Stall/Meter
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.compactCell,
                                styles.compactCellHeader,
                                { flex: 1.5 },
                              ]}
                            >
                              <Text style={styles.compactHeaderText}>
                                Readings
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.compactCell,
                                styles.compactCellHeader,
                                { flex: 1 },
                              ]}
                            >
                              <Text style={styles.compactHeaderText}>
                                Consumption
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.compactCell,
                                styles.compactCellHeader,
                                { flex: 1 },
                              ]}
                            >
                              <Text style={styles.compactHeaderText}>ROC</Text>
                            </View>
                            <View
                              style={[
                                styles.compactCell,
                                styles.compactCellHeader,
                                { flex: 1.5 },
                              ]}
                            >
                              <Text style={styles.compactHeaderText}>
                                Rates & Taxes
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.compactCell,
                                styles.compactCellHeader,
                                { flex: 1 },
                              ]}
                            >
                              <Text style={styles.compactHeaderText}>
                                Amount
                              </Text>
                            </View>
                          </View>

                          {tenant.rows.map((row, rowIndex) => (
                            <View
                              key={`${row.meter_id}-${rowIndex}`}
                              style={[
                                styles.compactTableRow,
                                rowIndex % 2 === 0 &&
                                  styles.compactTableRowEven,
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
                                  <Text style={styles.multiplierText}>
                                    ×{fmt(row.mult, 0)}
                                  </Text>
                                </View>
                              </View>

                              <View style={[styles.compactCell, { flex: 1.5 }]}>
                                <View style={styles.readingPair}>
                                  <Text style={styles.readingLabel}>Prev:</Text>
                                  <Text style={styles.readingValue}>
                                    {fmt(row.reading_previous, 0)}
                                  </Text>
                                </View>
                                <View style={styles.readingPair}>
                                  <Text style={styles.readingLabel}>Curr:</Text>
                                  <Text style={styles.readingValue}>
                                    {fmt(row.reading_present, 0)}
                                  </Text>
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
                                <Text
                                  style={[
                                    styles.rocValue,
                                    row.rate_of_change_pct &&
                                    row.rate_of_change_pct > 0
                                      ? styles.rocPositive
                                      : styles.rocNegative,
                                  ]}
                                >
                                  {row.rate_of_change_pct == null
                                    ? "—"
                                    : `${fmt(row.rate_of_change_pct, 0)}%`}
                                </Text>
                              </View>

                              <View style={[styles.compactCell, { flex: 1.5 }]}>
                                <View style={styles.ratesContainer}>
                                  <Text style={styles.rateText}>
                                    System:{" "}
                                    {row.system_rate == null
                                      ? "—"
                                      : fmt(row.system_rate, 4)}
                                  </Text>
                                  <Text style={styles.rateText}>
                                    VAT:{" "}
                                    {row.vat_rate == null
                                      ? "—"
                                      : `${fmt(
                                          (row.vat_rate as number) * 100,
                                          1
                                        )}%`}
                                  </Text>
                                  {row.whtax_code && (
                                    <Text style={styles.rateText}>
                                      WHT: {row.whtax_code}
                                    </Text>
                                  )}
                                  <Text
                                    style={[
                                      styles.penaltyBadge,
                                      row.for_penalty
                                        ? styles.penaltyYes
                                        : styles.penaltyNo,
                                    ]}
                                  >
                                    {row.for_penalty
                                      ? "PENALTY"
                                      : "NO PENALTY"}
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
                          <Text style={styles.tenantTotalLabel}>
                            Tenant Total:
                          </Text>
                          <Text style={styles.tenantTotalAmount}>
                            {formatCurrency(
                              tenant.rows.reduce(
                                (sum, row) => sum + row.total_amount,
                                0
                              )
                            )}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              // STORED BILLINGS
              <View style={styles.storedBillingsCard}>
                <View style={styles.cardHeader}>
                  <Ionicons name="archive" size={20} color="#2563EB" />
                  <Text style={styles.cardTitle}>Stored Billings</Text>
                  <TouchableOpacity
                    onPress={fetchStoredBillings}
                    style={styles.refreshButton}
                  >
                    <Ionicons name="refresh" size={16} color="#64748B" />
                  </TouchableOpacity>
                </View>

                {busy ? (
                  <ActivityIndicator
                    size="large"
                    color="#2563EB"
                    style={styles.loader}
                  />
                ) : Object.keys(storedBillings).length === 0 ? (
                  <View style={styles.placeholderCard}>
                    <Ionicons
                      name="archive-outline"
                      size={48}
                      color="#CBD5E1"
                    />
                    <Text style={styles.placeholderTitle}>
                      No Stored Billings
                    </Text>
                    <Text style={styles.placeholderText}>
                      Generate new billings to see them stored here
                    </Text>
                  </View>
                ) : (
                  <View style={styles.billingList}>
                    {Object.values(storedBillings).map((billing) => (
                      <TouchableOpacity
                        key={billing.building_billing_id}
                        style={styles.billingItem}
                        onPress={() =>
                          fetchStoredBilling(billing.building_billing_id)
                        }
                      >
                        <View style={styles.billingInfo}>
                          <Text style={styles.billingTitle}>
                            {billing.building_id}
                            {billing.building_name
                              ? ` • ${billing.building_name}`
                              : ""}
                          </Text>
                          <Text style={styles.billingPeriod}>
                            {billing.period.start} → {billing.period.end}
                          </Text>
                          <Text style={styles.billingTotals}>
                            {fmt(
                              billing.totals.total_consumed_kwh,
                              4
                            )}{" "}
                            kWh •{" "}
                            {formatCurrency(billing.totals.total_amount)}
                          </Text>
                        </View>
                        <View style={styles.billingActions}>
                          <TouchableOpacity
                            style={styles.downloadButton}
                            onPress={() => onDownloadStoredCsv(billing)}
                          >
                            <Ionicons
                              name="download-outline"
                              size={16}
                              color="#2563EB"
                            />
                            <Text style={styles.downloadButtonText}>
                              CSV
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.rocSection}>
            <RateOfChangePanel />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

/* ========================= Styles ========================= */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },

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

  rocSection: { padding: 24 },

  modeToggle: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  modeTabActive: {
    backgroundColor: "#2563EB",
  },
  modeTabText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  modeTabTextActive: {
    color: "#FFFFFF",
  },

  inputCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  billingCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0F172A",
  },
  billingId: {
    marginLeft: "auto",
    fontSize: 12,
    color: "#64748B",
  },

  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 12,
  },
  summaryItem: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  amountValue: {
    color: "#16A34A",
  },
  generatedAt: {
    fontSize: 12,
    color: "#94A3B8",
  },

  inputGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 16,
  },
  inputGroup: {
    flexBasis: "48%",
    flexGrow: 1,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 10,
    color: "#0F172A",
  },
  picker: {
    flex: 1,
    height: 40,
    color: "#0F172A",
  },

  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    gap: 12,
    marginTop: 8,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2563EB",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    gap: 8,
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    gap: 6,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2563EB",
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  errorCard: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorContent: {
    flex: 1,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#B91C1C",
    marginBottom: 2,
  },
  errorText: {
    fontSize: 13,
    color: "#B91C1C",
  },

  storedBillingsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  refreshButton: {
    marginLeft: "auto",
    padding: 6,
    borderRadius: 999,
    backgroundColor: "#F8FAFC",
  },
  loader: {
    marginTop: 24,
  },

  placeholderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  placeholderTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#0F172A",
    marginTop: 12,
    marginBottom: 4,
  },
  placeholderText: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
  },

  billingList: {
    marginTop: 12,
    gap: 8,
  },
  billingItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
  },
  billingInfo: {
    flex: 1,
  },
  billingTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  billingPeriod: {
    fontSize: 12,
    color: "#64748B",
  },
  billingTotals: {
    fontSize: 12,
    color: "#0F172A",
    marginTop: 2,
  },
  billingActions: {
    marginLeft: 8,
  },
  downloadButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#DBEAFE",
    backgroundColor: "#EFF6FF",
  },
  downloadButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2563EB",
  },

  tenantCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  tenantHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  tenantInfo: {
    flexDirection: "column",
  },
  tenantName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  tenantId: {
    fontSize: 12,
    color: "#6B7280",
  },

  compactTable: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    overflow: "hidden",
  },
  compactTableHeader: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
  },
  compactHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#4B5563",
  },
  compactTableRow: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
  },
  compactTableRowEven: {
    backgroundColor: "#F9FAFB",
  },
  compactCell: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
  },
  compactCellHeader: {
    paddingVertical: 10,
  },
  compactCellPrimary: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  compactCellSecondary: {
    fontSize: 11,
    color: "#6B7280",
  },

  meterTypeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  meterTypeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#FFFFFF",
    backgroundColor: "#4F46E5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  multiplierText: {
    fontSize: 11,
    color: "#64748B",
  },

  readingPair: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readingLabel: {
    fontSize: 11,
    color: "#6B7280",
  },
  readingValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },

  consumptionValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
  },
  previousConsumption: {
    fontSize: 11,
    color: "#6B7280",
  },

  rocValue: {
    fontSize: 13,
    fontWeight: "700",
  },
  rocPositive: {
    color: "#16A34A",
  },
  rocNegative: {
    color: "#DC2626",
  },

  ratesContainer: {
    gap: 2,
  },
  rateText: {
    fontSize: 11,
    color: "#4B5563",
  },
  penaltyBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: "700",
  },
  penaltyYes: {
    backgroundColor: "#FEE2E2",
    color: "#DC2626",
  },
  penaltyNo: {
    backgroundColor: "#DCFCE7",
    color: "#16A34A",
  },

  amountText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },

  tenantTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  tenantTotalLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4B5563",
  },
  tenantTotalAmount: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
});