import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  Pressable,
  useWindowDimensions,
  ScrollView,
  Animated,
} from "react-native";
import axios, { AxiosError } from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { Picker } from "@react-native-picker/picker";

import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import { useScanHistory } from "../../contexts/ScanHistoryContext";

type CountKey =
  | "buildings"
  | "tenants"
  | "stalls"
  | "meters"
  | "readings"
  | "offlineQueue"
  | "offlinePackage";

type Role = "admin" | "operator" | "biller" | "reader" | "unknown";
type Counts = Partial<Record<CountKey, number>>;

type TileState = {
  label: string;
  key: CountKey;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  restricted?: boolean;
};

type Building = { building_id: string; building_name: string };

const KEY_OFFLINE_PACKAGE = "offline_package_v1";
const KEY_DASHBOARD_BUILDING_FILTER = "dashboard_building_filter_v1";

const norm = (v: any) => String(v ?? "").trim().toLowerCase();

const safeAtob = (b64: string): string | null => {
  try {
    if (typeof globalThis.atob === "function") return globalThis.atob(b64);
  } catch {}
  try {
    if (typeof Buffer !== "undefined")
      return Buffer.from(b64, "base64").toString("utf8");
  } catch {}
  return null;
};

function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const raw = token.trim().replace(/^Bearer\s+/i, "");
    const part = raw.split(".")[1];
    if (!part) return null;

    let base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const mod = base64.length % 4;
    if (mod) base64 += "=".repeat(4 - mod);

    const json = safeAtob(base64);
    if (!json) return null;

    return JSON.parse(json);
  } catch {
    return null;
  }
}

function decodeRole(token: string | null): {
  role: Role;
  buildingIds: string[];
} {
  const payload = decodeJwtPayload(token);
  if (!payload) return { role: "unknown", buildingIds: [] };

  const rolesArr: string[] = Array.isArray(payload.user_roles)
    ? payload.user_roles
    : [];
  const roles = rolesArr.map(norm);

  let role: Role = (norm(payload.user_level || payload.role) as Role) || "unknown";

  if (roles.includes("admin")) role = "admin";
  else if (roles.includes("operator")) role = "operator";
  else if (roles.includes("biller")) role = "biller";
  else if (roles.includes("reader")) role = "reader";
  else role = "unknown";

  // Support multiple token shapes
  const bIds: string[] = Array.isArray(payload.building_ids)
    ? payload.building_ids.map((x: any) => String(x)).filter(Boolean)
    : payload.building_id
      ? [String(payload.building_id)]
      : payload.buildingId
        ? [String(payload.buildingId)]
        : [];

  return { role, buildingIds: Array.from(new Set(bIds)) };
}

function makeApi(token: string | null) {
  const api = axios.create({ baseURL: BASE_API, timeout: 15000 });
  api.interceptors.request.use((cfg) => {
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
  });
  return api;
}

/**
 * ✅ Robust count extractor:
 * supports: [], {rows:[]}, {data:[]}, {items:[]}, {tenants:[]}, {meters:[]}, {count:n}
 */
function extractCountFromResponse(path: string, data: any): number {
  if (Array.isArray(data)) return data.length;

  if (typeof data?.count === "number" && Number.isFinite(data.count)) return data.count;

  const candidates: any[] = [data?.rows, data?.data, data?.items, data?.result];
  for (const c of candidates) if (Array.isArray(c)) return c.length;

  const seg =
    String(path || "").split("?")[0].split("/").filter(Boolean).pop() || "";
  const key = seg.toLowerCase();

  const keyed = [
    data?.[key],
    key === "readings" ? data?.meter_readings : undefined,
    key === "readings" ? data?.readings : undefined,
  ];
  for (const c of keyed) if (Array.isArray(c)) return c.length;

  return 0;
}

/**
 * ✅ safeCount that can try building filter and fall back if backend doesn't support it.
 */
async function safeCount(
  api: ReturnType<typeof makeApi>,
  path: string,
  buildingId?: string,
): Promise<{ count?: number; restricted?: boolean }> {
  const withFilter =
    buildingId && buildingId !== "all"
      ? `${path}${path.includes("?") ? "&" : "?"}building_id=${encodeURIComponent(buildingId)}`
      : path;

  const tryGet = async (p: string) => {
    const res = await api.get(p);
    return { count: extractCountFromResponse(p, res.data) };
  };

  try {
    return await tryGet(withFilter);
  } catch (e) {
    const err = e as AxiosError;
    const status = err?.response?.status;

    if (status === 401 || status === 403) return { restricted: true };

    // If backend rejects unknown query param, retry without filter
    if (status === 400 && withFilter !== path) {
      try {
        return await tryGet(path);
      } catch (e2) {
        const err2 = e2 as AxiosError;
        if (err2?.response?.status === 401 || err2?.response?.status === 403)
          return { restricted: true };
        return { count: 0 };
      }
    }

    return { count: 0 };
  }
}

function MetricCard({
  tile,
  count,
  isRestricted,
  onPress,
  subtext,
}: {
  tile: TileState;
  count: number;
  isRestricted: boolean;
  onPress: () => void;
  subtext?: string;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.98, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={() => !isRestricted && onPress()}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isRestricted}
    >
      <Animated.View style={[styles.metricCard, { transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.metricHeader}>
          <View style={[styles.iconContainer, { backgroundColor: tile.color + "15" }]}>
            <Ionicons name={tile.icon} size={28} color={tile.color} />
          </View>

          {!isRestricted && (
            <View style={styles.statusBadge}>
              <View style={[styles.statusDot, { backgroundColor: "#10b981" }]} />
              <Text style={styles.statusText}>Active</Text>
            </View>
          )}
        </View>

        <View style={styles.metricBody}>
          <Text style={styles.metricLabel}>{tile.label}</Text>
          <Text style={styles.metricValue}>{isRestricted ? "—" : count.toLocaleString()}</Text>
          <Text style={styles.metricSubtext}>
            {isRestricted ? "Access restricted" : subtext || "Total entries"}
          </Text>
        </View>

        {!isRestricted && (
          <View style={styles.metricFooter}>
            <Text style={[styles.viewDetailsText, { color: tile.color }]}>View Details</Text>
            <Ionicons name="arrow-forward" size={16} color={tile.color} />
          </View>
        )}

        {isRestricted && (
          <View style={styles.restrictedOverlay}>
            <Ionicons name="lock-closed" size={16} color="#94a3b8" />
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

function QuickActionButton({
  icon,
  label,
  onPress,
  variant = "secondary",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";
  return (
    <TouchableOpacity
      style={[styles.actionButton, isPrimary && styles.actionButtonPrimary]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.actionIcon, isPrimary && styles.actionIconPrimary]}>
        <Ionicons name={icon} size={20} color={isPrimary ? "#ffffff" : "#64748b"} />
      </View>
      <Text style={[styles.actionLabel, isPrimary && styles.actionLabelPrimary]}>
        {label}
      </Text>
      {isPrimary && <Ionicons name="chevron-forward" size={16} color="#ffffff" />}
    </TouchableOpacity>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const { token } = useAuth();
  const { scans, isConnected } = useScanHistory();

  const { width } = useWindowDimensions();
  const { role, buildingIds } = useMemo(() => decodeRole(token), [token]);

  const api = useMemo(() => makeApi(token), [token]);

  const [busy, setBusy] = useState(true);
  const [counts, setCounts] = useState<Counts>({});
  const [restrictions, setRestrictions] = useState<Record<CountKey, boolean>>({
    buildings: false,
    tenants: false,
    stalls: false,
    meters: false,
    readings: false,
    offlineQueue: false,
    offlinePackage: false,
  });

  // Building filter state
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingFilter, setBuildingFilter] = useState<string>("all");

  const [offlinePackageCount, setOfflinePackageCount] = useState(0);
  const [offlineMetersCount, setOfflineMetersCount] = useState(0);
  const [offlineTenantsCount, setOfflineTenantsCount] = useState(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const isMobile = width < 768;
  const containerWidth = Platform.OS === "web" ? Math.min(width - 48, 1400) : width - 32;

  const wantedTiles: TileState[] = useMemo(() => {
    const base: TileState[] = [
      { key: "buildings", label: "Buildings", color: "#3b82f6", icon: "business" },
      { key: "tenants", label: "Tenants", color: "#8b5cf6", icon: "people" },
      { key: "stalls", label: "Stalls", color: "#ec4899", icon: "storefront" },
      { key: "meters", label: "Meters", color: "#06b6d4", icon: "speedometer" },
      { key: "readings", label: "Readings", color: "#10b981", icon: "document-text" },
    ];

    if (role === "reader") {
      return [
        { key: "tenants", label: "Tenants", color: "#8b5cf6", icon: "people" },
        { key: "meters", label: "Meters", color: "#06b6d4", icon: "speedometer" },
        { key: "offlineQueue", label: "Pending Sync", color: "#f59e0b", icon: "cloud-upload" },
        { key: "offlinePackage", label: "Offline Package", color: "#0ea5e9", icon: "download" },
      ];
    }

    if (role === "admin") return base;
    if (role === "operator")
      return base.filter((t) => ["tenants", "stalls", "meters", "readings"].includes(t.key));
    if (role === "biller") return base.filter((t) => ["tenants", "readings"].includes(t.key));
    return base;
  }, [role]);

  const loadOfflinePackageStats = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY_OFFLINE_PACKAGE);
      if (!raw) {
        setOfflinePackageCount(0);
        setOfflineMetersCount(0);
        setOfflineTenantsCount(0);
        return { packageCount: 0, metersCount: 0, tenantsCount: 0 };
      }

      const parsed = JSON.parse(raw);
      const items =
        Array.isArray(parsed?.package?.items) ? parsed.package.items :
        Array.isArray(parsed?.items) ? parsed.items :
        Array.isArray(parsed) ? parsed :
        null;

      if (!items) {
        setOfflinePackageCount(1);
        setOfflineMetersCount(0);
        setOfflineTenantsCount(0);
        return { packageCount: 1, metersCount: 0, tenantsCount: 0 };
      }

      const metersCount = items.length;
      const tenantSet = new Set<string>();
      for (const it of items) {
        const name = String(it?.tenant_name ?? "").trim();
        if (name) tenantSet.add(name);
      }
      const tenantsCount = tenantSet.size;

      setOfflinePackageCount(items.length);
      setOfflineMetersCount(metersCount);
      setOfflineTenantsCount(tenantsCount);

      return { packageCount: items.length, metersCount, tenantsCount };
    } catch {
      setOfflinePackageCount(0);
      setOfflineMetersCount(0);
      setOfflineTenantsCount(0);
      return { packageCount: 0, metersCount: 0, tenantsCount: 0 };
    }
  }, []);

  // Load + scope buildings and restore last filter
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!token || role === "reader") return;

      try {
        const [bRes, saved] = await Promise.all([
          api.get<Building[]>("/buildings"),
          AsyncStorage.getItem(KEY_DASHBOARD_BUILDING_FILTER),
        ]);

        if (!alive) return;

        const list = Array.isArray(bRes.data) ? bRes.data : [];

        // Scope: admin sees all, others only token buildingIds if present
        const scoped =
          role === "admin" || buildingIds.length === 0
            ? list
            : list.filter((b) => buildingIds.includes(String(b.building_id)));

        setBuildings(scoped);

        // Pick default filter
        const savedId = (saved || "").trim();
        const canUseSaved =
          savedId === "all" ||
          scoped.some((b) => String(b.building_id) === savedId);

        if (canUseSaved) {
          setBuildingFilter(savedId || "all");
        } else if (role !== "admin" && scoped.length === 1) {
          setBuildingFilter(String(scoped[0].building_id));
        } else {
          setBuildingFilter("all");
        }
      } catch {
        // If buildings load fails, keep filter as-is; counts still work (unfiltered)
      }
    })();

    return () => {
      alive = false;
    };
  }, [token, role, api, buildingIds]);

  // Persist building filter
  useEffect(() => {
    if (role === "reader") return;
    AsyncStorage.setItem(KEY_DASHBOARD_BUILDING_FILTER, buildingFilter).catch(() => {});
  }, [buildingFilter, role]);

  useFocusEffect(
    useCallback(() => {
      loadOfflinePackageStats();
    }, [loadOfflinePackageStats]),
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!token) {
        setBusy(false);
        return;
      }

      // Reader stays local/offline (no building filter)
      if (role === "reader") {
        const stats = await loadOfflinePackageStats();
        const pending = scans.filter((s) => s.status === "pending" || s.status === "failed").length;

        const nextCounts: Counts = {
          tenants: stats.tenantsCount,
          meters: stats.metersCount,
          offlineQueue: pending,
          offlinePackage: stats.packageCount,
        };

        if (!alive) return;

        setCounts(nextCounts);
        setRestrictions((prev) => ({
          ...prev,
          tenants: false,
          meters: false,
          offlineQueue: false,
          offlinePackage: false,
        }));
        setBusy(false);
        return;
      }

      setBusy(true);

      const nextCounts: Counts = {};
      const nextRestr: Record<CountKey, boolean> = {
        buildings: false,
        tenants: false,
        stalls: false,
        meters: false,
        readings: false,
        offlineQueue: false,
        offlinePackage: false,
      };

      await Promise.all(
        wantedTiles.map(async (t) => {
          const path = `/${t.key}`;
          const shouldFilter =
            t.key !== "buildings" &&
            t.key !== "offlinePackage" &&
            t.key !== "offlineQueue";

          const { count, restricted } = await safeCount(
            api,
            path,
            shouldFilter ? buildingFilter : undefined,
          );

          if (!alive) return;

          if (typeof count === "number") nextCounts[t.key] = count;
          if (restricted) nextRestr[t.key] = true;
        }),
      );

      if (!alive) return;

      setCounts(nextCounts);
      setRestrictions(nextRestr);
      setBusy(false);
    })();

    return () => {
      alive = false;
    };
  }, [token, role, api, scans, loadOfflinePackageStats, wantedTiles, buildingFilter]);

  const openPanel = (key: CountKey) => {
    if (role === "reader") {
      router.push("/(tabs)/scanner");
      return;
    }
    router.push({ pathname: "/(tabs)/admin", params: { panel: key } } as any);
  };

  const getRoleDisplay = () => {
    const roleMap: Record<Role, string> = {
      admin: "Administrator",
      operator: "Operator",
      biller: "Biller",
      reader: "Reader",
      unknown: "User",
    };
    return roleMap[role] || "User";
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  const totalRecords = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  const liveLabel = role === "reader" ? (isConnected ? "Online" : "Offline") : "Live";

  const filterLabel =
    buildingFilter === "all"
      ? "All Buildings"
      : buildings.find((b) => String(b.building_id) === buildingFilter)?.building_name ||
        buildingFilter;

  const tileSubtext = (tileKey: CountKey) => {
    if (role === "reader") {
      if (tileKey === "offlineQueue") return "Queued readings";
      if (tileKey === "offlinePackage") return "Packaged meters";
      if (tileKey === "tenants") return "Tenants in package";
      if (tileKey === "meters") return "Meters in package";
      return "Local records";
    }

    if (tileKey === "buildings") return "Total entries";
    return `Filtered: ${filterLabel}`;
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
          <View style={[styles.header, { width: containerWidth }]}>
            <View style={styles.headerTop}>
              <View>
                <Text style={styles.greeting}>{getGreeting()}</Text>
                <Text style={styles.title}>JDN Meter & Billing</Text>
              </View>
              <View style={styles.roleBadge}>
                <View style={styles.roleIndicator} />
                <Text style={styles.roleText}>{getRoleDisplay()}</Text>
              </View>
            </View>

            <Text style={styles.subtitle}>
              Real-time metering analytics and billing automation platform
            </Text>

            {/* ✅ Building filter (non-reader only) */}
            {role !== "reader" ? (
              <View style={styles.filterRow}>
                <View style={styles.filterIcon}>
                  <Ionicons name="business-outline" size={18} color="#334155" />
                </View>
                <View style={styles.filterPickerShell}>
                  <Picker
                    selectedValue={buildingFilter}
                    onValueChange={(v) => setBuildingFilter(String(v))}
                    mode={Platform.OS === "android" ? "dropdown" : undefined}
                    style={styles.filterPicker}
                    dropdownIconColor="#334155"
                  >
                    <Picker.Item label="All Buildings" value="all" />
                    {buildings.map((b) => (
                      <Picker.Item
                        key={String(b.building_id)}
                        label={b.building_name || String(b.building_id)}
                        value={String(b.building_id)}
                      />
                    ))}
                  </Picker>
                </View>
              </View>
            ) : null}

            <View style={[styles.statsRow, isMobile && styles.statsRowMobile]}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{totalRecords}</Text>
                <Text style={styles.statLabel}>
                  {role === "reader" ? "Local Records" : "Total Records"}
                </Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={styles.statBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.statBadgeText}>{liveLabel}</Text>
                </View>
                <Text style={styles.statLabel}>
                  {role === "reader" ? "Connection Status" : "System Status"}
                </Text>
              </View>
            </View>

            <View style={[styles.quickActions, isMobile && styles.quickActionsMobile]}>
              <QuickActionButton
                icon="scan-outline"
                label="Quick Scan"
                onPress={() => router.push("/(tabs)/scanner")}
                variant="primary"
              />

              {role !== "reader" ? (
                <>
                  <QuickActionButton
                    icon="wallet-outline"
                    label="Billing"
                    onPress={() => router.push("/(tabs)/billing")}
                  />
                  <QuickActionButton
                    icon="person-circle"
                    label="Admin"
                    onPress={() => openPanel(wantedTiles[0]?.key || "tenants")}
                  />
                </>
              ) : (
                <QuickActionButton
                  icon="cloud-upload-outline"
                  label="Sync / Queue"
                  onPress={() => router.push("/(tabs)/scanner")}
                />
              )}
            </View>
          </View>

          {busy ? (
            <View style={[styles.loadingContainer, { width: containerWidth }]}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.loadingText}>Loading dashboard...</Text>
            </View>
          ) : (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Overview</Text>
                <Text style={styles.sectionSubtitle}>
                  {role === "reader"
                    ? "Your device data updates instantly after Sync"
                    : "Monitor all operations in real-time"}
                </Text>
              </View>

              <View style={[styles.metricsGrid, { width: containerWidth }]}>
                {wantedTiles.map((tile) => {
                  const isRestricted = !!restrictions[tile.key];

                  const count =
                    role === "reader"
                      ? tile.key === "offlinePackage"
                        ? offlinePackageCount
                        : tile.key === "meters"
                          ? offlineMetersCount
                          : tile.key === "tenants"
                            ? offlineTenantsCount
                            : tile.key === "offlineQueue"
                              ? scans.filter(
                                  (s) => s.status === "pending" || s.status === "failed",
                                ).length
                              : counts[tile.key] ?? 0
                      : counts[tile.key] ?? 0;

                  return (
                    <MetricCard
                      key={tile.key}
                      tile={tile}
                      count={count}
                      isRestricted={isRestricted}
                      subtext={tileSubtext(tile.key)}
                      onPress={() => openPanel(tile.key)}
                    />
                  );
                })}
              </View>
            </>
          )}

          <View style={{ height: 40 }} />
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContainer: { flex: 1 },
  scrollContent: { paddingVertical: 24, paddingHorizontal: 16 },
  container: { alignSelf: "center", width: "100%", maxWidth: 1400, gap: 32 },

  header: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 32,
    gap: 18,
    alignSelf: "center",
    ...(Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
      web: { boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)" } as any,
    }) as any),
  },

  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 16,
  },

  greeting: { fontSize: 14, fontWeight: "500", color: "#64748b", marginBottom: 4 },
  title: { fontSize: 28, fontWeight: "700", color: "#0f172a", letterSpacing: -0.5 },

  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  roleIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#3b82f6" },
  roleText: { fontSize: 13, fontWeight: "600", color: "#475569" },

  subtitle: { fontSize: 15, color: "#64748b", lineHeight: 22 },

  // ✅ Building filter styles
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  filterPickerShell: { flex: 1, borderRadius: 10, overflow: "hidden" },
  filterPicker: { height: 40, width: "100%", color: "#0f172a" },

  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  statsRowMobile: { flexDirection: "column", alignItems: "flex-start" },
  statItem: { gap: 6 },
  statValue: { fontSize: 32, fontWeight: "700", color: "#0f172a", letterSpacing: -1 },
  statLabel: { fontSize: 13, fontWeight: "500", color: "#64748b" },
  statDivider: { width: 1, height: 40, backgroundColor: "#e2e8f0" },

  statBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10b981" },
  statBadgeText: { fontSize: 12, fontWeight: "600", color: "#059669" },

  quickActions: { flexDirection: "row", gap: 12, marginTop: 6 },
  quickActionsMobile: { flexDirection: "column" },

  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionButtonPrimary: { backgroundColor: "#3b82f6", borderColor: "#3b82f6" },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconPrimary: { backgroundColor: "rgba(255, 255, 255, 0.2)" },
  actionLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: "#475569" },
  actionLabelPrimary: { color: "#ffffff" },

  sectionHeader: { gap: 4, marginTop: 8 },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  sectionSubtitle: { fontSize: 14, color: "#64748b" },

  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 24, alignSelf: "center" },

  metricCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 32,
    minWidth: 340,
    maxWidth: 420,
    flex: 1,
    gap: 24,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    ...(Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
      web: { boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)" } as any,
    }) as any),
  },

  metricHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  iconContainer: { width: 56, height: 56, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "600", color: "#059669" },

  metricBody: { gap: 4 },
  metricLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metricValue: { fontSize: 42, fontWeight: "700", color: "#0f172a", letterSpacing: -1.5, marginVertical: 6 },
  metricSubtext: { fontSize: 14, color: "#94a3b8" },

  metricFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  viewDetailsText: { fontSize: 14, fontWeight: "600" },

  restrictedOverlay: {
    position: "absolute",
    top: 24,
    right: 24,
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },

  loadingContainer: { alignSelf: "center", alignItems: "center", paddingVertical: 80, gap: 16 },
  loadingText: { fontSize: 15, color: "#64748b", fontWeight: "500" },
});