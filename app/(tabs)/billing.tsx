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
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import axios from "axios";
import { useFocusEffect } from "expo-router";
import { useAuth } from "../../contexts/AuthContext";
import { useScanHistory } from "../../contexts/ScanHistoryContext";
import { BASE_API } from "../../constants/api";
import { Picker } from "@react-native-picker/picker";

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
    if (typeof c === "object" && typeof (c as any).message === "string")
      return (c as any).message;
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
  base: number; // 0 for downtime
  vat: number; // 0 for downtime
  total: number; // 0 for downtime
};

type PeriodOut = {
  type: "billable" | "downtime";
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  reason?: string; // for downtime segments
  bill: PeriodBill;
};

type BillingApiResponse = {
  meter_id: string;
  meter_type: "electric" | "water" | "lpg";
  periods: PeriodOut[];
  totals: { consumption: number; base: number; vat: number; total: number };
};

/** -------- DatePickerField (cross-platform) -------- */
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function daysInMonth(y: number, m1to12: number) {
  return new Date(y, m1to12, 0).getDate();
}
function splitYMD(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!m) {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  return { y: +m[1], m: +m[2], d: +m[3] };
}

function DatePickerField({
  value,
  onChange,
  style,
  placeholder = "YYYY-MM-DD",
}: {
  value: string;
  onChange: (v: string) => void;
  style?: any;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  const { y, m, d } = splitYMD(value);
  const [yy, setYy] = useState(y);
  const [mm, setMm] = useState(m);
  const [dd, setDd] = useState(d);

  useEffect(() => {
    const cur = splitYMD(value);
    setYy(cur.y);
    setMm(cur.m);
    setDd(cur.d);
  }, [value]);

  // WEB: use native <input type="date"> for best UX
  const openWebPicker = () => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "date";
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.value = value || ymd();
    document.body.appendChild(input);
    input.onchange = () => {
      onChange(String(input.value));
      setTimeout(() => input.remove(), 0);
    };
    input.onblur = () => setTimeout(() => input.remove(), 0);
    input.click();
  };

  const applyMobile = () => {
    const maxDay = daysInMonth(yy, mm);
    const safeD = clamp(dd, 1, maxDay);
    onChange(
      `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(
        safeD
      ).padStart(2, "0")}`
    );
    setVisible(false);
  };

  // --- inside DatePickerField ---
  if (Platform.OS === "web") {
    return (
      // @ts-ignore - using a real HTML input on web
      <input
        type="date"
        value={value || ""}
        onChange={(e: any) => onChange(e.target.value)}
        // style to match styles.input (height, padding, border, radius, colors)
        style={{
          flex: 1,
          backgroundColor: "#f8fafc",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#e2e8f0",
          borderRadius: 10,
          padding: "0 12px",
          height: 40,
          color: "#102a43",
          outline: "none",
          width: "100%",
        }}
      />
    );
  }

  // Mobile: simple modal with three pickers (Month/Day/Year)
  const years: number[] = (() => {
    const now = new Date().getFullYear();
    const arr: number[] = [];
    for (let i = now + 2; i >= now - 10; i--) arr.push(i);
    return arr;
  })();
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const maxDay = daysInMonth(yy, mm);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);

  return (
    <>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={[style, { justifyContent: "center" }]}
      >
        <Text style={{ color: "#102a43" }}>
          {value ? value : placeholder}
        </Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={modalStyles.wrap}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>Select date</Text>
            <View style={modalStyles.row}>
              <View style={modalStyles.col}>
                <Text style={modalStyles.label}>Month</Text>
                <Picker
                  selectedValue={mm}
                  onValueChange={(v) => setMm(Number(v))}
                >
                  {months.map((m) => (
                    <Picker.Item key={m} label={String(m)} value={m} />
                  ))}
                </Picker>
              </View>
              <View style={modalStyles.col}>
                <Text style={modalStyles.label}>Day</Text>
                <Picker
                  selectedValue={dd > maxDay ? maxDay : dd}
                  onValueChange={(v) => setDd(Number(v))}
                >
                  {days.map((d) => (
                    <Picker.Item key={d} label={String(d)} value={d} />
                  ))}
                </Picker>
              </View>
              <View style={modalStyles.col}>
                <Text style={modalStyles.label}>Year</Text>
                <Picker
                  selectedValue={yy}
                  onValueChange={(v) => setYy(Number(v))}
                >
                  {years.map((y) => (
                    <Picker.Item key={y} label={String(y)} value={y} />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={modalStyles.actions}>
              <TouchableOpacity
                onPress={() => setVisible(false)}
                style={[styles.pillBtn, { backgroundColor: "#e2e8f0" }]}
              >
                <Text style={[styles.pillText, { color: "#102a43" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyMobile} style={styles.pillBtn}>
                <Text style={styles.pillText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const modalStyles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  title: { fontWeight: "700", color: "#102a43", fontSize: 16, marginBottom: 8 },
  row: { flexDirection: "row", gap: 8 },
  col: { flex: 1 },
  label: { color: "#64748b", fontSize: 12, marginBottom: 4 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
  },
});

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
    <View
      style={[
        styles.tag,
        type === "billable" ? styles.tagOk : styles.tagMuted,
      ]}
    >
      <Text
        style={[
          styles.tagText,
          type === "billable" ? styles.tagTextOk : styles.tagTextMuted,
        ]}
      >
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
              Platform.OS === "web" && {
                alignItems: "flex-start",
                marginTop: -30,
              },
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

            <Text style={[styles.label, { marginTop: 10 }]}>
              Period-end date
            </Text>
            <View style={styles.inputRow}>
              {/* ⤵️ Swapped the TextInput for a cross-platform DatePicker */}
              <DatePickerField
                value={endDate}
                onChange={setEndDate}
                style={styles.input}
                placeholder="YYYY-MM-DD"
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
            <View className="card" style={styles.card}>
              <View style={[styles.center, { paddingVertical: 16 }]}>
                <ActivityIndicator />
                <Text style={{ color: "#6b7b8c", marginTop: 6 }}>
                  Loading preview…
                </Text>
              </View>
            </View>
          )}

          {/* Preview */}
          {!loading && data && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {data.meter_id} • {data.meter_type.toUpperCase()}
              </Text>

              {/* Totals */}
              <View style={[styles.badge, styles.badgeOk]}>
                <Text style={styles.badgeText}>
                  Total consumption: {fmt(data.totals.consumption, false)} • Base:{" "}
                  {fmt(data.totals.base)} • VAT: {fmt(data.totals.vat)} • Total:{" "}
                  {fmt(data.totals.total)}
                </Text>
              </View>

              {/* Periods */}
              {data.periods.map((p, idx) => (
                <View key={`${p.start}-${p.end}-${idx}`} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {p.start} → {p.end}
                    </Text>
                    <Text style={styles.rowSub}>
                      {p.type === "downtime"
                        ? p.reason || "Downtime"
                        : `kWh/CBM: ${fmt(p.bill.consumption, false)} • Base: ${fmt(
                            p.bill.base
                          )} • VAT: ${fmt(p.bill.vat)} • Total: ${fmt(
                            p.bill.total
                          )}`}
                    </Text>
                  </View>
                  <BillTag type={p.type} />
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/** -------- styles (unchanged) -------- */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f7fb" },
  container: { flex: 1, padding: 12, gap: 8 },
  brandHeader: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#eef2f7",
    alignItems: "center",
  },
  brandLogo: { width: 88, height: 36, opacity: 0.9 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16,42,67,0.05)" as any },
      default: { elevation: 2 },
    }) as any),
    gap: 8,
  },

  title: { fontSize: 16, fontWeight: "800", color: "#102a43" },

  label: { color: "#6b7b8c", fontSize: 12, marginBottom: 4 },

  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    color: "#102a43",
  },

  pillBtn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
  },
  pillText: { color: "#fff", fontWeight: "700" },

  badge: {
    marginTop: 6,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  badgeOk: { backgroundColor: "#e6f7ef" },
  badgeError: { backgroundColor: "#ffe8e6" },
  badgeText: { color: "#102a43" },

  row: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: { color: "#102a43", fontWeight: "700" },
  rowSub: { color: "#64748b", marginTop: 2 },

  tag: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  tagOk: { backgroundColor: "#ecfdf5" },
  tagMuted: { backgroundColor: "#f1f5f9" },
  tagText: { fontSize: 10, fontWeight: "800" },
  tagTextOk: { color: "#065f46" },
  tagTextMuted: { color: "#64748b" },
  center: { alignItems: "center", justifyContent: "center" },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#102a43",
    marginBottom: 6,
  },
});