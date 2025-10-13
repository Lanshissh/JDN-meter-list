// app/(tabs)/dashboard.tsx
import React, { useEffect, useMemo, useState, useRef } from "react";
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

type Particle = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  color: string;
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

// Floating Particles Component
function FloatingParticles() {
  const [particles, setParticles] = useState<Particle[]>([]);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#06b6d4', '#10b981'];
    const newParticles: Particle[] = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: Math.random() * 4 + 2,
      opacity: Math.random() * 0.3 + 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    setParticles(newParticles);

    const interval = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p,
        x: (p.x + p.vx + width) % width,
        y: (p.y + p.vy + height) % height,
      })));
    }, 50);

    return () => clearInterval(interval);
  }, [width, height]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map(p => (
        <View
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.size,
            height: p.size,
            borderRadius: p.size / 2,
            backgroundColor: p.color,
            opacity: p.opacity,
          }}
        />
      ))}
    </View>
  );
}

// Holographic Card Component
function HolographicCard({ 
  tile, 
  count, 
  isRestricted, 
  onPress 
}: { 
  tile: TileState; 
  count: number; 
  isRestricted: boolean;
  onPress: () => void;
}) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const hoverAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <Pressable
      onPress={() => !isRestricted && onPress()}
      onPressIn={() => {
        Animated.spring(hoverAnim, {
          toValue: 1,
          useNativeDriver: true,
        }).start();
      }}
      onPressOut={() => {
        Animated.spring(hoverAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      }}
      style={({ pressed }) => [
        styles.glassCard,
        Platform.OS === "web" && styles.glassCardHover,
      ]}
    >
      {/* Holographic Shimmer */}
      <Animated.View
        style={[
          styles.holographicShimmer,
          {
            transform: [{ translateX: shimmerTranslate }],
          },
        ]}
      />

      {/* Ambient Glow */}
      <View style={[styles.ambientGlow, { backgroundColor: tile.color + '15' }]} />
      
      {/* Scan Lines */}
      <View style={styles.scanLines}>
        {[...Array(5)].map((_, i) => (
          <View key={i} style={styles.scanLine} />
        ))}
      </View>

      <Animated.View 
        style={[
          styles.cardInner,
          {
            transform: [
              {
                scale: hoverAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.02],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.cardTop}>
          <View style={[styles.floatingIcon, { backgroundColor: tile.color + '10' }]}>
            <View style={[styles.iconRing, { borderColor: tile.color + '30' }]} />
            <View style={[styles.iconPulse, { backgroundColor: tile.color }]} />
            <Ionicons name={tile.icon} size={32} color={tile.color} />
          </View>

          {!isRestricted && (
            <View style={styles.miniTrend}>
              <Ionicons name="trending-up" size={12} color="#10b981" />
            </View>
          )}
        </View>

        <View style={styles.cardMid}>
          <Text style={styles.cardTitle}>{tile.label}</Text>
          <View style={styles.valueContainer}>
            <Text style={styles.cardValue}>
              {isRestricted ? "—" : count.toLocaleString()}
            </Text>
            {!isRestricted && (
              <View style={[styles.dataDot, { backgroundColor: tile.color }]} />
            )}
          </View>
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
              <Text style={[styles.viewText, { color: tile.color }]}>View Details</Text>
              <Ionicons name="chevron-forward" size={16} color={tile.color} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* Color Accent with Glow */}
      <View style={[styles.colorAccent, { backgroundColor: tile.color }]} />
      <View style={[styles.colorAccentGlow, { backgroundColor: tile.color }]} />
    </Pressable>
  );
}

// Animated Stats Bubble
function AnimatedStatBubble({ 
  icon, 
  value, 
  label, 
  color 
}: { 
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
  color: string;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 20000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.statBubble}>
      <Animated.View 
        style={[
          styles.statIconBg,
          {
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        <Animated.View style={{ transform: [{ rotate }] }}>
          <View style={[styles.orbitRing, { borderColor: color + '30' }]} />
        </Animated.View>
        <Ionicons name={icon} size={20} color={color} />
      </Animated.View>
      <Text style={styles.statNumber}>{value}</Text>
      <Text style={styles.statText}>{label}</Text>
      
      {/* Data Stream Effect */}
      <View style={styles.dataStream}>
        {[...Array(3)].map((_, i) => (
          <View 
            key={i} 
            style={[
              styles.dataStreamDot, 
              { 
                backgroundColor: color,
                opacity: 0.3 - i * 0.1,
              }
            ]} 
          />
        ))}
      </View>
    </View>
  );
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

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 1000,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

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
      {/* Floating Particles Background */}
      <FloatingParticles />

      {/* Ethereal Background */}
      <View style={styles.backgroundArt}>
        <View style={[styles.meshGradient, styles.mesh1]} />
        <View style={[styles.meshGradient, styles.mesh2]} />
        <View style={[styles.meshGradient, styles.mesh3]} />
        <View style={[styles.meshGradient, styles.mesh4]} />
      </View>

      {/* Grid Pattern Overlay */}
      <View style={styles.gridPattern} />

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View 
          style={[
            styles.inner, 
            isMobile && styles.innerMobile,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Ethereal Hero Section */}
          <View style={[styles.hero, { width: containerWidth }]}>
            <View style={styles.heroShine} />
            <View style={styles.heroGradientOverlay} />
            
            <View style={styles.heroContent}>
              <View style={styles.topBar}>
                <View style={styles.welcomeBadge}>
                  <View style={styles.sparkle} />
                  <View style={styles.sparkleRing} />
                  <Text style={styles.welcomeText}>{getGreeting()}</Text>
                </View>
                
                <View style={styles.liveBadge}>
                  <View style={styles.pulse} />
                  <View style={styles.pulseRing} />
                  <Text style={styles.liveText}>Live</Text>
                  <View style={styles.signalBars}>
                    {[1, 2, 3].map(i => (
                      <View 
                        key={i} 
                        style={[
                          styles.signalBar, 
                          { height: i * 4, backgroundColor: '#10b981' }
                        ]} 
                      />
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.titleSection}>
                <View style={styles.titleGlow} />
                <Text style={[styles.mainTitle, isMobile && styles.mainTitleMobile]}>
                  JDN Meter & Billing
                </Text>
                <View style={styles.rolePill}>
                  <View style={[styles.roleOrb, { backgroundColor: '#6366f1' }]} />
                  <Ionicons name="person-circle-outline" size={16} color="#6366f1" />
                  <Text style={styles.roleLabel}>{getRoleDisplay()}</Text>
                </View>
              </View>

              <Text style={[styles.subtitle, isMobile && styles.subtitleMobile]}>
                Real-time metering analytics with AI-powered insights and quantum-speed billing automation
              </Text>

              {/* Floating Stats */}
              <View style={[styles.floatingStats, isMobile && styles.floatingStatsMobile]}>
                <AnimatedStatBubble
                  icon="pulse-outline"
                  value={Object.values(counts).reduce((a, b) => a + b, 0)}
                  label="Total Records"
                  color="#6366f1"
                />
              </View>

              {/* Glass Action Buttons */}
              <View style={[styles.actions, isMobile && styles.actionsMobile]}>
                <TouchableOpacity 
                  style={styles.glassPrimary}
                  onPress={() => router.push("/(tabs)/scanner")}
                >
                  <View style={styles.buttonGlow} />
                  <View style={styles.buttonShine} />
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
                  <View style={styles.iconGlow} />
                  <Ionicons name="wallet-outline" size={20} color="#64748b" />
                  <Text style={styles.glassSecondaryText}>Billing</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.glassSecondary}
                  onPress={() => openPanel(wantedTiles[0]?.key || "tenants")}
                >
                  <View style={styles.iconGlow} />
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
                  <View style={styles.orbitingDots}>
                    {[...Array(3)].map((_, i) => (
                      <View 
                        key={i} 
                        style={[
                          styles.orbitDot,
                          {
                            transform: [
                              { rotate: `${i * 120}deg` },
                              { translateX: 40 },
                            ],
                          },
                        ]} 
                      />
                    ))}
                  </View>
                  <ActivityIndicator size="large" color="#6366f1" />
                </View>
                <Text style={styles.loaderText}>Loading analytics...</Text>
                <Text style={styles.loaderSub}>Syncing real-time data</Text>
                <View style={styles.loaderProgress}>
                  <View style={styles.loaderProgressBar} />
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.gridHeader}>
                <View>
                  <Text style={styles.gridTitle}>Analytics Dashboard</Text>
                  <Text style={styles.gridSubtitle}>Monitor all operations with holographic precision</Text>
                </View>
                <View style={styles.neuralnNetwork}>
                  {[...Array(5)].map((_, i) => (
                    <View key={i} style={styles.neuralNode} />
                  ))}
                </View>
              </View>

              <View style={[styles.cardsGrid, { width: containerWidth }]}>
                {wantedTiles.map((t, idx) => {
                  const isRestricted = !!restrictions[t.key];
                  const count = counts[t.key] ?? 0;

                  return (
                    <HolographicCard
                      key={t.key}
                      tile={t}
                      count={count}
                      isRestricted={isRestricted}
                      onPress={() => openPanel(t.key)}
                    />
                  );
                })}
              </View>
            </>
          )}

          {/* Enhanced Insight Panel */}
          <View style={[styles.insightPanel, { width: containerWidth }]}>
            <View style={styles.insightGlow} />
            <View style={styles.insightBeam} />
            <View style={styles.insightIconBox}>
              <View style={styles.insightIconPulse} />
              <Ionicons name="bulb-outline" size={26} color="#f59e0b" />
            </View>
            <View style={styles.insightTextBox}>
              <View style={styles.insightBadge}>
                <Text style={styles.insightBadgeText}>AI INSIGHT</Text>
              </View>
              <Text style={styles.insightTitle}>Pro Workflow Optimization</Text>
              <Text style={styles.insightDescription}>
                Capture readings offline with Scanner, then batch-approve and auto-generate invoices from the Readings module for maximum efficiency. AI learns your patterns for smarter automation.
              </Text>
            </View>
          </View>

          <View style={{ height: 80 }} />
        </Animated.View>
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
    width: 600,
    height: 600,
    backgroundColor: "#6366f1",
    top: -250,
    right: -150,
  },
  mesh2: {
    width: 500,
    height: 500,
    backgroundColor: "#8b5cf6",
    bottom: -200,
    left: -150,
  },
  mesh3: {
    width: 400,
    height: 400,
    backgroundColor: "#ec4899",
    top: 350,
    left: 250,
  },
  mesh4: {
    width: 450,
    height: 450,
    backgroundColor: "#06b6d4",
    bottom: 200,
    right: 100,
  },
  gridPattern: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    ...(Platform.select({
      web: {
        backgroundImage: 'linear-gradient(#6366f1 1px, transparent 1px), linear-gradient(90deg, #6366f1 1px, transparent 1px)',
        backgroundSize: '50px 50px',
      } as any,
      default: {},
    }) as any),
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
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 32,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
    ...(Platform.select({
      web: {
        boxShadow: "0 24px 48px rgba(99, 102, 241, 0.12), 0 0 0 1px rgba(255, 255, 255, 0.8) inset, 0 0 80px rgba(99, 102, 241, 0.05)",
        backdropFilter: 'blur(20px)',
      },
      default: {},
    }) as any),
    elevation: 8,
  },
  heroShine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "60%",
    backgroundColor: "rgba(255, 255, 255, 0.6)",
  },
  heroGradientOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...(Platform.select({
      web: {
        background: 'radial-gradient(circle at top right, rgba(99, 102, 241, 0.1), transparent 60%)',
      } as any,
      default: {},
    }) as any),
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
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    borderRadius: 100,
    paddingVertical: 10,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.3)",
    position: 'relative',
    ...(Platform.select({
      web: {
        boxShadow: "0 0 20px rgba(99, 102, 241, 0.3)",
      },
      default: {},
    }) as any),
  },
  sparkle: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#6366f1",
    ...(Platform.select({
      web: {
        boxShadow: "0 0 10px #6366f1",
      },
      default: {},
    }) as any),
  },
  sparkleRing: {
    position: 'absolute',
    left: 15,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#6366f1',
    opacity: 0.3,
  },
  welcomeText: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  liveBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    ...(Platform.select({
      web: {
        boxShadow: "0 0 20px rgba(16, 185, 129, 0.3)",
      },
      default: {},
    }) as any),
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10b981",
    ...(Platform.select({
      web: {
        boxShadow: "0 0 10px #10b981",
      },
      default: {},
    }) as any),
  },
  pulseRing: {
    position: 'absolute',
    left: 12,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#10b981',
    opacity: 0.3,
  },
  liveText: {
    color: "#10b981",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  signalBars: {
    flexDirection: 'row',
    gap: 2,
    alignItems: 'flex-end',
  },
  signalBar: {
    width: 3,
    borderRadius: 1.5,
  },
  titleSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 16,
    flexWrap: "wrap",
    position: 'relative',
  },
  titleGlow: {
    position: 'absolute',
    top: -20,
    left: -20,
    width: 400,
    height: 100,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 50,
    ...(Platform.select({
      web: {
        filter: 'blur(40px)',
      } as any,
      default: {},
    }) as any),
  },
  mainTitle: {
    color: "#0f172a",
    fontSize: 56,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 64,
    textShadowColor: 'rgba(99, 102, 241, 0.2)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  mainTitleMobile: {
    fontSize: 38,
    lineHeight: 44,
  },
  rolePill: {
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    borderRadius: 100,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.3)",
  },
  roleOrb: {
    width: 8,
    height: 8,
    borderRadius: 4,
    ...(Platform.select({
      web: {
        boxShadow: "0 0 8px #6366f1",
      },
      default: {},
    }) as any),
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
    backgroundColor: "rgba(255, 255, 255, 0.7)",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
    position: 'relative',
    overflow: 'hidden',
    ...(Platform.select({
      web: {
        boxShadow: "0 8px 32px rgba(99, 102, 241, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5) inset",
        backdropFilter: 'blur(10px)',
      },
      default: {},
    }) as any),
    elevation: 3,
  },
  statIconBg: {
    width: 48,
    height: 48,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    position: 'relative',
    ...(Platform.select({
      web: {
        boxShadow: "0 0 20px rgba(99, 102, 241, 0.4)",
      },
      default: {},
    }) as any),
  },
  orbitRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
  },
  statNumber: {
    color: "#0f172a",
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
    textShadowColor: 'rgba(99, 102, 241, 0.2)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  statText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  dataStream: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    gap: 4,
  },
  dataStreamDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
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
    backgroundColor: "rgba(99, 102, 241, 0.15)",
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
    borderColor: "rgba(99, 102, 241, 0.4)",
    ...(Platform.select({
      web: {
        boxShadow: "0 8px 32px rgba(99, 102, 241, 0.3), 0 0 0 1px rgba(99, 102, 241, 0.2) inset",
        backdropFilter: 'blur(10px)',
      },
      default: {},
    }) as any),
    elevation: 4,
  },
  buttonGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(99, 102, 241, 0.1)",
  },
  buttonShine: {
    position: 'absolute',
    top: 0,
    left: -100,
    width: 100,
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    transform: [{ skewX: '-20deg' }],
  },
  glassPrimaryText: {
    color: "#6366f1",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  arrowCircle: {
    width: 24,
    height: 24,
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  glassSecondary: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.2)",
    position: 'relative',
    overflow: 'hidden',
    ...(Platform.select({
      web: {
        backdropFilter: 'blur(10px)',
      },
      default: {},
    }) as any),
  },
  iconGlow: {
    position: 'absolute',
    width: 40,
    height: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 20,
    left: 10,
    ...(Platform.select({
      web: {
        filter: 'blur(15px)',
      } as any,
      default: {},
    }) as any),
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gridTitle: {
    fontSize: 36,
    fontWeight: "900",
    color: "#0f172a",
    letterSpacing: -1,
    marginBottom: 8,
    textShadowColor: 'rgba(99, 102, 241, 0.15)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  gridSubtitle: {
    fontSize: 16,
    color: "#64748b",
    fontWeight: "500",
  },
  neuralnNetwork: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  neuralNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366f1',
    opacity: 0.6,
    ...(Platform.select({
      web: {
        boxShadow: "0 0 8px #6366f1",
      },
      default: {},
    }) as any),
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
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 28,
    padding: 48,
    alignItems: "center",
    gap: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
    ...(Platform.select({
      web: {
        boxShadow: "0 16px 48px rgba(99, 102, 241, 0.1)",
        backdropFilter: 'blur(20px)',
      },
      default: {},
    }) as any),
    elevation: 4,
  },
  loaderOrb: {
    width: 80,
    height: 80,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    position: 'relative',
    ...(Platform.select({
      web: {
        boxShadow: "0 0 40px rgba(99, 102, 241, 0.5)",
      },
      default: {},
    }) as any),
  },
  orbitingDots: {
    position: 'absolute',
    width: 100,
    height: 100,
  },
  orbitDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#6366f1',
    top: 46,
    left: 46,
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
  loaderProgress: {
    width: 200,
    height: 4,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  loaderProgressBar: {
    width: '60%',
    height: '100%',
    backgroundColor: '#6366f1',
    ...(Platform.select({
      web: {
        boxShadow: "0 0 10px #6366f1",
      },
      default: {},
    }) as any),
  },

  /** Holographic Glass Cards */
  glassCard: {
    backgroundColor: "rgba(255, 255, 255, 0.75)",
    borderRadius: 28,
    minWidth: 300,
    maxWidth: 420,
    flexGrow: 1,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.9)",
    ...(Platform.select({
      web: {
        boxShadow: "0 16px 48px rgba(99, 102, 241, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.5) inset, 0 0 80px rgba(99, 102, 241, 0.04)",
        backdropFilter: 'blur(20px)',
      },
      default: {},
    }) as any),
    elevation: 4,
  },
  glassCardHover: {
    ...(Platform.select({
      web: { cursor: "pointer" } as any,
      default: {},
    }) as any),
  },
  holographicShimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 200,
    height: '100%',
    ...(Platform.select({
      web: {
        background: 'linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.2), transparent)',
      } as any,
      default: {
        backgroundColor: 'transparent',
      },
    }) as any),
  },
  ambientGlow: {
    position: "absolute",
    top: -80,
    right: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    opacity: 0.5,
    ...(Platform.select({
      web: {
        filter: 'blur(60px)',
      } as any,
      default: {},
    }) as any),
  },
  scanLines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.03,
  },
  scanLine: {
    height: 2,
    backgroundColor: '#6366f1',
    marginTop: 20,
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
    ...(Platform.select({
      web: {
        boxShadow: "0 8px 32px rgba(99, 102, 241, 0.3)",
      },
      default: {},
    }) as any),
  },
  iconRing: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 2,
  },
  iconPulse: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 24,
    opacity: 0.2,
  },
  miniTrend: {
    width: 32,
    height: 32,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  cardMid: {
    marginBottom: 24,
  },
  cardTitle: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardValue: {
    color: "#0f172a",
    fontSize: 48,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 52,
    marginBottom: 8,
    textShadowColor: 'rgba(99, 102, 241, 0.2)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  dataDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    ...(Platform.select({
      web: {
        boxShadow: "0 0 12px currentColor",
      },
      default: {},
    }) as any),
  },
  cardCaption: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "500",
  },
  cardBottom: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "rgba(99, 102, 241, 0.15)",
  },
  viewAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  lockedState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  lockedText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  colorAccent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    opacity: 0.8,
  },
  colorAccentGlow: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 8,
    opacity: 0.4,
    ...(Platform.select({
      web: {
        filter: 'blur(8px)',
      } as any,
      default: {},
    }) as any),
  },

  /** Enhanced Insight Panel */
  insightPanel: {
    alignSelf: "center",
    marginTop: 56,
    backgroundColor: "rgba(245, 158, 11, 0.05)",
    borderRadius: 24,
    padding: 32,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)",
    ...(Platform.select({
      web: {
        boxShadow: "0 16px 48px rgba(245, 158, 11, 0.15), 0 0 0 1px rgba(245, 158, 11, 0.1) inset",
        backdropFilter: 'blur(20px)',
      },
      default: {},
    }) as any),
    elevation: 3,
  },
  insightGlow: {
    position: "absolute",
    top: -80,
    left: -80,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    ...(Platform.select({
      web: {
        filter: 'blur(60px)',
      } as any,
      default: {},
    }) as any),
  },
  insightBeam: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 150,
    height: '100%',
    opacity: 0.05,
    ...(Platform.select({
      web: {
        background: 'linear-gradient(90deg, transparent, rgba(245, 158, 11, 0.3))',
      } as any,
      default: {},
    }) as any),
  },
  insightIconBox: {
    width: 56,
    height: 56,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.3)",
    position: 'relative',
    ...(Platform.select({
      web: {
        boxShadow: "0 0 30px rgba(245, 158, 11, 0.4)",
      },
      default: {},
    }) as any),
  },
  insightIconPulse: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    ...(Platform.select({
      web: {
        filter: 'blur(10px)',
      } as any,
      default: {},
    }) as any),
  },
  insightTextBox: {
    flex: 1,
    gap: 12,
  },
  insightBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  insightBadgeText: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  insightTitle: {
    color: "#0f172a",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  insightDescription: {
    color: "#475569",
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "500",
  },
});