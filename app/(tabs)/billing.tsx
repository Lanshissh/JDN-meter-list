// app/(tabs)/billing.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import axios from "axios";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

/** ---------------- Types ---------------- */
type Numeric = number | string | null | undefined;

type BillPart = {
  consumption?: number;
  base?: number;
  vat?: number;
};

type PeriodSeg = {
  type: "billable" | "downtime" | string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  reason?: string;
  bill?: BillPart;
};

type BillingApiResponse = {
  meter_id: string | number;
  meter_type: string; // ELECTRIC / WATER / LPG
  periods: PeriodSeg[];
  totals?: {
    base?: number;
    vat?: number;
    amount?: number; // optional alias base + vat
  };
};

/** ---------------- Utilities ---------------- */
const toNumber = (n: Numeric): number => {
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

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** --------------- CSV helpers (Template) --------------- */
const TEMPLATE_HEADERS = [
  "Tenant (Remove Column)",
  "Unit Description",
  "MeterNo",
  "Quantity",
  "Rate",
  "Amount",
];

function csvEscape(v: any): string {
  const s = v == null ? "" : String(v);
  return /[\",\n]/.test(s) ? `"${s.replace(/\"/g, '""')}"` : s;
}
function rowsToCsv(rows: any[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}


// Resolve a writable directory without depending on TS typings.
function resolveWritableDir(): string {
  const fs: any = FileSystem as any;
  return (fs?.cacheDirectory ?? fs?.documentDirectory ?? "") as string;
}


function buildCsvRowsFromPreview(preview: BillingApiResponse) {
  const unitLabel = (preview.meter_type || "").toUpperCase();

  const rows: any[][] = [];
  for (const seg of preview.periods || []) {
    const qty = toNumber(seg.bill?.consumption) || 0;
    const base = toNumber(seg.bill?.base) || 0;
    const vat = toNumber(seg.bill?.vat) || 0;
    const amount = base + vat;
    const rate = qty > 0 ? base / qty : 0;

    const unitDesc =
      seg.type === "billable"
        ? `${unitLabel} ${seg.start}–${seg.end}`
        : `DOWNTIME ${seg.start}–${seg.end}${seg.reason ? ` (${seg.reason})` : ""}`;

    rows.push([
      "", // Tenant (Remove Column)
      unitDesc,
      preview.meter_id,
      qty,
      rate,
      amount,
    ]);
  }
  return rows;
}

async function exportCsv(preview: BillingApiResponse, endDate: string) {
  const rows = buildCsvRowsFromPreview(preview);
  const csv = rowsToCsv([TEMPLATE_HEADERS, ...rows]);
  const filename = `Charges_${preview.meter_id}_${endDate}.csv`;

  // Web: download via Blob
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }

  // Native: write to cacheDirectory (always available) and share
  const dir = resolveWritableDir();
  const path = dir + filename;
  await FileSystem.writeAsStringAsync(path, csv); // default encoding is UTF-8
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path);
  }
}

/** ---------------- Screen ---------------- */
export default function BillingScreen() {
  const { token } = useAuth();
  const [meterId, setMeterId] = useState<string>("");
  const [endDate, setEndDate] = useState<string>(ymd(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BillingApiResponse | null>(null);

  const isValidMeter = meterId.trim().length > 0;
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(endDate);

  const fetchPreview = useCallback(async () => {
    if (!isValidMeter || !isValidDate) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${BASE_API}/billings/meters/${encodeURIComponent(
        meterId.trim()
      )}/period-end/${endDate}`;
      const resp = await axios.get(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      setData(resp.data as BillingApiResponse);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [meterId, endDate, token, isValidMeter, isValidDate]);

  const totals = useMemo(() => {
    if (!data) return { base: 0, vat: 0, amount: 0 };
    // prefer server totals, otherwise compute
    const t = data.totals ?? {};
    const base = toNumber(t.base);
    const vat = toNumber(t.vat);
    const amount = toNumber(t.amount) || base + vat;
    return { base, vat, amount };
  }, [data]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Billing Preview</Text>

        {/* Inputs */}
        <View style={styles.row}>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Text style={styles.label}>Meter ID</Text>
            <TextInput
              value={meterId}
              onChangeText={setMeterId}
              placeholder="Enter meter id"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
          </View>
          <View style={[styles.inputWrap, { flex: 1 }]}>
            <Text style={styles.label}>Period-end (YYYY-MM-DD)</Text>
            <TextInput
              value={endDate}
              onChangeText={setEndDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={fetchPreview}
            style={[styles.btn, (!isValidMeter || !isValidDate) && styles.btnDisabled]}
            disabled={!isValidMeter || !isValidDate || loading}
          >
            <Text style={styles.btnText}>{loading ? "Loading..." : "Load Preview"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => data && exportCsv(data, endDate)}
            style={[styles.btn, (!data || loading) && styles.btnDisabled]}
            disabled={!data || loading}
          >
            <Text style={styles.btnText}>Export CSV</Text>
          </TouchableOpacity>
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorBadge}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Totals */}
        {data ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {String(data.meter_type || "").toUpperCase()} · Meter {String(data.meter_id)}
            </Text>
            <View style={styles.kvs}>
              <View style={styles.kv}>
                <Text style={styles.k}>Base</Text>
                <Text style={styles.v}>{fmt(totals.base)}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>VAT</Text>
                <Text style={styles.v}>{fmt(totals.vat)}</Text>
              </View>
              <View style={styles.kv}>
                <Text style={styles.k}>Amount</Text>
                <Text style={styles.v}>{fmt(totals.amount)}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Segments */}
        {data ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Periods</Text>
            {(data.periods || []).map((seg, idx) => {
              const qty = toNumber(seg.bill?.consumption) || 0;
              const base = toNumber(seg.bill?.base) || 0;
              const vat = toNumber(seg.bill?.vat) || 0;
              const total = base + vat;
              return (
                <View key={idx} style={styles.seg}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.segTitle}>
                      {seg.type === "billable" ? "Billable" : "Downtime"} • {seg.start}–{seg.end}
                    </Text>
                    {seg.reason ? (
                      <Text style={styles.segReason}>Reason: {seg.reason}</Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.segLine}>Qty: {fmt(qty, false)}</Text>
                    <Text style={styles.segLine}>Base: {fmt(base)}</Text>
                    <Text style={styles.segLine}>VAT: {fmt(vat)}</Text>
                    <Text style={[styles.segLine, styles.segTotal]}>
                      Total: {fmt(total)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Loader */}
        {loading ? (
          <View style={{ paddingTop: 16, alignItems: "center" }}>
            <ActivityIndicator />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** ---------------- Styles ---------------- */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f8fafc" },
  container: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  row: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  inputWrap: { flexBasis: 180, flexGrow: 1 },
  label: { fontSize: 12, color: "#6b7280", marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    color: "#0f172a",
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  btn: {
    backgroundColor: "#111827",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "600" },
  errorBadge: {
    backgroundColor: "#fee2e2",
    borderColor: "#fecaca",
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
  },
  errorText: { color: "#991b1b" },
  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eef2f7",
    borderRadius: 14,
    padding: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, color: "#0f172a" },
  kvs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
  seg: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingVertical: 10,
  },
  segTitle: { fontSize: 14, fontWeight: "600", color: "#111827" },
  segReason: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  segLine: { fontSize: 12, color: "#0f172a" },
  segTotal: { fontWeight: "bold" },
});