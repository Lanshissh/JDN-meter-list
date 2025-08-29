import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  Share,
} from "react-native";
import axios from "axios";
import { useScanHistory } from "../../contexts/ScanHistoryContext";
import { useAuth } from "../../contexts/AuthContext";
import { useFocusEffect } from "expo-router";
import { BASE_API } from "../../constants/api";

// Some backends return DECIMAL columns as strings.
type Numeric = number | string | null;

type Computation = {
  meter_id: string;
  meter_type: "electric" | "water" | "lpg" | string;
  consumption_latest: Numeric;
  consumption_prev: Numeric;
  change_rate: Numeric; // %
  base_latest: Numeric;
  vat_latest: Numeric;
  bill_latest_total: Numeric;
  base_prev: Numeric;
  vat_prev: Numeric;
  bill_prev_total: Numeric;
  note?: string;
};

type RowState = Computation | { error: string } | undefined;

// ---- helpers ----
const toNum = (x: unknown): number | null => {
  if (x === null || x === undefined) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};
const fmtAmt = (x: unknown) => {
  const n = toNum(x);  
  return n == null
    ? "—"
    : n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
};

const fmtPct = (x: unknown) => {
  const n = toNum(x);
  return n == null ? "—" : `${n.toFixed(1)}%`;
};
const arrow = (x: unknown) => {
  const n = toNum(x);
  return n == null ? "" : n > 0 ? "▲" : n < 0 ? "▼" : "•";
};
const colorForChange = (x: unknown) => {
  const n = toNum(x);
  return n == null ? "#6b7280" : n > 0 ? "#e53935" : n < 0 ? "#2e7d32" : "#6b7280";
};
const unitFor = (t?: string) => {
  const k = (t || "").toLowerCase();
  if (k === "electric") return "kWh";
  if (k === "water") return "m³";
  if (k === "lpg") return "kg";
  return "";
};

type FilterType = "all" | "electric" | "water" | "lpg";
type SortBy = "bill" | "change";

export default function HistoryScreen() {
  const { scans, clearScans } = useScanHistory();
  const { token } = useAuth();

  // meter IDs extracted from scans
  const { meterIds } = useMemo(() => {
    const normToOrig = new Map<string, string>();
    for (const s of scans) {
      const raw = String(s.data || "").trim();
      const mtr = raw.match(/\bMTR-[A-Za-z0-9-]+\b/);
      let candidate = mtr ? mtr[0] : raw.replace(/[\r\n]/g, "");
      if (/^https?:\/\//i.test(candidate)) continue;
      if (!/^[A-Za-z0-9-]{3,}$/.test(candidate)) continue;
      const norm = candidate.toLowerCase();
      if (!normToOrig.has(norm)) normToOrig.set(norm, candidate);
    }
    return { meterIds: Array.from(normToOrig.values()) };
  }, [scans]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Record<string, RowState>>({});
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortBy>("bill");

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: { Authorization: `Bearer ${token ?? ""}` },
        timeout: 15000,
      }),
    [token],
  );

  const loadAll = async () => {
    if (!meterIds.length) {
      setItems({});
      return;
    }
    try {
      setLoading(true);
      const results = await Promise.all(
        meterIds.map(async (originalId) => {
          const norm = originalId.toLowerCase();
          try {
            const res = await api.get<Computation>(
              `/meters/${encodeURIComponent(originalId)}/computation`,
            );
            return [norm, res.data] as const;
          } catch (err: any) {
            const msg =
              err?.response?.data?.error ||
              err?.response?.data?.message ||
              err?.message ||
              "Failed to fetch";
            return [norm, { error: msg }] as const;
          }
        }),
      );
      const map: Record<string, RowState> = {};
      results.forEach(([norm, data]) => (map[norm] = data));
      setItems(map);
    } finally {
      setLoading(false);
    }
  };

  const lastScanTick = scans[0]?.timestamp ?? "";
  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, meterIds.join("|"), lastScanTick]);

  useFocusEffect(
    React.useCallback(() => {
      loadAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [meterIds.join("|")]),
  );

  const isComputation = (v: RowState): v is Computation => !!v && !("error" in v);
  const rows = useMemo(
    () => meterIds.map((idOrig) => ({ idOrig, row: items[idOrig.toLowerCase()] })),
    [meterIds, items],
  );

  // aggregate + filter/sort
  const computedRows = rows.map((r) => r.row).filter(isComputation);
  const totals = useMemo(() => {
    const changeVals = computedRows
      .map((r) => toNum(r.change_rate))
      .filter((v): v is number => v !== null);
    const bill_latest_total = computedRows
      .map((r) => toNum(r.bill_latest_total) ?? 0)
      .reduce((a, b) => a + b, 0);
    const avgChange = changeVals.length
      ? changeVals.reduce((a, b) => a + b, 0) / changeVals.length
      : null;
    const up = changeVals.filter((v) => v > 0).length;
    const down = changeVals.filter((v) => v < 0).length;
    return {
      meters: meterIds.length,
      fetched: computedRows.length,
      avgChange,
      totalLatestBill: bill_latest_total,
      up,
      down,
    };
  }, [computedRows, meterIds.length]);

  const typeTotals = useMemo(() => {
    const seed = { electric: 0, water: 0, lpg: 0 };
    for (const r of computedRows) {
      const t = (r.meter_type || "").toLowerCase() as FilterType;
      if (t === "electric" || t === "water" || t === "lpg") {
        seed[t] += toNum(r.bill_latest_total) ?? 0;
      }
    }
    return seed;
  }, [computedRows]);

  const visible = useMemo(() => {
    const list = rows.filter((r) => isComputation(r.row)) as Array<{
      idOrig: string;
      row: Computation;
    }>;
    const filtered =
      filter === "all"
        ? list
        : list.filter((x) => (x.row.meter_type || "").toLowerCase() === filter);
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "bill") {
        return (toNum(b.row.bill_latest_total) ?? 0) - (toNum(a.row.bill_latest_total) ?? 0);
      }
      return (toNum(b.row.change_rate) ?? -Infinity) - (toNum(a.row.change_rate) ?? -Infinity);
    });
    return sorted;
  }, [rows, filter, sortBy]);

  const topUp = useMemo(
    () =>
      [...computedRows]
        .filter((r) => (toNum(r.change_rate) ?? null) !== null)
        .sort((a, b) => (toNum(b.change_rate)! - toNum(a.change_rate)!))
        .slice(0, 3),
    [computedRows],
  );

  const topDown = useMemo(
    () =>
      [...computedRows]
        .filter((r) => (toNum(r.change_rate) ?? null) !== null)
        .sort((a, b) => (toNum(a.change_rate)! - toNum(b.change_rate)!))
        .slice(0, 3),
    [computedRows],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require("../../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Billing Dashboard</Text>
      </View>

      {/* Summary cards */}
      <View style={styles.grid}>
        <StatCard label="Meters scanned" value={String(totals.meters)} />
        <StatCard label="With data" value={String(totals.fetched)} />
        <StatCard label="Avg change" value={fmtPct(totals.avgChange)} />
        <StatCard label="Total latest bill" value={`₱ ${fmtAmt(totals.totalLatestBill)}`} />
      </View>

      {/* New: type breakdown */}
      <View style={[styles.grid, { marginTop: 8 }]}>
        <StatCard label="Electric total" value={`₱ ${fmtAmt(typeTotals.electric)}`} />
        <StatCard label="Water total" value={`₱ ${fmtAmt(typeTotals.water)}`} />
        <StatCard label="LPG total" value={`₱ ${fmtAmt(typeTotals.lpg)}`} />
      </View>

      {/* Change glance */}
      <View style={[styles.rowCard, { marginTop: 10 }]}>
        <Text style={styles.rowText}>
          ▲ Up: <Text style={{ color: "#e53935", fontWeight: "700" }}>{totals.up}</Text>  •{" "}
          ▼ Down: <Text style={{ color: "#2e7d32", fontWeight: "700" }}>{totals.down}</Text>
        </Text>
      </View>

      {/* New: Controls */}
      <View style={styles.controls}>
        <View style={styles.chips}>
          {(["all", "electric", "water", "lpg"] as FilterType[]).map((k) => (
            <TouchableOpacity
              key={k}
              style={[styles.chip, filter === k && styles.chipActive]}
              onPress={() => setFilter(k)}
            >
              <Text style={[styles.chipText, filter === k && styles.chipTextActive]}>
                {k.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.refreshBtn} onPress={loadAll} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.refreshText}>Refresh</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.refreshBtn, styles.clearBtn]} onPress={clearScans}>
          <Text style={styles.refreshText}>Clear history</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {!meterIds.length ? (
        <Text style={styles.noHistory}>Scan a meter QR to see its billing computation.</Text>
      ) : (
        <FlatList
          style={{ marginTop: 6 }}
          data={visible}
          keyExtractor={(r) => r.idOrig}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} />}
          renderItem={({ item }) => {
            const { idOrig, row } = item;
            const r = row;
            const unit = unitFor(r.meter_type);
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {idOrig} • {r.meter_type?.toUpperCase?.() || "METER"}
                </Text>
                <Text style={styles.kvMuted}>Server meter: {r.meter_id || "—"}</Text>

                {r.note ? (
                  <Text style={styles.cardSub}>{r.note}</Text>
                ) : (
                  <>
                    <View style={styles.split}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kvLabel}>Consumption</Text>
                        <Text style={styles.kvValue}>
                          {fmtAmt(r.consumption_latest)}
                          {unit ? ` ${unit}` : ""}{" "}
                          <Text style={styles.kvMuted}>
                            (prev {fmtAmt(r.consumption_prev)}
                            {unit ? ` ${unit}` : ""})
                          </Text>
                        </Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "flex-end" }}>
                        <Text style={styles.kvLabel}>Change</Text>
                        <Text style={[styles.kvValue, { color: colorForChange(r.change_rate) }]}>
                          {arrow(r.change_rate)} {fmtPct(r.change_rate)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.divider} />

                    <View style={styles.split}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kvLabel}>Base</Text>
                        <Text style={styles.kvValue}>₱ {fmtAmt(r.base_latest)}</Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text style={styles.kvLabel}>VAT</Text>
                        <Text style={styles.kvValue}>₱ {fmtAmt(r.vat_latest)}</Text>
                      </View>
                      <View style={{ flex: 1, alignItems: "flex-end" }}>
                        <Text style={styles.kvLabel}>Total</Text>
                        <Text style={styles.kvValue}>₱ {fmtAmt(r.bill_latest_total)}</Text>
                      </View>
                    </View>

                    {toNum(r.base_prev) !== null && (
                      <>
                        <Text style={[styles.kvLabel, { marginTop: 8 }]}>Previous bill</Text>
                        <Text style={styles.kvMuted}>
                          Base ₱ {fmtAmt(r.base_prev)} • VAT ₱ {fmtAmt(r.vat_prev)} • Total ₱{" "}
                          {fmtAmt(r.bill_prev_total)}
                        </Text>
                      </>
                    )}
                  </>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f9f9f9" },
  header: { flexDirection: "column", alignItems: "center", justifyContent: "center", marginBottom: 12 },
  logo: { height: 30, width: 110, marginTop: 25 },
  title: { textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    flexGrow: 1,
    minWidth: 150,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  statLabel: { fontSize: 12, color: "#6b7280", marginBottom: 4, textTransform: "uppercase" },
  statValue: { fontSize: 18, fontWeight: "800" },

  rowCard: {
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  rowText: { textAlign: "center", fontWeight: "600", color: "#102a43" },

  controls: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  chips: { flexDirection: "row", gap: 8 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#eef2f7",
    borderWidth: 1,
    borderColor: "transparent",
  },
  chipActive: { backgroundColor: "#1f4bd8", borderColor: "#1f4bd8" },
  chipText: { fontWeight: "700", color: "#102a43", fontSize: 12 },
  chipTextActive: { color: "#fff" },

  controlsRight: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  sortBox: { flexDirection: "row", gap: 6 },
  sortBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.15)",
    backgroundColor: "#fff",
  },
  sortBtnActive: { backgroundColor: "#1f4bd8", borderColor: "#1f4bd8" },
  sortText: { fontWeight: "700", color: "#102a43", fontSize: 12 },
  sortTextActive: { color: "#fff" },
  moversWrap: { flexDirection: "row", gap: 10, marginTop: 10, flexWrap: "wrap" },
  moversCard: {
    flexGrow: 1,
    minWidth: 220,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.05)",
  },
  moversTitle: { fontWeight: "800", marginBottom: 8, color: "#102a43" },
  moversRow: { fontSize: 12, marginBottom: 4, color: "#374151" },

  actions: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
    alignSelf: "flex-start",
  },
  refreshBtn: {
    backgroundColor: "#1f4bd8",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearBtn: { backgroundColor: "#6b7280" },
  refreshText: { color: "#fff", fontWeight: "700" },

  noHistory: { marginTop: 10, color: "#6b7280" },

  card: {
    backgroundColor: "#fff",
    padding: 14,
    marginBottom: 10,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },
  cardSub: { color: "#6b7280", marginTop: 4 },

  split: { flexDirection: "row", gap: 12, marginTop: 10 },
  kvLabel: { color: "#6b7280", fontSize: 12, textTransform: "uppercase" },
  kvValue: { fontSize: 16, fontWeight: "800" },
  kvMuted: { color: "#6b7280" },
  divider: {
    height: 1,
    backgroundColor: "rgba(0,0,0,0.06)",
    marginVertical: 8,
  },
});