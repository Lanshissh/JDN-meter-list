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
    <View style={styles.headerWrap}>
      {Platform.OS !== "web" && (
        <TouchableOpacity onPress={openDrawer} style={styles.hamburger}>
          <Ionicons name="menu" size={22} color="#2563eb" />
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
  const NavPill = ({
    label, icon, isActive, onPress,
  }: { label: string; icon: keyof typeof Ionicons.glyphMap; isActive: boolean; onPress: () => void; }) => {
    const scale = useRef(new Animated.Value(1)).current;
    const onDown = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 3 }).start();
    const onUp = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
    return (
      <Animated.View style={{ transform: [{ scale }], borderRadius: 8 }}>
        <TouchableOpacity
          onPressIn={onDown}
          onPressOut={onUp}
          onPress={onPress}
          style={[styles.pill, isActive && styles.pillActive]}
        >
          <Ionicons name={icon} size={15} color={isActive ? "#fff" : "#64748b"} />
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
      <View style={styles.bgBlobA} />
      <View style={styles.bgBlobB} />
      <View style={styles.bgBlobC} />
      <Header />
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
                    <Ionicons name={page.icon} size={18} color={isActive ? "#2563eb" : "#64748b"} />
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
const BG = "#fafbfc";                 
const CARD = "#ffffff";
const BORDER = "rgba(15, 23, 42, 0.08)";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BRAND = "#2563eb";               
const BRAND_SOFT = "rgba(37, 99, 235, 0.08)";
const BRAND_HOVER = "#1e40af";
const GLASS = {
  backgroundColor: "#ffffff",
  borderColor: BORDER,
  borderWidth: 1,
};
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  bgBlobA: {
    position: "absolute", 
    top: 0, 
    right: 0, 
    width: "100%", 
    height: 200,
    opacity: 0.4,
    ...(Platform.OS === "web" ? { 
      background: "linear-gradient(135deg, rgba(37, 99, 235, 0.03) 0%, transparent 50%)" 
    } : { backgroundColor: "rgba(37, 99, 235, 0.02)" }),
  },
  bgBlobB: {
    position: "absolute", 
    display: "none",
  },
  bgBlobC: {
    position: "absolute", 
    display: "none",
  },
  headerWrap: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    ...GLASS,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)" }
      : { 
          shadowColor: "#0f172a", 
          shadowOpacity: 0.06, 
          shadowRadius: 3, 
          shadowOffset: { width: 0, height: 1 } 
        }),
  },
  hamburger: { 
    padding: 8, 
    marginRight: 8, 
    borderRadius: 8, 
    backgroundColor: BRAND_SOFT,
  },
  brandRow: { flexDirection: "row", alignItems: "center" },
  logo: { 
    width: 32, 
    height: 32, 
    borderRadius: 8, 
    marginRight: 10, 
    borderWidth: 1, 
    borderColor: BORDER,
  },
  brand: { 
    fontSize: 20, 
    fontWeight: "700", 
    color: TEXT, 
    letterSpacing: -0.3 
  },
  headerRight: { 
    marginLeft: "auto", 
    flexDirection: "row", 
    alignItems: "center", 
    gap: 12 
  },
  userText: { 
    color: MUTED, 
    fontSize: 13, 
    fontWeight: "500",
    maxWidth: 260 
  },
  logoutBtn: {
    backgroundColor: TEXT,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    ...(Platform.OS === "web" ? { 
      cursor: "pointer",
      transition: "all 150ms ease",
    } : null),
  },
  logoutTxt: { 
    color: "#fff", 
    fontWeight: "600", 
    fontSize: 13 
  },
  navHolder: {
    position: "sticky" as any,
    top: 12,
    zIndex: 5,
    marginHorizontal: 16,
  },
  navbar: {
    marginTop: 12,
    padding: 6,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...GLASS,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 3px rgba(15, 23, 42, 0.06)" }
      : { 
          shadowColor: "#0f172a", 
          shadowOpacity: 0.06, 
          shadowRadius: 3, 
          shadowOffset: { width: 0, height: 1 } 
        }),
  },
  navLeft: { 
    flexDirection: "row", 
    flexWrap: "wrap", 
    gap: 6, 
    alignItems: "center", 
    flex: 1 
  },
  navRight: { 
    marginLeft: "auto", 
    flexDirection: "row" 
  },
  pill: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: "transparent",
    borderWidth: 0,
    ...(Platform.OS === "web" ? { 
      cursor: "pointer", 
      transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
    } : {}),
  },
  pillActive: {
    backgroundColor: BRAND,
    borderWidth: 0,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2), 0 0 0 1px rgba(37, 99, 235, 0.1)" }
      : {
          shadowColor: BRAND,
          shadowOpacity: 0.2,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
        }),
  },
  neonEdge: {
    display: "none",
  },
  pillText: { 
    color: MUTED, 
    fontWeight: "600", 
    fontSize: 13.5, 
    letterSpacing: -0.1 
  },
  pillTextActive: { 
    color: "#fff",
    fontWeight: "600",
  },
  drawerBackdrop: { 
    flex: 1, 
    backgroundColor: "rgba(15, 23, 42, 0.4)" 
  },
  drawer: {
    height: "100%",
    backgroundColor: "#ffffff",
    paddingTop: 24,
    paddingHorizontal: 16,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  drawerTitle: { 
    fontSize: 11, 
    color: MUTED, 
    fontWeight: "700", 
    marginBottom: 16,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "transparent",
    marginBottom: 4,
  },
  drawerItemActive: { 
    backgroundColor: BRAND_SOFT,
    borderLeftWidth: 3,
    borderLeftColor: BRAND,
  },
  drawerText: { 
    color: TEXT, 
    fontSize: 15, 
    fontWeight: "600" 
  },
  drawerTextActive: { 
    color: BRAND,
    fontWeight: "600",
  },
  body: { 
    flex: 1, 
    paddingHorizontal: 16, 
    paddingBottom: 16, 
    paddingTop: 12 
  },
});