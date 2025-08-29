// app/(tabs)/billing.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import axios from "axios";
import { useAuth } from "../../contexts/AuthContext";
import { useScanHistory } from "../../contexts/ScanHistoryContext";
import { useFocusEffect, useRouter } from "expo-router";
import { BASE_API } from "../../constants/api";

type Numeric = number | string | null;

type MeterPreview = {
  meter_id: string;
  meter_type: "electric" | "water" | "lpg" | string;
  tenant_id?: string;
  rate_id?: string;
  latest_reading_value?: Numeric;
  prev_reading_value?: Numeric;
  consumption_latest?: Numeric;
  consumption_prev?: Numeric;
  change_rate?: Numeric;
  base_latest?: Numeric;
  vat_latest?: Numeric;
  bill_latest_total?: Numeric;
  base_prev?: Numeric;
  vat_prev?: Numeric;
  bill_prev_total?: Numeric;
  note?: string;
};

type TenantMeterRow = Omit<MeterPreview, "tenant_id" | "rate_id"> & {
  error?: string;
};

type TenantPreview = {
  tenant_id: string;
  tenant_name: string;
  building_id: string;
  rate_id: string;
  meters: TenantMeterRow[];
  totals: {
    base_latest: Numeric;
    vat_latest: Numeric;
    bill_latest_total: Numeric;
  };
};

type Mode = "meter" | "tenant";

export default function BillingScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { scans } = useScanHistory();

  const [mode, setMode] = useState<Mode>("meter");
  const [inputId, setInputId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meterData, setMeterData] = useState<MeterPreview | null>(null);
  const [tenantData, setTenantData] = useState<TenantPreview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const authHeader = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const toNum = (x: Numeric | undefined): number | null => {
    if (x === null || x === undefined) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  const money = (x: Numeric | undefined): string => {
    const n = toNum(x);
    if (n === null) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const qty = (x: Numeric | undefined, digits = 2): string => {
    const n = toNum(x);
    if (n === null) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };

  const changeBadge = (rate: Numeric | undefined) => {
    const n = toNum(rate);
    if (n === null) return <Text style={[styles.badge, styles.badgeNeutral]}>n/a</Text>;
    if (n > 0) return <Text style={[styles.badge, styles.badgeUp]}>▲ {n.toFixed(1)}%</Text>;
    if (n < 0) return <Text style={[styles.badge, styles.badgeDown]}>▼ {Math.abs(n).toFixed(1)}%</Text>;
    return <Text style={[styles.badge, styles.badgeNeutral]}>0.0%</Text>;
  };

  const lastScannedCandidate = useMemo(() => {
    // Look from newest to oldest and try to extract MTR-... or TEN-...
    for (let i = scans.length - 1; i >= 0; i--) {
      const raw = String(scans[i].data || "").trim();
      if (/^https?:\/\//i.test(raw)) continue; // skip URLs
      const mtrMatch = raw.match(/\bMTR-[A-Za-z0-9-]+\b/);
      if (mtrMatch) return mtrMatch[0];
      const tenMatch = raw.match(/\bTEN-[A-Za-z0-9-]+\b/);
      if (tenMatch) return tenMatch[0];
      // fall back: uppercase, keep letters/numbers/dash, min 3 chars
      const candidate = raw.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
      if (candidate.length >= 3) return candidate;
    }
    return "";
  }, [scans]);

  useFocusEffect(
    useCallback(() => {
      // Auto-fill from last scan if empty
      if (!inputId && lastScannedCandidate) {
        setInputId(lastScannedCandidate);
      }
    }, [inputId, lastScannedCandidate])
  );

  const onPreview = async () => {
    const id = inputId.trim();
    if (!id) {
      Alert.alert("Missing ID", `Please enter a ${mode === "meter" ? "Meter ID (e.g. MTR-1)" : "Tenant ID (e.g. TEN-1)"}.`);
      return;
    }
    setLoading(true);
    setError(null);
    setMeterData(null);
    setTenantData(null);
    try {
      const url =
        mode === "meter"
          ? `${BASE_API}/billings/meters/${encodeURIComponent(id)}`
          : `${BASE_API}/billings/tenants/${encodeURIComponent(id)}`;
      const { data } = await axios.get(url, { headers: authHeader });
      if (mode === "meter") setMeterData(data as MeterPreview);
      else setTenantData(data as TenantPreview);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        "Failed to load billing preview.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await onPreview();
    } finally {
      setRefreshing(false);
    }
  };

  const onUseScan = () => {
    if (lastScannedCandidate) {
      setInputId(lastScannedCandidate);
      // Do not auto-run preview to keep things explicit
    } else {
      Alert.alert("No scans yet", "Scan a QR code in the Scanner tab first.");
    }
  };

  const goToScanner = () => router.push("/(tabs)/scanner");

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Text style={styles.title}>Billing Dashboard</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "meter" && styles.modeActive]}
            onPress={() => setMode("meter")}
          >
            <Text style={[styles.modeText, mode === "meter" && styles.modeTextActive]}>
              Single Meter
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "tenant" && styles.modeActive]}
            onPress={() => setMode("tenant")}
          >
            <Text style={[styles.modeText, mode === "tenant" && styles.modeTextActive]}>
              Tenant Aggregate
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <TextInput
            value={inputId}
            onChangeText={setInputId}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder={mode === "meter" ? "Enter Meter ID (e.g. MTR-1)" : "Enter Tenant ID (e.g. TEN-1)"}
            placeholderTextColor="#8A8F98"
            style={styles.input}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onUseScan}>
            <Text style={[styles.btnText, styles.btnGhostText]}>Use last scan</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={goToScanner}>
            <Text style={styles.btnText}>Scan QR</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onPreview}>
            <Text style={styles.btnText}>Preview</Text>
          </TouchableOpacity>
        </View>

        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 8, color: "#3C3F44" }}>Computing…</Text>
          </View>
        )}

        {!!error && (
          <View style={[styles.card, styles.cardError]}>
            <Text style={styles.cardTitle}>Load failed</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && mode === "meter" && meterData && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Meter Summary</Text>
              <View style={styles.kv}>
                <Text style={styles.k}>Meter ID</Text>
                <Text style={styles.v}>{meterData.meter_id}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>Type</Text>
                <Text style={styles.v}>{String(meterData.meter_type || "").toUpperCase()}</Text>
              </View>
              {"tenant_id" in meterData && (
                <View style={styles.kv}>
                  <Text style={styles.k}>Tenant</Text>
                  <Text style={styles.v}>{meterData.tenant_id || "-"}</Text>
                </View>
              )}
              {"rate_id" in meterData && (
                <View style={styles.kv}>
                  <Text style={styles.k}>Rate</Text>
                  <Text style={styles.v}>{meterData.rate_id || "-"}</Text>
                </View>
              )}
              {meterData.note && (
                <View style={[styles.note]}>
                  <Text style={styles.noteText}>{meterData.note}</Text>
                </View>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Latest Bill</Text>
              <View style={styles.grid2}>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>Consumption</Text>
                  <Text style={styles.cellValue}>{qty(meterData.consumption_latest)}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>Change</Text>
                  {changeBadge(meterData.change_rate)}
                </View>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>Base</Text>
                  <Text style={styles.cellValue}>₱ {money(meterData.base_latest)}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>VAT</Text>
                  <Text style={styles.cellValue}>₱ {money(meterData.vat_latest)}</Text>
                </View>
                <View style={[styles.cell, styles.totalCell]}>
                  <Text style={[styles.cellLabel, styles.totalLabel]}>Total</Text>
                  <Text style={[styles.cellValue, styles.totalValue]}>₱ {money(meterData.bill_latest_total)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Previous Bill</Text>
              <View style={styles.grid2}>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>Consumption</Text>
                  <Text style={styles.cellValue}>{qty(meterData.consumption_prev)}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>Base</Text>
                  <Text style={styles.cellValue}>₱ {money(meterData.base_prev)}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>VAT</Text>
                  <Text style={styles.cellValue}>₱ {money(meterData.vat_prev)}</Text>
                </View>
                <View style={[styles.cell, styles.totalCell]}>
                  <Text style={[styles.cellLabel, styles.totalLabel]}>Total</Text>
                  <Text style={[styles.cellValue, styles.totalValue]}>₱ {money(meterData.bill_prev_total)}</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {!loading && !error && mode === "tenant" && tenantData && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Tenant Summary</Text>
              <View style={styles.kv}>
                <Text style={styles.k}>Tenant</Text>
                <Text style={styles.v}>{tenantData.tenant_id} — {tenantData.tenant_name}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>Building</Text>
                <Text style={styles.v}>{tenantData.building_id}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>Rate</Text>
                <Text style={styles.v}>{tenantData.rate_id}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current Totals</Text>
              <View style={styles.grid2}>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>Base</Text>
                  <Text style={styles.cellValue}>₱ {money(tenantData.totals.base_latest)}</Text>
                </View>
                <View style={styles.cell}>
                  <Text style={styles.cellLabel}>VAT</Text>
                  <Text style={styles.cellValue}>₱ {money(tenantData.totals.vat_latest)}</Text>
                </View>
                <View style={[styles.cell, styles.totalCell]}>
                  <Text style={[styles.cellLabel, styles.totalLabel]}>Grand Total</Text>
                  <Text style={[styles.cellValue, styles.totalValue]}>₱ {money(tenantData.totals.bill_latest_total)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Meters</Text>
              {tenantData.meters.length === 0 ? (
                <Text style={styles.muted}>No meters found for this tenant.</Text>
              ) : (
                tenantData.meters.map((m) => (
                  <View key={m.meter_id} style={styles.meterRow}>
                    <View style={styles.rowHeader}>
                      <Text style={styles.rowTitle}>{m.meter_id}</Text>
                      <Text style={styles.rowSubtitle}>{String(m.meter_type).toUpperCase()}</Text>
                    </View>
                    {m.error ? (
                      <Text style={[styles.errorText, { marginTop: 8 }]}>{m.error}</Text>
                    ) : m.note ? (
                      <Text style={[styles.muted, { marginTop: 8 }]}>{m.note}</Text>
                    ) : (
                      <View style={styles.grid3}>
                        <View style={styles.cell}>
                          <Text style={styles.cellLabel}>Consumption</Text>
                          <Text style={styles.cellValue}>{qty(m.consumption_latest)}</Text>
                        </View>
                        <View style={styles.cell}>
                          <Text style={styles.cellLabel}>Change</Text>
                          {changeBadge(m.change_rate)}
                        </View>
                        <View style={[styles.cell, styles.totalCell]}>
                          <Text style={[styles.cellLabel, styles.totalLabel]}>Total</Text>
                          <Text style={[styles.cellValue, styles.totalValue]}>₱ {money(m.bill_latest_total)}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F6F7F9",
  },
  container: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1F2430",
    marginBottom: 12,
    marginTop: Platform.select({ ios: 4, android: 4, default: 0 }),
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#E6E9EF",
    alignItems: "center",
  },
  modeActive: {
    backgroundColor: "#2251FF",
  },
  modeText: {
    fontWeight: "700",
    color: "#3C3F44",
  },
  modeTextActive: {
    color: "#fff",
  },
  inputRow: {
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D7DCE3",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.select({ ios: 12, android: 10, default: 10 }),
    fontSize: 16,
    color: "#101218",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhost: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#D7DCE3",
  },
  btnGhostText: {
    color: "#30343B",
  },
  btnSecondary: {
    backgroundColor: "#111827",
  },
  btnPrimary: {
    backgroundColor: "#2251FF",
  },
  btnText: {
    color: "#fff",
    fontWeight: "700",
  },
  loading: {
    backgroundColor: "#fff",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    borderWidth: 1,
    borderColor: "#E3E7EE",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E3E7EE",
    marginBottom: 12,
  },
  cardError: {
    borderColor: "#F6C5C5",
    backgroundColor: "#FFF6F6",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#1F2430",
    marginBottom: 8,
  },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  k: {
    color: "#6B7280",
  },
  v: {
    color: "#111827",
    fontWeight: "700",
  },
  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 12,
  },
  grid3: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 12,
  },
  cell: {
    width: "48%",
    backgroundColor: "#F7F9FC",
    borderWidth: 1,
    borderColor: "#E3E7EE",
    borderRadius: 12,
    padding: 12,
  },
  cellLabel: {
    color: "#6B7280",
    marginBottom: 6,
  },
  cellValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  totalCell: {
    backgroundColor: "#F0F5FF",
    borderColor: "#D6E0FF",
  },
  totalLabel: {
    color: "#374151",
  },
  totalValue: {
    color: "#0B3BFF",
  },
  badge: {
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
    textAlign: "center",
  },
  badgeUp: { backgroundColor: "#E7F6EC", color: "#0A7A3E" },
  badgeDown: { backgroundColor: "#FDECEC", color: "#B91C1C" },
  badgeNeutral: { backgroundColor: "#F1F5F9", color: "#475569" },
  note: {
    marginTop: 6,
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: "#E3E7EE",
    borderRadius: 10,
    padding: 10,
  },
  noteText: {
    color: "#6B7280",
  },
  meterRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF0F4",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  rowTitle: {
    fontWeight: "800",
    color: "#111827",
  },
  rowSubtitle: {
    color: "#6B7280",
    fontSize: 12,
  },
  muted: {
    color: "#6B7280",
  },
  errorText: {
    color: "#B91C1C",
  },
});
