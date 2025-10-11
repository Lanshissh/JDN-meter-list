// app/(tabs)/dashboard.tsx
import React, { useEffect, useMemo, useState } from "react";
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
} from "react-native";
import axios, { AxiosError } from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";

/** ===== Types ===== */
type CountKey = "buildings" | "tenants" | "stalls" | "meters" | "readings";
type Role = "admin" | "operator" | "biller" | "unknown";
type Counts = Partial<Record<CountKey, number>>;
type TileState = {
  label: string;
  key: CountKey;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  restricted?: boolean;
};

function decodeRole(token: string | null): { role: Role; buildingId?: string } {
  if (!token) return { role: "unknown" };
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    const payload = JSON.parse(jsonPayload);
    const role = String(payload.user_level || payload.role || "unknown").toLowerCase() as Role;
    const buildingId = payload.building_id || payload.buildingId || undefined;
    if (role === "admin" || role === "operator" || role === "biller") return { role, buildingId };
    return { role: "unknown" };
  } catch {
    return { role: "unknown" };
  }
}

function makeApi(token: string | null) {
  const api = axios.create({ baseURL: BASE_API });
  api.interceptors.request.use((cfg) => {
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
  });
  return api;
}

async function safeCount(
  api: ReturnType<typeof makeApi>,
  path: string,
): Promise<{ count?: number; restricted?: boolean }> {
  try {
    const res = await api.get(path);
    const data = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.rows) ? res.data.rows : [];
    return { count: data.length };
  } catch (e) {
    const err = e as AxiosError;
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      return { restricted: true };
    }
    return { count: 0 };
  }
}

export default function Dashboard() {
  const router = useRouter();
  const { token } = useAuth();
  const { width } = useWindowDimensions();

  const { role } = useMemo(() => decodeRole(token), [token]);
  const api = useMemo(() => makeApi(token), [token]);

  const [busy, setBusy] = useState(true);
  const [counts, setCounts] = useState<Counts>({});
  const [restrictions, setRestrictions] = useState<Record<CountKey, boolean>>({
    buildings: false,
    tenants: false,
    stalls: false,
    meters: false,
    readings: false,
  });

  const wantedTiles: TileState[] = useMemo(() => {
    const base: TileState[] = [
      { key: "buildings", label: "Buildings", color: "#6366f1", icon: "business" },
      { key: "tenants",   label: "Tenants",   color: "#8b5cf6", icon: "people" },
      { key: "stalls",    label: "Stalls",    color: "#ec4899", icon: "storefront" },
      { key: "meters",    label: "Meters",    color: "#06b6d4", icon: "speedometer" },
      { key: "readings",  label: "Readings",  color: "#10b981", icon: "document-text" },
    ];
    if (role === "admin") return base;
    if (role === "operator") return base.filter((t) => ["tenants", "stalls", "meters", "readings"].includes(t.key));
    if (role === "biller")   return base.filter((t) => ["tenants", "readings"].includes(t.key));
    return base;
  }, [role]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        setBusy(false);
        return;
      }
      setBusy(true);
      const nextCounts: Counts = {};
      const nextRestr: Record<CountKey, boolean> = {
        buildings: false, tenants: false, stalls: false, meters: false, readings: false,
      };

      await Promise.all(
        wantedTiles.map(async (t) => {
          const { count, restricted } = await safeCount(api, `/${t.key}`);
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
    return () => { alive = false; };
  }, [token, role, wantedTiles.length]);

  const openPanel = (key: CountKey) => {
    router.push({ pathname: "/(tabs)/admin", params: { panel: key } } as any);
  };

  const isMobile = width < 768;
  const containerWidth = Platform.OS === "web" ? (width >= 1440 ? 1320 : width >= 1280 ? 1160 : 960) : width;

  const getRoleDisplay = () => {
    const roleMap = { admin: "Administrator", operator: "Operator", biller: "Biller", unknown: "User" };
    return roleMap[role] || "User";
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  };

  /** =========== UI =========== */
  return (
    <View style={styles.screen}>
      {/* Ethereal Background */}
      <View style={styles.backgroundArt}>
        <View style={[styles.meshGradient, styles.mesh1]} />
        <View style={[styles.meshGradient, styles.mesh2]} />
        <View style={[styles.meshGradient, styles.mesh3]} />
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.inner, isMobile && styles.innerMobile]}>
          {/* Ethereal Hero Section */}
          <View style={[styles.hero, { width: containerWidth }]}>
            <View style={styles.heroShine} />
            
            <View style={styles.heroContent}>
              <View style={styles.topBar}>
                <View style={styles.welcomeBadge}>
                  <View style={styles.sparkle} />
                  <Text style={styles.welcomeText}>{getGreeting()}</Text>
                </View>
                
                <View style={styles.liveBadge}>
                  <View style={styles.pulse} />
                  <Text style={styles.liveText}>Live</Text>
                </View>
              </View>

              <View style={styles.titleSection}>
                <Text style={[styles.mainTitle, isMobile && styles.mainTitleMobile]}>
                  JDN Meter & Billing
                </Text>
                <View style={styles.rolePill}>
                  <Ionicons name="person-circle-outline" size={16} color="#6366f1" />
                  <Text style={styles.roleLabel}>{getRoleDisplay()}</Text>
                </View>
              </View>

              <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
                Real-time metering analytics and intelligent billing automation
              </Text>

              {/* Floating Stats */}
              <View style={[styles.floatingStats, isMobile && styles.floatingStatsMobile]}>
                <View style={styles.statBubble}>
                  <View style={styles.statIconBg}>
                    <Ionicons name="pulse-outline" size={20} color="#6366f1" />
                  </View>
                  <Text style={styles.statNumber}>
                    {Object.values(counts).reduce((a, b) => a + b, 0)}
                  </Text>
                  <Text style={styles.statText}>Records</Text>
                </View>

                <View style={styles.statBubble}>
                  <View style={styles.statIconBg}>
                    <Ionicons name="analytics-outline" size={20} color="#8b5cf6" />
                  </View>
                  <Text style={styles.statNumber}>{wantedTiles.length}</Text>
                  <Text style={styles.statText}>Categories</Text>
                </View>

                <View style={styles.statBubble}>
                  <View style={styles.statIconBg}>
                    <Ionicons name="speedometer-outline" size={20} color="#10b981" />
                  </View>
                  <Text style={styles.statNumber}>99.9%</Text>
                  <Text style={styles.statText}>Uptime</Text>
                </View>
              </View>

              {/* Glass Action Buttons */}
              <View style={[styles.actions, isMobile && styles.actionsMobile]}>
                <TouchableOpacity 
                  style={styles.glassPrimary}
                  onPress={() => router.push("/(tabs)/scanner")}
                >
                  <View style={styles.buttonGlow} />
                  <Ionicons name="scan-outline" size={22} color="#6366f1" />
                  <Text style={styles.glassPrimaryText}>Quick Scan</Text>
                  <View style={styles.arrowCircle}>
                    <Ionicons name="arrow-forward" size={14} color="#6366f1" />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.glassSecondary}
                  onPress={() => router.push("/(tabs)/billing")}
                >
                  <Ionicons name="wallet-outline" size={20} color="#64748b" />
                  <Text style={styles.glassSecondaryText}>Billing</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.glassSecondary}
                  onPress={() => openPanel(wantedTiles[0]?.key || "tenants")}
                >
                  <Ionicons name="options-outline" size={20} color="#64748b" />
                  <Text style={styles.glassSecondaryText}>Admin</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Analytics Section */}
          {busy ? (
            <View style={[styles.loading, { width: containerWidth }]}>
              <View style={styles.loaderGlass}>
                <View style={styles.loaderOrb}>
                  <ActivityIndicator size="large" color="#6366f1" />
                </View>
                <Text style={styles.loaderText}>Loading analytics...</Text>
                <Text style={styles.loaderSub}>Syncing real-time data</Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.gridHeader}>
                <View>
                  <Text style={styles.gridTitle}>Analytics Dashboard</Text>
                  <Text style={styles.gridSubtitle}>Monitor all operations at a glance</Text>
                </View>
              </View>

              <View style={[styles.cardsGrid, { width: containerWidth }]}>
                {wantedTiles.map((t, idx) => {
                  const isRestricted = !!restrictions[t.key];
                  const count = counts[t.key] ?? 0;

                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => !isRestricted && openPanel(t.key)}
                      style={({ pressed }) => [
                        styles.glassCard,
                        pressed && styles.glassCardPressed,
                        Platform.OS === "web" && styles.glassCardHover,
                      ]}
                    >
                      {/* Ambient Glow */}
                      <View style={[styles.ambientGlow, { backgroundColor: t.color + '15' }]} />
                      
                      <View style={styles.cardInner}>
                        <View style={styles.cardTop}>
                          <View style={[styles.floatingIcon, { backgroundColor: t.color + '10' }]}>
                            <View style={[styles.iconRing, { borderColor: t.color + '30' }]} />
                            <Ionicons name={t.icon} size={32} color={t.color} />
                          </View>

                          {!isRestricted && (
                            <View style={styles.miniTrend}>
                              <Ionicons name="trending-up" size={12} color="#10b981" />
                            </View>
                          )}
                        </View>

                        <View style={styles.cardMid}>
                          <Text style={styles.cardTitle}>{t.label}</Text>
                          <Text style={styles.cardValue}>
                            {isRestricted ? "—" : count.toLocaleString()}
                          </Text>
                          <Text style={styles.cardCaption}>
                            {isRestricted ? "Access restricted" : "Total active entries"}
                          </Text>
                        </View>

                        <View style={styles.cardBottom}>
                          {isRestricted ? (
                            <View style={styles.lockedState}>
                              <Ionicons name="lock-closed" size={12} color="#94a3b8" />
                              <Text style={styles.lockedText}>Restricted</Text>
                            </View>
                          ) : (
                            <TouchableOpacity style={styles.viewAction}>
                              <Text style={[styles.viewText, { color: t.color }]}>View Details</Text>
                              <Ionicons name="chevron-forward" size={16} color={t.color} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>

                      {/* Color Accent */}
                      <View style={[styles.colorAccent, { backgroundColor: t.color }]} />
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* Insight Panel */}
          <View style={[styles.insightPanel, { width: containerWidth }]}>
            <View style={styles.insightGlow} />
            <View style={styles.insightIconBox}>
              <Ionicons name="bulb-outline" size={26} color="#f59e0b" />
            </View>
            <View style={styles.insightTextBox}>
              <Text style={styles.insightTitle}>Pro Workflow Tip</Text>
              <Text style={styles.insightDescription}>
                Capture readings offline with Scanner, then batch-approve and auto-generate invoices from the Readings module for maximum efficiency.
              </Text>
            </View>
          </View>

          <View style={{ height: 80 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#fafbfc",
  },
  backgroundArt: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  meshGradient: {
    position: "absolute",
    borderRadius: 9999,
    opacity: 0.06,
  },
  mesh1: {
    width: 500,
    height: 500,
    backgroundColor: "#6366f1",
    top: -200,
    right: -100,
  },
  mesh2: {
    width: 400,
    height: 400,
    backgroundColor: "#8b5cf6",
    bottom: -150,
    left: -100,
  },
  mesh3: {
    width: 350,
    height: 350,
    backgroundColor: "#ec4899",
    top: 300,
    left: 200,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollBody: {
    flexGrow: 1,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  inner: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 1400,
  },
  innerMobile: {
    alignItems: "center",
  },

  /** Hero Section */
  hero: {
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 32,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
    ...(Platform.select({
      web: {
        boxShadow: "0 24px 48px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.5) inset",
      },
      default: {},
    }) as any),
    elevation: 3,
  },
  heroShine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "60%",
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  heroContent: {
    padding: 48,
    position: "relative",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  welcomeBadge: {
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 100,
    paddingVertical: 10,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.15)",
  },
  sparkle: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#6366f1",
  },
  welcomeText: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  liveBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.08)",
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.15)",
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10b981",
  },
  liveText: {
    color: "#10b981",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  titleSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  mainTitle: {
    color: "#0f172a",
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 64,
  },
  mainTitleMobile: {
    fontSize: 38,
    lineHeight: 44,
  },
  rolePill: {
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.15)",
  },
  roleLabel: {
    color: "#6366f1",
    fontSize: 13,
    fontWeight: "700",
  },
  subtitle: {
    color: "#475569",
    fontSize: 18,
    lineHeight: 30,
    marginBottom: 36,
    maxWidth: 650,
  },
  subtitleMobile: {
    fontSize: 16,
    textAlign: "center",
  },
  floatingStats: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 32,
  },
  floatingStatsMobile: {
    flexDirection: "column",
  },
  statBubble: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.6)",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
    ...(Platform.select({
      web: {
        boxShadow: "0 8px 16px rgba(0, 0, 0, 0.04)",
      },
      default: {},
    }) as any),
    elevation: 1,
  },
  statIconBg: {
    width: 44,
    height: 44,
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  statNumber: {
    color: "#0f172a",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
  },
  statText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  actionsMobile: {
    flexDirection: "column",
  },
  glassPrimary: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.2)",
    ...(Platform.select({
      web: {
        boxShadow: "0 8px 20px rgba(99, 102, 241, 0.12)",
      },
      default: {},
    }) as any),
    elevation: 2,
  },
  buttonGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(99, 102, 241, 0.05)",
  },
  glassPrimaryText: {
    color: "#6366f1",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  arrowCircle: {
    width: 24,
    height: 24,
    backgroundColor: "rgba(99, 102, 241, 0.1)",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  glassSecondary: {
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
  },
  glassSecondaryText: {
    color: "#475569",
    fontSize: 15,
    fontWeight: "700",
  },

  /** Grid Section */
  gridHeader: {
    marginTop: 64,
    marginBottom: 28,
  },
  gridTitle: {
    fontSize: 36,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: -1,
    marginBottom: 8,
  },
  gridSubtitle: {
    fontSize: 16,
    color: "#64748b",
    fontWeight: "500",
  },
  cardsGrid: {
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 24,
    justifyContent: "center",
  },
  loading: {
    alignSelf: "center",
    alignItems: "center",
    paddingVertical: 100,
  },
  loaderGlass: {
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 28,
    padding: 48,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
    ...(Platform.select({
      web: {
        boxShadow: "0 16px 32px rgba(0, 0, 0, 0.06)",
      },
      default: {},
    }) as any),
    elevation: 2,
  },
  loaderOrb: {
    width: 80,
    height: 80,
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  loaderText: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "700",
  },
  loaderSub: {
    color: "#64748b",
    fontSize: 14,
  },

  /** Glass Cards */
  glassCard: {
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 28,
    minWidth: 300,
    maxWidth: 420,
    flexGrow: 1,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
    ...(Platform.select({
      web: {
        boxShadow: "0 16px 32px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.5) inset",
      },
      default: {},
    }) as any),
    elevation: 2,
  },
  glassCardHover: {
    ...(Platform.select({
      web: { cursor: "pointer" } as any,
      default: {},
    }) as any),
  },
  glassCardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.95,
  },
  ambientGlow: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.4,
  },
  cardInner: {
    padding: 32,
    position: "relative",
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  floatingIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  iconRing: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 2,
  },
  miniTrend: {
    width: 32,
    height: 32,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMid: {
    marginBottom: 24,
  },
  cardTitle: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardValue: {
    color: "#0f172a",
    fontSize: 48,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 52,
    marginBottom: 8,
  },
  cardCaption: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "500",
  },
  cardBottom: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.15)",
  },
  viewAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  lockedState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lockedText: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "600",
  },
  colorAccent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    opacity: 0.6,
  },

  /** Insight Panel */
  insightPanel: {
    alignSelf: "center",
    marginTop: 56,
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 24,
    padding: 32,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.8)",
    ...(Platform.select({
      web: {
        boxShadow: "0 16px 32px rgba(0, 0, 0, 0.05)",
      },
      default: {},
    }) as any),
    elevation: 2,
  },
  insightGlow: {
    position: "absolute",
    top: -60,
    left: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
  },
  insightIconBox: {
    width: 56,
    height: 56,
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)",
  },
  insightTextBox: {
    flex: 1,
    gap: 8,
  },
  insightTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  insightDescription: {
    color: "#64748b",
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "500",
  },
});