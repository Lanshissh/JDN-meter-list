// app/(tabs)/billing.tsx
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

// ---------- Types & helpers ----------
type Numeric = number | string | null;

type MeterPreview = {
  meter_id?: string;
  tenant_id?: string;
  meter_type?: string;
  base_latest?: Numeric;
  vat_latest?: Numeric;
  bill_latest_total?: Numeric;
  base_prev?: Numeric;
  vat_prev?: Numeric;
  bill_prev_total?: Numeric;
  consumption_prev?: Numeric;
  consumption_latest?: Numeric;
  change_rate?: Numeric;
  [k: string]: any;
};

type TenantPreview = {
  tenant_id?: string;
  tenant_name?: string;
  /** computed from payload.totals.bill_latest_total */
  total_latest?: Numeric;
  /** computed from sum(payload.meters[].bill_prev_total) */
  total_prev?: Numeric;
  /** computed from avg(payload.meters[].change_rate) */
  avg_change_rate?: Numeric;
  meters?: any[];
  [k: string]: any;
};

// Normalize any API/axios error into a readable string
const errorToText = (err: any): string => {
  if (!err) return "Failed to load billing preview.";
  const data = err?.response?.data;

  const candidates = [data?.error, data?.message, err?.message];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") return c;
    if (typeof c === "object" && typeof c.message === "string") return c.message;
  }
  if (typeof data === "string") return data;
  try { return JSON.stringify(data || err); } catch { return "Failed to load billing preview."; }
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
    ? Intl.NumberFormat(undefined, { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(v)
    : Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v);
};

const pct = (n: Numeric | undefined) =>
  `${Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(toNumber(n))}%`;

// Try a list of URLs in order until one succeeds.
// Continues on 404 (route missing), throws on 401/403, network, or other fatal errors.
async function getFirstOK(urls: string[], headers: any) {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers });
      return { data: res.data, url };
    } catch (e: any) {
      lastErr = e;
      const status = e?.response?.status;
      if (status === 404) continue;
      if (status === 401 || status === 403) throw e;
      if (status == null) throw e;
      throw e;
    }
  }
  throw lastErr || new Error("Not found");
}

export default function BillingScreen() {
  const { token } = useAuth();
  const authHeader = useMemo(
    () => ({ Authorization: token ? `Bearer ${token}` : "" }),
    [token]
  );

  // "meter" = single meter preview; "tenant" = tenant aggregate (accepts TEN-* or MTR-*)
  const [mode, setMode] = useState<"meter" | "tenant">("meter");
  const [inputId, setInputId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meterData, setMeterData] = useState<MeterPreview | null>(null);
  const [tenantData, setTenantData] = useState<TenantPreview | null>(null);

  const { scans } = useScanHistory();

  // Newest scan first
  const lastScannedCandidate = useMemo(() => {
    for (let i = 0; i < scans.length; i++) {
      const raw = String((scans[i] as any)?.data || "").trim();
      if (!raw) continue;
      if (/^https?:\/\//i.test(raw)) continue;
      const m = raw.match(/\bMTR-[A-Za-z0-9-]+\b/i);
      if (m) return m[0].toUpperCase();
      const t = raw.match(/\bTEN-[A-Za-z0-9-]+\b/i);
      if (t) return t[0].toUpperCase();
      const candidate = raw.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
      if (candidate.length >= 3) return candidate;
    }
    return "";
  }, [scans]);

  // Always sync input to latest scan when screen regains focus
  useFocusEffect(
    useCallback(() => {
      if (lastScannedCandidate) setInputId(lastScannedCandidate);
    }, [lastScannedCandidate])
  );

  // Preview logic (auto, debounced)
  const lastKeyRef = useRef<string>("");

  const onPreview = useCallback(async () => {
    const raw = inputId.trim();
    if (!raw) {
      setMeterData(null);
      setTenantData(null);
      setError(null);
      return;
    }

    const id = raw.toUpperCase();

    setLoading(true);
    setError(null);
    setMeterData(null);
    setTenantData(null);

    try {
      if (mode === "meter") {
        // BACKEND: /billings/meters/:meter_id  (no /preview) :contentReference[oaicite:1]{index=1}
        const urls = [
          `${BASE_API}/billings/meters/${encodeURIComponent(id)}`,
          // optional fallbacks if your server mounts differently:
          `${BASE_API}/billing/meters/${encodeURIComponent(id)}`,
          `${BASE_API}/billings/meter/${encodeURIComponent(id)}`,
          `${BASE_API}/billing/meter/${encodeURIComponent(id)}`,
          `${BASE_API}/billings/meters/${encodeURIComponent(id)}/`, // trailing slash variant
        ];
        const { data } = await getFirstOK(urls, authHeader);
        setMeterData(data as MeterPreview);
      } else {
        // Tenant aggregate: accepts TEN-* or MTR-*; resolve MTR -> TEN first via meter endpoint
        const isMeterId = /^MTR-[A-Za-z0-9-]+$/i.test(id);
        let tenantId = id;

        if (isMeterId) {
          const mUrls = [
            `${BASE_API}/billings/meters/${encodeURIComponent(id)}`,
            `${BASE_API}/billing/meters/${encodeURIComponent(id)}`,
            `${BASE_API}/billings/meter/${encodeURIComponent(id)}`,
            `${BASE_API}/billing/meter/${encodeURIComponent(id)}`,
            `${BASE_API}/billings/meters/${encodeURIComponent(id)}/`,
          ];
          const { data: meter } = await getFirstOK(mUrls, authHeader);
          const resolved = String((meter as MeterPreview)?.tenant_id || "");
          if (!resolved) throw new Error("This meter is not linked to any tenant.");
          tenantId = resolved.toUpperCase();
        }

        // BACKEND: /billings/tenants/:tenant_id/  (trailing slash) :contentReference[oaicite:2]{index=2}
        const tUrls = [
          `${BASE_API}/billings/tenants/${encodeURIComponent(tenantId)}/`,
          // fallbacks
          `${BASE_API}/billings/tenants/${encodeURIComponent(tenantId)}`,
          `${BASE_API}/billing/tenants/${encodeURIComponent(tenantId)}/`,
          `${BASE_API}/billing/tenants/${encodeURIComponent(tenantId)}`,
          `${BASE_API}/billings/tenant/${encodeURIComponent(tenantId)}/`,
          `${BASE_API}/billing/tenant/${encodeURIComponent(tenantId)}/`,
        ];
        const { data: payload } = await getFirstOK(tUrls, authHeader);

        const meters = Array.isArray(payload?.meters) ? payload.meters : [];
        const totalLatest = Number(payload?.totals?.bill_latest_total) || 0;
        const totalPrev = meters.reduce(
          (s: number, m: any) => s + (Number(m?.bill_prev_total) || 0),
          0
        );
        const changeVals = meters
          .map((m: any) => (m?.change_rate == null ? null : Number(m.change_rate)))
          .filter((v: number | null) => v !== null && Number.isFinite(v)) as number[];
        const avgChange = changeVals.length
          ? changeVals.reduce((a, b) => a + b, 0) / changeVals.length
          : 0;

        const shaped: TenantPreview = {
          tenant_id: payload?.tenant_id ?? tenantId,
          tenant_name: payload?.tenant_name ?? "",
          total_latest: totalLatest,
          total_prev: totalPrev,
          avg_change_rate: avgChange,
          meters,
        };

        setTenantData(shaped);
      }
    } catch (err: any) {
      setError(errorToText(err));
    } finally {
      setLoading(false);
    }
  }, [inputId, mode, authHeader]);

  useEffect(() => {
    const id = inputId.trim();
    if (!id) {
      lastKeyRef.current = "";
      return;
    }
    const key = `${mode}|${id}`;
    if (lastKeyRef.current === key) return;
    const t = setTimeout(() => {
      lastKeyRef.current = key;
      onPreview();
    }, 350);
    return () => clearTimeout(t);
  }, [inputId, mode, onPreview]);

  // UI helpers
  const applyLastScan = () => {
    if (lastScannedCandidate) setInputId(lastScannedCandidate);
  };
  const clearInput = () => {
    setInputId("");
    setMeterData(null);
    setTenantData(null);
    setError(null);
  };

  // ---------- Render ----------
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={{ gap: 2 }}>
          {/* Brand header — keep your logo */}
          <View style={[styles.brandHeader, Platform.OS === "web" && { alignItems: "flex-start", marginTop: -30 }]}>
            <Image
              source={require("../../assets/images/logo.png")}
              style={styles.brandLogo}
              resizeMode="contain"
            />
          </View>

          {/* Segmented control */}
          <View style={styles.segment}>
            <TouchableOpacity
              onPress={() => setMode("meter")}
              style={[styles.segmentBtn, mode === "meter" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, mode === "meter" && styles.segmentTextActive]}>
                Meter Preview
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode("tenant")}
              style={[styles.segmentBtn, mode === "tenant" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, mode === "tenant" && styles.segmentTextActive]}>
                Tenant Aggregate
              </Text>
            </TouchableOpacity>
          </View>

          {/* Search card */}
          <View style={styles.card}>
            <Text style={styles.label}>
              {mode === "meter" ? "Meter ID" : "Tenant ID or Meter ID"}
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                value={inputId}
                onChangeText={setInputId}
                placeholder={mode === "meter" ? "e.g. MTR-1" : "e.g. TEN-1 or MTR-1"}
                placeholderTextColor="#8A8F98"
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.input}
              />
              {inputId?.length > 0 ? (
                <TouchableOpacity onPress={clearInput} style={styles.pillBtn}>
                  <Text style={styles.pillText}>Clear</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={applyLastScan} style={styles.pillBtn}>
                  <Text style={styles.pillText}>Use last scan</Text>
                </TouchableOpacity>
              )}
            </View>

            {!!error && (
              <View style={[styles.badge, styles.badgeError]}>
                <Text style={styles.badgeText}>{error}</Text>
              </View>
            )}
          </View>

          {/* Loading state */}
          {loading && (
            <View style={styles.card}>
              <View style={[styles.center, { paddingVertical: 16 }]}>
                <ActivityIndicator size="large" />
                <Text style={styles.muted}>Computing…</Text>
              </View>
            </View>
          )}

          {/* Meter preview */}
          {!loading && !error && mode === "meter" && meterData && (
            <View style={styles.card}>
              <Text style={styles.title}>Meter {meterData.meter_id}</Text>
              <View style={styles.kv}>
                <Text style={styles.k}>Type</Text>
                <Text style={styles.v}>{String(meterData.meter_type || "").toUpperCase()}</Text>
              </View>
              {meterData.tenant_id ? (
                <View style={styles.kv}>
                  <Text style={styles.k}>Tenant</Text>
                  <Text style={styles.v}>{meterData.tenant_id}</Text>
                </View>
              ) : null}
              <View style={styles.divider} />
              <View style={styles.grid2}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Latest bill</Text>
                  <Text style={styles.statValue}>{fmt(meterData.bill_latest_total)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Prev bill</Text>
                  <Text style={styles.statValue}>{fmt(meterData.bill_prev_total)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Latest kWh/m³</Text>
                  <Text style={styles.statValue}>{fmt(meterData.consumption_latest, false)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Prev kWh/m³</Text>
                  <Text style={styles.statValue}>{fmt(meterData.consumption_prev, false)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Change</Text>
                  <Text style={[styles.statValue, { fontVariant: ["tabular-nums"] }]}>
                    {pct(meterData.change_rate)}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Tenant aggregate */}
          {!loading && !error && mode === "tenant" && tenantData && (
            <View style={styles.card}>
              <Text style={styles.title}>Tenant {tenantData.tenant_id}</Text>
              {!!tenantData.tenant_name && (
                <Text style={styles.muted}>{tenantData.tenant_name}</Text>
              )}
              <View style={styles.divider} />
              <View style={styles.grid2}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Aggregate (latest)</Text>
                  <Text style={styles.statValue}>{fmt(tenantData.total_latest)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Aggregate (prev)</Text>
                  <Text style={styles.statValue}>{fmt(tenantData.total_prev)}</Text>
                </View>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>Average change</Text>
                  <Text style={[styles.statValue, { fontVariant: ["tabular-nums"] }]}>
                    {pct(tenantData.avg_change_rate)}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Empty hint */}
          {!loading && !error && !meterData && !tenantData && inputId.trim().length === 0 && (
            <View style={[styles.card, styles.center]}>
              <Text style={styles.muted}>Enter an ID or use your last scan to preview billing.</Text>
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

  // Brand header
  brandHeader: {
    alignItems: "center",
  },
  brandLogo: {
    height: 100,
    width: 100,
  },

  // Segmented control
  segment: {
    flexDirection: "row",
    backgroundColor: "#E9EDF5",
    borderRadius: 18,
    padding: 6,
    marginTop: -10,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    ...Platform.select({ android: { elevation: 1 } }),
  },
  segmentText: {
    fontSize: 14,
    color: "#5A6473",
    fontWeight: "600",
  },
  segmentTextActive: {
    color: "#11181C",
  },

  // Card
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    ...Platform.select({ android: { elevation: 1 } }),
  },

  // Inputs
  label: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 8,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#DDE3EA",
    backgroundColor: "#FBFCFE",
    color: "#11181C",
  },
  pillBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "#11181C",
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  // Messages
  badge: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  badgeError: {
    backgroundColor: "#FEE2E2",
  },
  badgeText: {
    color: "#7F1D1D",
    fontWeight: "600",
  },

  // Key-value
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 2,
  },
  k: { color: "#6B7280" },
  v: { color: "#11181C", fontWeight: "600" },

  // Layout bits
  divider: {
    height: 1,
    backgroundColor: "#EEF2F7",
    marginVertical: 10,
  },
  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  stat: {
    width: "48%",
    marginBottom: 6,
  },
  statLabel: {
    fontSize: 12,
    color: "#6B7280",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#11181C",
  },

  // misc
  center: { alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "700", marginBottom: 2, color: "#11181C" },
  muted: { color: "#6B7280" },
});