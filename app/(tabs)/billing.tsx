import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
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
import axios from "axios";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../../contexts/AuthContext";
import { useScanHistory } from "../../contexts/ScanHistoryContext";
import { BASE_API } from "../../constants/api";

// ---------- helpers ----------
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

// ---------- types (NEW API SHAPE) ----------

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
  start: string;
  end: string;
  reason?: string; // downtime only
  bill: PeriodBill;
};

type BillingApiResponse = {
  meter_id: string;
  meter_type: string; // "electric" | "water" | "lpg" | etc.
  periods: PeriodOut[];
  totals: { consumption: number; base: number; vat: number; total: number };
};

// ---------- component ----------
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
      const url = `${BASE_API}/billings/meters/${encodeURIComponent(
        id
      )}/period-end/${encodeURIComponent(ed)}`;
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

  // ---------- render ----------
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
          <View className="card" style={styles.card}>
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
                <ActivityIndicator size="large" />
                <Text style={styles.muted}>Computing…</Text>
              </View>
            </View>
          )}

          {/* Result (NEW) */}
          {!loading && !error && data && (
            <>
              <View style={styles.card}>
                <Text style={styles.title}>
                  Meter {data.meter_id} ({String(data.meter_type || "").toUpperCase()})
                </Text>
                <View style={styles.divider} />

                {data.periods.length === 0 ? (
                  <Text style={styles.muted}>No segments for this period.</Text>
                ) : (
                  <View style={{ gap: 10 }}>
                    {data.periods.map((p, idx) => (
                      <View key={`${p.start}-${p.end}-${idx}`} style={styles.segment}>
                        <View style={styles.segmentHeader}>
                          <BillTag type={p.type} />
                          <Text style={styles.segmentDates}>
                            {p.start} → {p.end}
                          </Text>
                        </View>

                        {p.type === "downtime" ? (
                          <Text style={styles.muted}>Reason: {p.reason || "zero readings"}</Text>
                        ) : (
                          <View style={styles.grid2}>
                            <View style={styles.stat}>
                              <Text style={styles.statLabel}>Prev index</Text>
                              <Text style={styles.statValue}>{fmt(p.bill.prev_index, false)}</Text>
                            </View>
                            <View style={styles.stat}>
                              <Text style={styles.statLabel}>Current index</Text>
                              <Text style={styles.statValue}>{fmt(p.bill.curr_index, false)}</Text>
                            </View>
                            <View style={styles.stat}>
                              <Text style={styles.statLabel}>Consumption</Text>
                              <Text style={styles.statValue}>{fmt(p.bill.consumption, false)}</Text>
                            </View>
                            <View style={styles.stat}>
                              <Text style={styles.statLabel}>Base</Text>
                              <Text style={styles.statValue}>{fmt(p.bill.base)}</Text>
                            </View>
                            <View style={styles.stat}>
                              <Text style={styles.statLabel}>VAT</Text>
                              <Text style={styles.statValue}>{fmt(p.bill.vat)}</Text>
                            </View>
                            <View style={styles.stat}>
                              <Text style={styles.statLabel}>Total</Text>
                              <Text style={styles.statValue}>{fmt(p.bill.total)}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {/* Roll-up totals */}
              <View style={styles.card}>
                <Text style={styles.title}>Billable totals (this period)</Text>
                <View style={styles.grid2}>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Consumption</Text>
                    <Text style={styles.statValue}>{fmt(data.totals.consumption, false)}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Base</Text>
                    <Text style={styles.statValue}>{fmt(data.totals.base)}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>VAT</Text>
                    <Text style={styles.statValue}>{fmt(data.totals.vat)}</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Total</Text>
                    <Text style={styles.statValue}>{fmt(data.totals.total)}</Text>
                  </View>
                </View>
              </View>
            </>
          )}

          {/* Empty hint */}
          {!loading && !error && !data && (!meterId || !endDate) && (
            <View style={[styles.card, styles.center]}>
              <Text style={styles.muted}>
                Enter a meter ID and period-end date to preview billing.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F6FA",
  },
  container: {
    flex: 1,
    padding: 18,
    paddingTop: 8,
  },
  brandHeader: {
    alignItems: "center",
  },
  brandLogo: {
    height: 100,
    width: 100,
  },
  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 14,
    marginTop: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    ...Platform.select({ android: { elevation: 1 } }),
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#11181C",
    marginBottom: 2,
  },
  label: {
    fontSize: 13,
    color: "#4B5563",
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  input: {
    flex: 1,
    backgroundColor: "#F8FAFF",
    borderWidth: 1,
    borderColor: "#E6EBF3",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
  },
  pillBtn: {
    backgroundColor: "#11181C",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
  },
  pillText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  stat: {
    flexGrow: 1,
    flexBasis: "48%",
    padding: 10,
    backgroundColor: "#FAFBFE",
    borderWidth: 1,
    borderColor: "#E6EBF3",
    borderRadius: 10,
  },
  statLabel: {
    fontSize: 12,
    color: "#6B7280",
  },
  statValue: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "700",
    color: "#11181C",
  },
  divider: {
    height: 1,
    backgroundColor: "#EEF2F7",
    marginVertical: 8,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  muted: {
    color: "#6B7280",
    fontSize: 13,
  },
  badge: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  badgeError: {
    backgroundColor: "#FEE2E2",
  },
  badgeText: {
    color: "#991B1B",
    fontWeight: "600",
  },
  segment: {
    borderWidth: 1,
    borderColor: "#E6EBF3",
    borderRadius: 10,
    padding: 10,
  },
  segmentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  segmentDates: {
    fontWeight: "700",
    color: "#11181C",
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagOk: {
    backgroundColor: "#E7F6EC",
  },
  tagMuted: {
    backgroundColor: "#EEF2F7",
  },
  tagText: {
    fontSize: 11,
    fontWeight: "700",
  },
  tagTextOk: {
    color: "#166534",
  },
  tagTextMuted: {
    color: "#334155",
  },
});