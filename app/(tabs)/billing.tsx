// app/(tabs)/billing.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import axios from "axios";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../../contexts/AuthContext";
import { useScanHistory } from "../../contexts/ScanHistoryContext";
import { BASE_API } from "../../constants/api";

/** -------- helpers -------- */
type Numeric = number | string | null;

const ymd = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  return `${Y}-${M}-${D}`;
};

// Normalize any API/axios error into a readable string
const errorToText = (err: any): string => {
  if (!err) return "Failed to load billing preview.";
  const data = err?.response?.data;
  const candidates = [data?.error, data?.message, err?.message];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") return c;
    if (typeof c === "object" && typeof (c as any).message === "string") return (c as any).message;
  }
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data || err);
  } catch {
    return "Failed to load billing preview.";
  }
};

const toNumber = (n: Numeric | undefined): number => {
  if (n === null || n === undefined) return 0;
  if (typeof n === "number") return isFinite(n) ? n : 0;
  if (typeof n === "string") {
    const x = parseFloat(n);
    return isFinite(x) ? x : 0;
  }
  return 0;
};

const fmt = (n: Numeric | undefined, currency = true) => {
  const v = toNumber(n);
  return currency
    ? Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "PHP",
        maximumFractionDigits: 2,
      }).format(v)
    : Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
};

/** -------- types (aligned with routes/billings.js) -------- */
type PeriodBill = {
  prev_index: number | null;
  curr_index: number | null;
  consumption: number; // 0 for downtime
  base: number;        // 0 for downtime
  vat: number;         // 0 for downtime
  total: number;       // 0 for downtime
};

type PeriodOut = {
  type: "billable" | "downtime";
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  reason?: string; // for downtime segments
  bill: PeriodBill;
};

type BillingApiResponse = {
  meter_id: string;
  meter_type: "electric" | "water" | "lpg";
  periods: PeriodOut[];
  totals: { consumption: number; base: number; vat: number; total: number };
};

/** -------- component -------- */
export default function BillingScreen() {
  const { token } = useAuth();
  const { scans } = useScanHistory();

  const authHeader = useMemo(
    () => ({ Authorization: token ? `Bearer ${token}` : "" }),
    [token]
  );

  // Inputs
  const [meterId, setMeterId] = useState<string>("");
  const [endDate, setEndDate] = useState<string>(ymd());

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BillingApiResponse | null>(null);

  // Newest scan first → try to extract MTR-*
  const lastScannedCandidate = useMemo(() => {
    for (let i = 0; i < scans.length; i++) {
      const raw = String((scans[i] as any)?.data || "").trim();
      if (!raw) continue;
      if (/^https?:\/\//i.test(raw)) continue;
      const m = raw.match(/\bMTR-[A-Za-z0-9-]+\b/i);
      if (m) return m[0].toUpperCase();
      const candidate = raw.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
      if (candidate.startsWith("MTR-")) return candidate;
    }
    return "";
  }, [scans]);

  // Auto-apply last scan when focusing screen
  useFocusEffect(
    useCallback(() => {
      if (lastScannedCandidate) setMeterId(lastScannedCandidate);
    }, [lastScannedCandidate])
  );

  // Validate inputs
  const isValidMeter = /^MTR-[A-Za-z0-9-]+$/.test(meterId.trim());
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(endDate.trim());

  const fetchPreview = useCallback(async () => {
    const id = meterId.trim().toUpperCase();
    const ed = endDate.trim();
    if (!id || !ed) return;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const url = `${BASE_API}/billings/meters/${encodeURIComponent(id)}/period-end/${encodeURIComponent(ed)}`;
      const res = await axios.get(url, { headers: authHeader });
      setData(res.data as BillingApiResponse);
    } catch (err: any) {
      setError(errorToText(err));
    } finally {
      setLoading(false);
    }
  }, [meterId, endDate, authHeader]);

  // Debounced auto-preview
  const lastKeyRef = useRef<string>("");
  useEffect(() => {
    if (!isValidMeter || !isValidDate) {
      setData(null);
      setError(null);
      lastKeyRef.current = "";
      return;
    }
    const key = `${meterId}|${endDate}`;
    if (lastKeyRef.current === key) return;
    const t = setTimeout(() => {
      lastKeyRef.current = key;
      fetchPreview();
    }, 350);
    return () => clearTimeout(t);
  }, [meterId, endDate, isValidMeter, isValidDate, fetchPreview]);

  // UI helpers
  const applyLastScan = () => {
    if (lastScannedCandidate) setMeterId(lastScannedCandidate);
  };
  const setToday = () => setEndDate(ymd(new Date()));
  const clearAll = () => {
    setMeterId("");
    setEndDate(ymd());
    setData(null);
    setError(null);
  };

  const BillTag = ({ type }: { type: PeriodOut["type"] }) => (
    <View style={[styles.tag, type === "billable" ? styles.tagOk : styles.tagMuted]}>
      <Text style={[styles.tagText, type === "billable" ? styles.tagTextOk : styles.tagTextMuted]}>
        {type === "billable" ? "BILLABLE" : "DOWNTIME"}
      </Text>
    </View>
  );

  /** -------- render -------- */
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={{ gap: 2 }}>
          {/* Brand header */}
          <View
            style={[
              styles.brandHeader,
              Platform.OS === "web" && { alignItems: "flex-start", marginTop: -30 },
            ]}
          >
            <Image
              source={require("../../assets/images/logo.png")}
              style={styles.brandLogo}
              resizeMode="contain"
            />
          </View>

          {/* Inputs card */}
          <View style={styles.card}>
            <Text style={styles.title}>Meter Billing Preview</Text>

            <Text style={styles.label}>Meter ID</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={meterId}
                onChangeText={setMeterId}
                placeholder="e.g. MTR-1"
                placeholderTextColor="#8A8F98"
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
              />
              {meterId?.length > 0 ? (
                <TouchableOpacity onPress={clearAll} style={styles.pillBtn}>
                  <Text style={styles.pillText}>Clear</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={applyLastScan} style={styles.pillBtn}>
                  <Text style={styles.pillText}>Use last scan</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={[styles.label, { marginTop: 10 }]}>Period-end date</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#8A8F98"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <TouchableOpacity onPress={setToday} style={styles.pillBtn}>
                <Text style={styles.pillText}>Today</Text>
              </TouchableOpacity>
            </View>

            {!!error && (
              <View style={[styles.badge, styles.badgeError]}>
                <Text style={styles.badgeText}>{error}</Text>
              </View>
            )}
          </View>

          {/* Loading */}
          {loading && (
            <View style={styles.card}>
              <View style={[styles.center, { paddingVertical: 16 }]}>
                <ActivityIndicator />
                <Text style={{ color: "#6b7280", marginTop: 8 }}>Loading preview…</Text>
              </View>
            </View>
          )}

          {/* No data yet */}
          {!loading && !error && !data && (
            <View style={styles.card}>
              <Text style={{ color: "#6b7280" }}>Enter a valid Meter ID and date to preview.</Text>
            </View>
          )}

          {/* Preview */}
          {!loading && data && (
            <>
              {/* Summary */}
              <View style={styles.card}>
                <View style={styles.summaryHeader}>
                  <Text style={styles.summaryTitle}>
                    {data.meter_id} · {String(data.meter_type || "").toUpperCase()}
                  </Text>
                  <TouchableOpacity onPress={fetchPreview} style={[styles.pillBtn, { paddingVertical: 6 }]}>
                    <Text style={styles.pillText}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.summaryRow}>
                  <View style={styles.sumCol}>
                    <Text style={styles.sumLabel}>Consumption</Text>
                    <Text style={styles.sumValue}>{fmt(data.totals.consumption, false)}</Text>
                  </View>
                  <View style={styles.sumCol}>
                    <Text style={styles.sumLabel}>Base</Text>
                    <Text style={styles.sumValue}>{fmt(data.totals.base)}</Text>
                  </View>
                  <View style={styles.sumCol}>
                    <Text style={styles.sumLabel}>VAT</Text>
                    <Text style={styles.sumValue}>{fmt(data.totals.vat)}</Text>
                  </View>
                  <View style={styles.sumCol}>
                    <Text style={styles.sumLabel}>Total</Text>
                    <Text style={[styles.sumValue, styles.sumEm]}>{fmt(data.totals.total)}</Text>
                  </View>
                </View>
              </View>

              {/* Periods */}
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Period breakdown</Text>

                {data.periods.length === 0 ? (
                  <Text style={{ color: "#6b7280", marginTop: 6 }}>No data in range.</Text>
                ) : (
                  data.periods.map((p, i) => (
                    <View key={`${p.start}_${p.end}_${i}`} style={styles.periodRow}>
                      <View style={styles.periodHeader}>
                        <BillTag type={p.type} />
                        <Text style={styles.periodDates}>
                          {p.start} → {p.end}
                        </Text>
                      </View>

                      {p.type === "downtime" && !!p.reason && (
                        <View style={[styles.badge, styles.badgeMuted]}>
                          <Text style={[styles.badgeText, { color: "#374151" }]}>
                            {p.reason}
                          </Text>
                        </View>
                      )}

                      <View style={styles.grid2}>
                        <View style={styles.kv}>
                          <Text style={styles.k}>Prev index</Text>
                          <Text style={styles.v}>{p.bill.prev_index ?? "—"}</Text>
                        </View>
                        <View style={styles.kv}>
                          <Text style={styles.k}>Current index</Text>
                          <Text style={styles.v}>{p.bill.curr_index ?? "—"}</Text>
                        </View>
                        <View style={styles.kv}>
                          <Text style={styles.k}>Consumption</Text>
                          <Text style={styles.v}>{fmt(p.bill.consumption, false)}</Text>
                        </View>
                        <View style={styles.kv}>
                          <Text style={styles.k}>Base</Text>
                          <Text style={styles.v}>{fmt(p.bill.base)}</Text>
                        </View>
                        <View style={styles.kv}>
                          <Text style={styles.k}>VAT</Text>
                          <Text style={styles.v}>{fmt(p.bill.vat)}</Text>
                        </View>
                        <View style={styles.kv}>
                          <Text style={styles.k}>Total</Text>
                          <Text style={[styles.v, { fontWeight: "700" }]}>{fmt(p.bill.total)}</Text>
                        </View>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/** -------- styles -------- */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f7fb" },
  container: { flex: 1, padding: 12, gap: 8 },

  brandHeader: { width: "100%", alignItems: "center", marginBottom: 2 },
  brandLogo: { width: 90, height: 90, opacity: 0.95 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    ...(Platform.select({
      web: { boxShadow: "0 4px 16px rgba(0,0,0,0.06)" as any },
      default: { elevation: 2 },
    }) as any),
  },

  title: { fontSize: 18, fontWeight: "700", color: "#0f172a", marginBottom: 8 },
  label: { fontSize: 12, color: "#6b7280", marginTop: 2 },

  inputRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 6 },
  input: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    paddingHorizontal: 12,
    color: "#111827",
  },
  pillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#0ea5e9",
    borderRadius: 999,
  },
  pillText: { color: "#fff", fontWeight: "600" },

  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 10,
  },
  badgeError: { backgroundColor: "#fee2e2" },
  badgeMuted: { backgroundColor: "#f3f4f6" },
  badgeText: { color: "#b91c1c", fontWeight: "600" },

  center: { alignItems: "center", justifyContent: "center" },

  summaryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  summaryRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  sumCol: {
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  sumLabel: { fontSize: 12, color: "#6b7280" },
  sumValue: { fontSize: 16, fontWeight: "700", color: "#111827", marginTop: 4 },
  sumEm: { color: "#082cac" },

  sectionTitle: { fontWeight: "700", color: "#111827" },

  periodRow: {
    borderWidth: 1,
    borderColor: "#eef2f7",
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    backgroundColor: "#fafafa",
  },
  periodHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  periodDates: { color: "#374151", fontWeight: "600" },

  tag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagOk: { backgroundColor: "#e8f5e9", borderColor: "#b6e3be" },
  tagMuted: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" },
  tagText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  tagTextOk: { color: "#1b5e20" },
  tagTextMuted: { color: "#3730a3" },

  grid2: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 10,
    rowGap: 8,
  },
  kv: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eef2f7",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    minWidth: 150,
    flexGrow: 1,
  },
  k: { fontSize: 11, color: "#6b7280" },
  v: { fontSize: 14, color: "#111827", fontWeight: "600", marginTop: 2 },
});