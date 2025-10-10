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

  const pages: Page[] = useMemo(
    () => [
      { label: "Accounts", key: "accounts", icon: "people-outline" }, // right side
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

  // role
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

  // initial
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token, params?.panel, params?.tab, allowed.size]);

  const ready = visiblePages.some((p) => p.key === active);

  // user info (name, level)
  const [userInfo, setUserInfo] = useState<{ name?: string; level?: string }>({});
  useEffect(() => {
    if (!token) return;
    try {
      const dec: any = jwtDecode(token);
      setUserInfo({ name: dec.user_fullname, level: dec.user_level });
    } catch {}
  }, [token]);

  // drawer (mobile)
  const screenW = Dimensions.get("window").width;
  const drawerWidth = Math.min(300, Math.round(screenW * 0.86));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideX = useRef(new Animated.Value(-drawerWidth)).current;
  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.timing(slideX, { toValue: 0, duration: 220, useNativeDriver: false }).start();
  };
  const closeDrawer = () => {
    Animated.timing(slideX, { toValue: -drawerWidth, duration: 200, useNativeDriver: false }).start(({ finished }) => {
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

  // render content
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

  /* ---------- header ---------- */
  const Header = () => (
    <View style={styles.headerWrap}>
      {Platform.OS !== "web" && (
        <TouchableOpacity onPress={openDrawer} style={styles.hamburger}>
          <Ionicons name="menu" size={22} color="#0f2741" />
        </TouchableOpacity>
      )}

      <View style={styles.brandRow}>
        <Image source={require("../../assets/images/jdn.jpg")} style={styles.logo} />
        <Text style={styles.brand}>Admin</Text>
      </View>

      <View style={styles.headerRight}>
        {!!userInfo?.name && (
          <Text style={styles.userText} numberOfLines={1}>
            {userInfo.name}{userInfo.level ? ` · ${String(userInfo.level).toUpperCase()}` : ""}
          </Text>
        )}
        {Platform.OS === "web" && (
          <TouchableOpacity
            onPress={async () => { await logout(); router.replace("/(auth)/login"); }}
            style={styles.logoutBtn}
          >
            <Ionicons name="log-out-outline" size={16} color="#fff" />
            <Text style={styles.logoutTxt}>Logout</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  /* ---------- nav pill ---------- */
  const NavPill = ({
    label, icon, isActive, onPress,
  }: { label: string; icon: keyof typeof Ionicons.glyphMap; isActive: boolean; onPress: () => void; }) => {
    const scale = useRef(new Animated.Value(1)).current;
    const onDown = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 3 }).start();
    const onUp = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

    return (
      <Animated.View style={{ transform: [{ scale }], borderRadius: 999 }}>
        <TouchableOpacity
          onPressIn={onDown}
          onPressOut={onUp}
          onPress={onPress}
          style={[styles.pill, isActive && styles.pillActive]}
        >
          <Ionicons name={icon} size={14} color={isActive ? "#fff" : "#2e4b6b"} />
          <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{label}</Text>
          {isActive && <View style={styles.neonEdge} />}
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
      {/* airy pastel blobs */}
      <View style={styles.bgBlobA} />
      <View style={styles.bgBlobB} />
      <View style={styles.bgBlobC} />

      <Header />

      {/* sticky navbar on web */}
      {Platform.OS === "web" && (
        <View style={styles.navHolder}>
          <View style={styles.navbar}>
            <View style={styles.navLeft}>
              {leftItems.map((p) => (
                <NavPill
                  key={p.key}
                  label={p.label}
                  icon={p.icon}
                  isActive={active === p.key}
                  onPress={() => handleSelect(p.key)}
                />
              ))}
            </View>

            {showAccounts && (
              <View style={styles.navRight}>
                <NavPill
                  label="Accounts"
                  icon="people-outline"
                  isActive={active === "accounts"}
                  onPress={() => handleSelect("accounts")}
                />
              </View>
            )}
          </View>
        </View>
      )}

      {/* mobile drawer */}
      {Platform.OS !== "web" && (
        <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={closeDrawer}>
          <TouchableOpacity style={styles.drawerBackdrop} activeOpacity={1} onPress={closeDrawer}>
            <Animated.View style={[styles.drawer, { width: drawerWidth, transform: [{ translateX: slideX }] }]}>
              <Text style={styles.drawerTitle}>Navigate</Text>
              {leftOrder.concat(showAccounts ? ["accounts"] as PageKey[] : []).map((k) => {
                const page = visiblePages.find((p) => p.key === k);
                if (!page) return null;
                const isActive = active === page.key;
                return (
                  <TouchableOpacity
                    key={page.key}
                    onPress={() => handleSelect(page.key)}
                    style={[styles.drawerItem, isActive && styles.drawerItemActive]}
                  >
                    <Ionicons name={page.icon} size={18} color={isActive ? "#fff" : "#2e4b6b"} />
                    <Text style={[styles.drawerText, isActive && styles.drawerTextActive]}>{page.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </Animated.View>
          </TouchableOpacity>
        </Modal>
      )}

      <View style={styles.body}>
        {ready ? renderContent() : null}
      </View>
    </SafeAreaView>
  );
}

/* ===================== styles ===================== */
const BG = "#f6f9ff";                 // light canvas
const CARD = "rgba(255,255,255,0.8)";
const BORDER = "rgba(16, 42, 67, 0.12)";
const TEXT = "#0f2741";
const MUTED = "#4f6b86";
const BRAND = "#082cac";               // brand-blue accent
const BRAND_SOFT = "rgba(8,44,172,0.14)";

const GLASS = {
  backgroundColor: "rgba(255,255,255,0.72)",
  borderColor: BORDER,
  borderWidth: 1,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },

  /* ambient light blobs */
  bgBlobA: {
    position: "absolute", top: -80, right: -60, width: 320, height: 240,
    borderRadius: 240,
    backgroundColor: "rgba(8,44,172,0.10)",
    transform: [{ rotate: "10deg" }],
    ...(Platform.OS === "web" ? { filter: "blur(40px)" } : {}),
  },
  bgBlobB: {
    position: "absolute", top: 120, left: -70, width: 300, height: 220,
    borderRadius: 220,
    backgroundColor: "rgba(14,165,233,0.10)",
    transform: [{ rotate: "-8deg" }],
    ...(Platform.OS === "web" ? { filter: "blur(46px)" } : {}),
  },
  bgBlobC: {
    position: "absolute", bottom: -80, right: -40, width: 280, height: 200,
    borderRadius: 200,
    backgroundColor: "rgba(255,255,255,0.6)",
    ...(Platform.OS === "web" ? { filter: "blur(34px)" } : {}),
  },

  /* header glass */
  headerWrap: {
    marginHorizontal: 10,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    ...GLASS,
    ...(Platform.OS === "web"
      ? { backdropFilter: "blur(10px)", boxShadow: "0 10px 24px rgba(8,44,172,0.08)" }
      : { shadowColor: BRAND, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } }),
  },
  hamburger: { padding: 10, marginRight: 6, borderRadius: 12, backgroundColor: "rgba(8,44,172,0.08)" },
  brandRow: { flexDirection: "row", alignItems: "center" },
  logo: { width: 28, height: 28, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: "rgba(0,0,0,0.06)" },
  brand: { fontSize: 18, fontWeight: "800", color: TEXT, letterSpacing: 0.3 },
  headerRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
  userText: { color: MUTED, fontSize: 12, maxWidth: 260 },
  logoutBtn: {
    backgroundColor: BRAND,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    ...(Platform.OS === "web" ? { cursor: "pointer" } : null),
  },
  logoutTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },

  /* sticky navbar wrapper (web) */
  navHolder: {
    position: "sticky" as any,
    top: 8,
    zIndex: 5,
    marginHorizontal: 10,
  },
  navbar: {
    marginTop: 8,
    padding: 8,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    ...GLASS,
    ...(Platform.OS === "web"
      ? { backdropFilter: "blur(12px)", boxShadow: "0 12px 32px rgba(8,44,172,0.10)" }
      : { shadowColor: BRAND, shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 10 } }),
  },
  navLeft: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", flex: 1 },
  navRight: { marginLeft: "auto", flexDirection: "row" },

  /* neon-light pills (light theme) */
  pill: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "box-shadow 140ms ease, transform 140ms ease" } : {}),
  },
  pillActive: {
    backgroundColor: BRAND,
    borderColor: BRAND,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 0 0 3px rgba(8,44,172,0.22), 0 10px 26px rgba(8,44,172,0.32)" }
      : {
          shadowColor: BRAND,
          shadowOpacity: 0.28,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 8 },
        }),
  },
  neonEdge: {
    position: "absolute",
    inset: 0 as any,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(8,44,172,0.35)",
    opacity: 0.7,
  },
  pillText: { color: "#2e4b6b", fontWeight: "700", fontSize: 12.5, letterSpacing: 0.2 },
  pillTextActive: { color: "#fff" },

  /* drawer (mobile) */
  drawerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.18)" },
  drawer: {
    height: "100%",
    backgroundColor: "rgba(255,255,255,0.98)",
    paddingTop: 18,
    paddingHorizontal: 12,
  },
  drawerTitle: { fontSize: 14, color: TEXT, fontWeight: "900", marginBottom: 12 },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(8,44,172,0.06)",
    marginBottom: 8,
  },
  drawerItemActive: { backgroundColor: BRAND },
  drawerText: { color: TEXT, fontSize: 14, fontWeight: "800" },
  drawerTextActive: { color: "#fff" },

  /* body */
  body: { flex: 1, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 10 },
});