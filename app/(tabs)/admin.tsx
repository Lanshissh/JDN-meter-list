// app/(tabs)/admin.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Modal,
  Image,
  Animated,
  Dimensions,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { jwtDecode } from "jwt-decode";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useAuth } from "../../contexts/AuthContext";
import AccountsPanel from "../../components/admin/AccountsPanel";
import BuildingPanel from "../../components/admin/BuildingPanel";
import WithholdingPanel from "../../components/admin/WithholdingPanel";
import VATPanel from "../../components/admin/VatPanel";
import StallsPanel from "../../components/admin/StallsPanel";
import TenantsPanel from "../../components/admin/TenantsPanel";
import AssignTenantPanel from "../../components/admin/AssignTenantPanel";
import MeterPanel from "../../components/admin/MeterPanel";
import MeterReadingPanel from "../../components/admin/MeterReadingPanel";

export type PageKey =
  | "accounts"
  | "buildings"
  | "stalls"
  | "wt"
  | "vat"
  | "tenants"
  | "assign"
  | "meters"
  | "readings";

type Page = { label: string; key: PageKey; icon: keyof typeof Ionicons.glyphMap };

export default function AdminScreen() {
  const router = useRouter();
  const { token, logout } = useAuth();
  const params = useLocalSearchParams<{ panel?: string; tab?: string }>();
  const isWeb = Platform.OS === 'web';

  const pages: Page[] = useMemo(
    () => [
      { label: "Accounts", key: "accounts", icon: "people-outline" },
      { label: "Buildings", key: "buildings", icon: "business-outline" },
      { label: "Stalls", key: "stalls", icon: "storefront-outline" },
      { label: "Withholding Tax", key: "wt", icon: "pricetag-outline" },
      { label: "VAT", key: "vat", icon: "cash-outline" },
      { label: "Tenants", key: "tenants", icon: "person-outline" },
      { label: "Assign", key: "assign", icon: "person-add-outline" },
      { label: "Meters", key: "meters", icon: "speedometer-outline" },
      { label: "Readings", key: "readings", icon: "reader-outline" },
    ],
    []
  );

  const role: string = useMemo(() => {
    try {
      if (!token) return "";
      const dec: any = jwtDecode(token);
      return String(dec?.user_level || "").toLowerCase();
    } catch { return ""; }
  }, [token]);

  const roleAllowed: Record<string, Set<PageKey>> = useMemo(
    () => ({
      admin: new Set<PageKey>([
        "accounts","buildings","stalls","wt","vat","tenants","assign","meters","readings",
      ]),
      operator: new Set<PageKey>(["stalls","tenants","meters","readings"]),
      biller: new Set<PageKey>(["wt","vat","tenants"]),
    }),
    []
  );

  const allowed = roleAllowed[role] ?? roleAllowed.admin;
  const visiblePages = useMemo(() => pages.filter(p => allowed.has(p.key)), [pages, allowed]);

  const roleInitial: Record<string, PageKey> = { admin: "buildings", operator: "stalls", biller: "wt" };
  const resolveInitial = (): PageKey => {
    const wanted = String(params?.panel || params?.tab || "").toLowerCase() as PageKey;
    if (wanted && allowed.has(wanted)) return wanted;
    return roleInitial[role] ?? "buildings";
  };
  const [active, setActive] = useState<PageKey>(resolveInitial());

  useEffect(() => {
    const wanted = String(params?.panel || params?.tab || "").toLowerCase() as PageKey;
    const allowedSet = roleAllowed[role] ?? roleAllowed.admin;
    if (wanted && allowedSet.has(wanted)) setActive(wanted);
    else if (!allowedSet.has(active)) setActive(roleInitial[role] ?? "buildings");
  }, [role, token, params?.panel, params?.tab, allowed.size]);

  const ready = visiblePages.some((p) => p.key === active);

  const [userInfo, setUserInfo] = useState<{ name?: string; level?: string }>({});
  useEffect(() => {
    if (!token) return;
    try {
      const dec: any = jwtDecode(token);
      setUserInfo({ name: dec.user_fullname, level: dec.user_level });
    } catch {}
  }, [token]);

  // Elegant floating orbs
  const orbCount = 12;
  const orbAnims = useRef([...Array(orbCount)].map(() => ({
    translateY: new Animated.Value(0),
    opacity: new Animated.Value(0.15),
  }))).current;

  useEffect(() => {
    orbAnims.forEach((anim, i) => {
      const duration = 5000 + i * 600;
      const delay = i * 300;
      
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.parallel([
            Animated.timing(anim.translateY, {
              toValue: -80,
              duration: duration,
              useNativeDriver: true,
            }),
            Animated.sequence([
              Animated.timing(anim.opacity, {
                toValue: 0.4,
                duration: duration / 2,
                useNativeDriver: true,
              }),
              Animated.timing(anim.opacity, {
                toValue: 0.15,
                duration: duration / 2,
                useNativeDriver: true,
              }),
            ]),
          ]),
          Animated.timing(anim.translateY, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    });
  }, []);

  // Breathing animation for accents
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  const breatheOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 1],
  });

  const screenW = Dimensions.get("window").width;
  const drawerWidth = Math.min(340, Math.round(screenW * 0.88));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideX = useRef(new Animated.Value(-drawerWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.spring(slideX, { 
        toValue: 0, 
        useNativeDriver: false,
        tension: 65,
        friction: 9,
      }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  };

  const closeDrawer = () => {
    Animated.parallel([
      Animated.spring(slideX, { 
        toValue: -drawerWidth, 
        useNativeDriver: false,
        tension: 65,
        friction: 9,
      }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setDrawerOpen(false);
    });
  };

  const applyRouteParam = (key: PageKey) => {
    try { router.setParams({ panel: key }); } catch {}
  };

  const handleSelect = (key: PageKey) => {
    setActive(key);
    applyRouteParam(key);
    if (drawerOpen) closeDrawer();
  };

  const renderContent = () => {
    switch (active) {
      case "accounts": return <AccountsPanel token={token} />;
      case "buildings": return <BuildingPanel token={token} />;
      case "stalls": return <StallsPanel token={token} />;
      case "wt": return <WithholdingPanel token={token} />;
      case "vat": return <VATPanel token={token} />;
      case "tenants": return <TenantsPanel token={token} />;
      case "assign": return <AssignTenantPanel token={token} />;
      case "meters": return <MeterPanel token={token} />;
      case "readings": return <MeterReadingPanel token={token} />;
      default: return null;
    }
  };

  const Header = () => (
    <View style={styles.headerContainer}>
      <View style={styles.headerCard}>
        <View style={styles.headerTopAccent} />
        
        <View style={styles.headerContent}>
          {!isWeb && (
            <TouchableOpacity onPress={openDrawer} style={styles.menuButton}>
              <View style={styles.menuButtonInner}>
                <View style={styles.menuLine} />
                <View style={[styles.menuLine, { width: 18 }]} />
                <View style={[styles.menuLine, { width: 14 }]} />
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.brandSection}>
            <View style={styles.logoContainer}>
              <View style={styles.logoOuter}>
                <Image source={require("../../assets/images/jdn.jpg")} style={styles.logo} />
              </View>
              <Animated.View style={[styles.logoShine, { opacity: breatheOpacity }]} />
            </View>
            <View>
              <Text style={styles.brandTitle}>Admin Portal</Text>
              <View style={styles.brandMeta}>
                <View style={styles.liveDot} />
                <Text style={styles.brandSubtitle}>ENTERPRISE DASHBOARD</Text>
              </View>
            </View>
          </View>

          <View style={styles.headerActions}>
            {!!userInfo?.name && (
              <View style={styles.userCard}>
                <View style={styles.userAvatarBox}>
                  <View style={styles.avatarInner}>
                    <Text style={styles.avatarText}>
                      {userInfo.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.avatarBorder} />
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userNameText} numberOfLines={1}>{userInfo.name}</Text>
                  {userInfo.level && (
                    <View style={styles.userBadge}>
                      <View style={styles.badgeAccent} />
                      <Text style={styles.userRoleText}>{String(userInfo.level).toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
            {isWeb && (
              <TouchableOpacity
                onPress={async () => { await logout(); router.replace("/(auth)/login"); }}
                style={styles.logoutButton}
              >
                <Ionicons name="power" size={18} color="#fff" />
                <Text style={styles.logoutText}>Sign Out</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );

  const NavTab = ({
    label, icon, isActive, onPress,
  }: { label: string; icon: keyof typeof Ionicons.glyphMap; isActive: boolean; onPress: () => void; }) => {
    const scale = useRef(new Animated.Value(1)).current;
    const activeAnim = useRef(new Animated.Value(isActive ? 1 : 0)).current;

    useEffect(() => {
      Animated.spring(activeAnim, {
        toValue: isActive ? 1 : 0,
        tension: 200,
        friction: 12,
        useNativeDriver: true,
      }).start();
    }, [isActive]);

    const onDown = () => Animated.spring(scale, { 
      toValue: 0.95, 
      useNativeDriver: true, 
      tension: 400,
      friction: 12,
    }).start();
    
    const onUp = () => Animated.spring(scale, { 
      toValue: 1, 
      useNativeDriver: true, 
      tension: 400,
      friction: 12,
    }).start();

    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <TouchableOpacity
          onPressIn={onDown}
          onPressOut={onUp}
          onPress={onPress}
          style={[styles.navTab, isActive && styles.navTabActive]}
        >
          {isActive && <View style={styles.tabActiveBar} />}
          <View style={styles.tabContent}>
            <View style={[styles.tabIconBox, isActive && styles.tabIconBoxActive]}>
              <Ionicons 
                name={icon} 
                size={18} 
                color={isActive ? "#fff" : "#1e40af"} 
              />
            </View>
            <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
              {label}
            </Text>
            {isActive && <View style={styles.tabIndicator} />}
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const leftOrder: PageKey[] = ["buildings","stalls","wt","vat","tenants","assign","meters","readings"];
  const leftItems = visiblePages
    .filter(p => leftOrder.includes(p.key))
    .sort((a,b) => leftOrder.indexOf(a.key) - leftOrder.indexOf(b.key));
  const showAccounts = visiblePages.some(p => p.key === "accounts");

  return (
    <SafeAreaView style={styles.screen}>
      {/* Premium gradient background */}
      <View style={styles.backgroundGradient}>
        <View style={styles.gradientTop} />
        <View style={styles.gradientMiddle} />
        <View style={styles.gradientBottom} />
      </View>

      {/* Floating orbs */}
      {orbAnims.map((anim, i) => (
        <Animated.View
          key={i}
          style={[
            styles.floatingOrb,
            {
              left: `${(i * 8.5) % 95}%`,
              top: `${25 + (i * 6) % 60}%`,
              opacity: anim.opacity,
              transform: [{ translateY: anim.translateY }],
            },
          ]}
        />
      ))}

      {/* Decorative lines */}
      <View style={styles.decorativeLine1} />
      <View style={styles.decorativeLine2} />

      <Header />

      {isWeb && (
        <View style={styles.navContainer}>
          <View style={styles.navBar}>
            <View style={styles.navAccent} />
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navScroll}
            >
              <View style={styles.navTabs}>
                {leftItems.map((p) => (
                  <NavTab
                    key={p.key}
                    label={p.label}
                    icon={p.icon}
                    isActive={active === p.key}
                    onPress={() => handleSelect(p.key)}
                  />
                ))}
              </View>

              {showAccounts && (
                <View style={styles.navSpecial}>
                  <NavTab
                    label="Accounts"
                    icon="people-outline"
                    isActive={active === "accounts"}
                    onPress={() => handleSelect("accounts")}
                  />
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {!isWeb && (
        <Modal visible={drawerOpen} transparent animationType="none" onRequestClose={closeDrawer}>
          <Animated.View style={[styles.drawerOverlay, { opacity: backdropOpacity }]}>
            <TouchableOpacity 
              style={StyleSheet.absoluteFill} 
              activeOpacity={1} 
              onPress={closeDrawer}
            />
          </Animated.View>
          <Animated.View style={[styles.drawerPanel, { width: drawerWidth, transform: [{ translateX: slideX }] }]}>
            <View style={styles.drawerTopBar} />
            
            <View style={styles.drawerHeader}>
              <View>
                <Text style={styles.drawerHeading}>Navigation Menu</Text>
                <View style={styles.drawerMetaRow}>
                  <View style={styles.drawerMetaDot} />
                  <Text style={styles.drawerMeta}>Quick Access Portal</Text>
                </View>
              </View>
              <TouchableOpacity onPress={closeDrawer} style={styles.drawerCloseBtn}>
                <Ionicons name="close-circle" size={28} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.drawerContent}>
              <Text style={styles.drawerSectionTitle}>MODULES</Text>
              
              {leftOrder.concat(showAccounts ? ["accounts"] as PageKey[] : []).map((k) => {
                const page = visiblePages.find((p) => p.key === k);
                if (!page) return null;
                const isActive = active === page.key;
                return (
                  <TouchableOpacity
                    key={page.key}
                    onPress={() => handleSelect(page.key)}
                    style={[styles.drawerMenuItem, isActive && styles.drawerMenuItemActive]}
                  >
                    {isActive && <View style={styles.drawerActiveLine} />}
                    <View style={[styles.drawerMenuIcon, isActive && styles.drawerMenuIconActive]}>
                      <Ionicons 
                        name={page.icon} 
                        size={22} 
                        color={isActive ? "#fff" : "#1e40af"} 
                      />
                    </View>
                    <View style={styles.drawerMenuTextBox}>
                      <Text style={[styles.drawerMenuLabel, isActive && styles.drawerMenuLabelActive]}>
                        {page.label}
                      </Text>
                      {isActive && (
                        <View style={styles.drawerActiveTag}>
                          <Text style={styles.drawerActiveTagText}>ACTIVE</Text>
                        </View>
                      )}
                    </View>
                    <Ionicons 
                      name="chevron-forward" 
                      size={20} 
                      color={isActive ? "#1e40af" : "#cbd5e1"} 
                    />
                  </TouchableOpacity>
                );
              })}

              {!isWeb && (
                <TouchableOpacity
                  onPress={async () => { 
                    closeDrawer();
                    await logout(); 
                    router.replace("/(auth)/login"); 
                  }}
                  style={styles.drawerLogoutBtn}
                >
                  <View style={styles.drawerLogoutIcon}>
                    <Ionicons name="power" size={22} color="#ef4444" />
                  </View>
                  <Text style={styles.drawerLogoutText}>Sign Out</Text>
                  <Ionicons name="log-out-outline" size={18} color="#ef4444" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              )}
            </ScrollView>
          </Animated.View>
        </Modal>
      )}

      <View style={styles.contentArea}>
        {ready ? renderContent() : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { 
    flex: 1, 
    backgroundColor: '#fafbfc',
  },

  // Premium gradient background
  backgroundGradient: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  gradientTop: {
    position: 'absolute',
    top: -150,
    right: -100,
    width: 500,
    height: 500,
    borderRadius: 250,
    backgroundColor: '#dbeafe',
    opacity: 0.6,
    ...(Platform.OS === 'web' ? { filter: 'blur(100px)' } : {}),
  },
  gradientMiddle: {
    position: 'absolute',
    top: 200,
    left: -120,
    width: 450,
    height: 450,
    borderRadius: 225,
    backgroundColor: '#e0e7ff',
    opacity: 0.5,
    ...(Platform.OS === 'web' ? { filter: 'blur(90px)' } : {}),
  },
  gradientBottom: {
    position: 'absolute',
    bottom: -100,
    right: -80,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: '#ddd6fe',
    opacity: 0.4,
    ...(Platform.OS === 'web' ? { filter: 'blur(85px)' } : {}),
  },

  // Elegant floating orbs
  floatingOrb: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
    ...(Platform.OS === 'web' ? { 
      boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)',
    } : {
      shadowColor: '#3b82f6',
      shadowOpacity: 0.5,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
    }),
  },

  // Decorative elements
  decorativeLine1: {
    position: 'absolute',
    top: 120,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#e2e8f0',
    opacity: 0.6,
  },
  decorativeLine2: {
    position: 'absolute',
    bottom: 200,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#e2e8f0',
    opacity: 0.6,
  },

  // Premium header
  headerContainer: {
    paddingHorizontal: Platform.OS === 'web' ? 28 : 16,
    paddingTop: Platform.OS === 'web' ? 20 : 12,
    zIndex: 10,
  },
  headerCard: {
    position: 'relative',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    ...(Platform.OS === 'web' 
      ? { 
          backdropFilter: 'blur(20px)',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.06), 0 1px 0 rgba(255, 255, 255, 1) inset',
        } 
      : {
          shadowColor: '#0f172a',
          shadowOpacity: 0.08,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        }),
  },
  headerTopAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#1e40af',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  menuButton: {
    marginRight: 16,
  },
  menuButtonInner: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    justifyContent: 'center',
    paddingLeft: 14,
    gap: 4,
  },
  menuLine: {
    width: 20,
    height: 2,
    backgroundColor: '#1e40af',
    borderRadius: 1,
  },
  brandSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoContainer: {
    position: 'relative',
  },
  logoOuter: {
    width: 52,
    height: 52,
    borderRadius: 16,
    padding: 2,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#1e40af',
    ...(Platform.OS === 'web' ? { 
      boxShadow: '0 8px 24px rgba(30, 64, 175, 0.15)',
    } : {
      shadowColor: '#1e40af',
      shadowOpacity: 0.2,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    }),
  },
  logo: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
  },
  logoShine: {
    position: 'absolute',
    inset: -8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#3b82f6',
    opacity: 0.3,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.5,
  },
  brandMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    ...(Platform.OS === 'web' ? { 
      boxShadow: '0 0 10px rgba(16, 185, 129, 0.8)',
    } : {
      shadowColor: '#10b981',
      shadowOpacity: 1,
      shadowRadius: 5,
      shadowOffset: { width: 0, height: 0 },
    }),
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1.2,
  },
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  userAvatarBox: {
    position: 'relative',
  },
  avatarInner: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    borderWidth: 2,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBorder: {
    position: 'absolute',
    inset: -2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#93c5fd',
    opacity: 0.5,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e40af',
  },
  userInfo: {
    maxWidth: 180,
  },
  userNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  userBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  badgeAccent: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3b82f6',
  },
  userRoleText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#3b82f6',
    letterSpacing: 0.8,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#b91c1c',
    ...(Platform.OS === 'web' 
      ? { 
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(220, 38, 38, 0.25)',
        } 
      : {
          shadowColor: '#dc2626',
          shadowOpacity: 0.3,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        }),
  },
  logoutText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.3,
  },

  // Premium navigation bar
  navContainer: {
    position: 'sticky' as any,
    top: 20,
    zIndex: 9,
    paddingHorizontal: 28,
    marginTop: 16,
  },
  navBar: {
    position: 'relative',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.8)',
    padding: 14,
    overflow: 'hidden',
    ...(Platform.OS === 'web'
      ? {
          backdropFilter: 'blur(20px)',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.05), 0 1px 0 rgba(255, 255, 255, 1) inset',
        }
      : {
          shadowColor: '#0f172a',
          shadowOpacity: 0.06,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        }),
  },
  navAccent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#1e40af',
    opacity: 0.15,
  },
  navScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  navTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  navSpecial: {
    marginLeft: 8,
  },

  // Premium navigation tabs
  navTab: {
    position: 'relative',
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    ...(Platform.OS === 'web' 
      ? { 
          cursor: 'pointer',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        } 
      : {}),
  },
  navTabActive: {
    backgroundColor: '#1e40af',
    borderColor: '#1e3a8a',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 8px 24px rgba(30, 64, 175, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1) inset',
        }
      : {
          shadowColor: '#1e40af',
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }),
  },
  tabActiveBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#60a5fa',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tabIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconBoxActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: '#ffffff',
  },
  tabIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#60a5fa',
    marginLeft: 4,
  },

  // Premium drawer
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  drawerPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    backgroundColor: '#ffffff',
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    ...(Platform.OS === 'web'
      ? { boxShadow: '24px 0 80px rgba(15, 23, 42, 0.15)' }
      : {
          shadowColor: '#0f172a',
          shadowOpacity: 0.2,
          shadowRadius: 40,
          shadowOffset: { width: 24, height: 0 },
        }),
  },
  drawerTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#1e40af',
    borderTopRightRadius: 28,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  drawerHeading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  drawerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  drawerMetaDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3b82f6',
  },
  drawerMeta: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  drawerCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerContent: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  drawerSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 1.5,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  drawerMenuItem: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 10,
  },
  drawerMenuItemActive: {
    backgroundColor: '#ffffff',
    borderColor: '#1e40af',
    borderWidth: 2,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 6px 20px rgba(30, 64, 175, 0.15)' }
      : {
          shadowColor: '#1e40af',
          shadowOpacity: 0.2,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
        }),
  },
  drawerActiveLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#1e40af',
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  drawerMenuIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerMenuIconActive: {
    backgroundColor: '#1e40af',
    borderColor: '#1e3a8a',
  },
  drawerMenuTextBox: {
    flex: 1,
  },
  drawerMenuLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    letterSpacing: 0.2,
  },
  drawerMenuLabelActive: {
    color: '#0f172a',
  },
  drawerActiveTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  drawerActiveTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#1e40af',
    letterSpacing: 0.8,
  },
  drawerLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginTop: 24,
    marginBottom: 28,
  },
  drawerLogoutIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerLogoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#dc2626',
    letterSpacing: 0.3,
  },

  // Content area
  contentArea: {
    flex: 1,
    paddingHorizontal: Platform.OS === 'web' ? 28 : 16,
    paddingBottom: 20,
    paddingTop: 20,
  },
});