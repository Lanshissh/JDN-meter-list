// app/(tabs)/admin.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  FlatList,
  TouchableOpacity,
  Modal,
  Image,
  Animated,
  KeyboardAvoidingView,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Ionicons } from "@expo/vector-icons";
import { jwtDecode } from "jwt-decode";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useAuth } from "../../contexts/AuthContext";
import AccountsPanel from "../../components/admin/AccountsPanel";
import BuildingPanel from "../../components/admin/BuildingPanel";
import RatesPanel from "../../components/admin/RatesPanel";
import StallsPanel from "../../components/admin/StallsPanel";
import TenantsPanel from "../../components/admin/TenantsPanel";
import AssignTenantPanel from "../../components/admin/AssignTenantPanel";
import MeterPanel from "../../components/admin/MeterPanel";
import MeterReadingPanel from "../../components/admin/MeterReadingPanel";


export type PageKey =
  | "accounts"
  | "buildings"
  | "rates"
  | "stalls"
  | "tenants"
  | "assign"
  | "meters"
  | "readings";

export type Page = {
  label: string;
  key: PageKey;
  icon: keyof typeof Ionicons.glyphMap;
};

export default function AdminScreen() {
  const router = useRouter();
  const { token, logout } = useAuth();
  // Accept both `panel` (from dashboard deep-link) and legacy `tab`
  const params = useLocalSearchParams<{ panel?: string; tab?: string }>();

  const pages = useMemo<Page[]>(
    () => [
      { label: "Accounts", key: "accounts", icon: "people-outline" },
      { label: "Buildings", key: "buildings", icon: "business-outline" },
      { label: "Rates", key: "rates", icon: "pricetag-outline" },
      { label: "Stalls", key: "stalls", icon: "storefront-outline" },
      { label: "Tenants", key: "tenants", icon: "person-outline" },
      { label: "Assign", key: "assign", icon: "person-add-outline" },
      { label: "Meters", key: "meters", icon: "speedometer-outline" },
      { label: "Readings", key: "readings", icon: "reader-outline" },
    ],
    []
  );

  // --- derive role immediately from token to avoid first-frame admin mount ---
  const role: string = useMemo(() => {
    try {
      if (!token) return "";
      const dec: any = jwtDecode(token);
      return String(dec?.user_level || "").toLowerCase();
    } catch {
      return "";
    }
  }, [token]);

  // Role-based allowed tabs INSIDE Admin
  const roleAllowed: Record<string, Set<PageKey>> = useMemo(
    () => ({
      admin: new Set<PageKey>([
        "accounts",
        "buildings",
        "rates",
        "stalls",
        "assign",
        "tenants",
        "meters",
        "readings",
      ]),
      operator: new Set<PageKey>(["stalls", "tenants", "meters", "readings"]),
      biller: new Set<PageKey>(["rates", "tenants"]), // Tenants read-only enforced inside panel
    }),
    []
  );

  const allowed = roleAllowed[role] ?? roleAllowed.admin;
  const visiblePages = useMemo(
    () => pages.filter((p) => allowed.has(p.key)),
    [pages, allowed]
  );

  // Initial tab per role (prevents admin-only fetch on first frame)
  const roleInitial: Record<string, PageKey> = {
    admin: "accounts",
    operator: "stalls",
    biller: "rates",
  };

  // Resolve initial active tab from URL param (if valid & allowed), else role default
  const resolveInitial = (): PageKey => {
    const wantedParam = String(
      params?.panel || params?.tab || ""
    ).toLowerCase() as PageKey;
    if (wantedParam && allowed.has(wantedParam)) return wantedParam;
    return roleInitial[role] ?? "accounts";
  };

  const [active, setActive] = useState<PageKey>(resolveInitial());

  // keep active in sync if role/visibility/URL param changes
  useEffect(() => {
    const wantedParam = String(
      params?.panel || params?.tab || ""
    ).toLowerCase() as PageKey;
    const allowedSet = roleAllowed[role] ?? roleAllowed.admin;

    if (wantedParam && allowedSet.has(wantedParam)) {
      setActive(wantedParam);
    } else if (!allowedSet.has(active)) {
      setActive(roleInitial[role] ?? "accounts");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, token, params?.panel, params?.tab, allowed.size]);

  // only render content once we know the active tab is allowed
  const ready = visiblePages.some((p) => p.key === active);

  // Welcome modal (first login per user)
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [userInfo, setUserInfo] = useState<{ name?: string; level?: string }>(
    {}
  );

  useEffect(() => {
    if (!token) return;

    try {
      const decoded: any = jwtDecode(token);
      setUserInfo({ name: decoded.user_fullname, level: decoded.user_level });
    } catch {
      // ignore
    }

    // Simple “first time” welcome per session
    setWelcomeVisible((prev) => prev);
  }, [token]);

  // Drawer (mobile)
  const screenW = Dimensions.get("window").width;
  const drawerWidth = Math.min(280, Math.round(screenW * 0.82));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const slideX = useRef(new Animated.Value(-drawerWidth)).current;

  const openDrawer = () => {
    setDrawerOpen(true);
    Animated.timing(slideX, {
      toValue: 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  };

  const closeDrawer = () => {
    Animated.timing(slideX, {
      toValue: -drawerWidth,
      duration: 200,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setDrawerOpen(false);
    });
  };

  const applyRouteParam = (key: PageKey) => {
    // Keep URL/search params in sync for deep linking/back/refresh
    try {
      router.setParams({ panel: key });
    } catch {
      // noop
    }
  };

  const handleSelect = (key: PageKey) => {
    setActive(key);
    applyRouteParam(key);
    if (drawerOpen) closeDrawer();
  };

  const renderContent = () => {
    switch (active) {
      case "accounts":
        return <AccountsPanel token={token} />;
      case "buildings":
        return <BuildingPanel token={token} />;
      case "rates":
        return <RatesPanel token={token} />;
      case "stalls":
        return <StallsPanel token={token} />;
      case "tenants":
        return <TenantsPanel token={token} />;
      case "assign":
        return <AssignTenantPanel token={token} />;
      case "meters":
        return <MeterPanel token={token} />;
      case "readings":
        return <MeterReadingPanel token={token} />;
      default:
        return null;
    }
  };

  const Header = () => (
    <View
      style={[styles.header, Platform.OS !== "web" && styles.headerLowerMobile]}
    >
      {Platform.OS !== "web" && (
        <TouchableOpacity onPress={openDrawer} style={styles.hamburger}>
          <Ionicons name="menu" size={22} color="#102a43" />
        </TouchableOpacity>
      )}

      <View style={styles.headerTitleWrap}>
        <Image
          source={require("../../assets/images/jdn.jpg")}
          style={styles.headerLogo}
        />
        <Text style={styles.headerTitle}>Admin</Text>
      </View>

      {/* WEB: user info + logout on the right */}
      <View style={styles.headerRight}>
        {!!userInfo?.name && (
          <Text style={styles.headerUser} numberOfLines={1}>
            {userInfo.name}
            {userInfo.level ? ` · ${String(userInfo.level).toUpperCase()}` : ""}
          </Text>
        )}

        {Platform.OS === "web" && (
          <TouchableOpacity
            onPress={async () => {
              await logout();
              router.replace("/(auth)/login");
            }}
            style={styles.headerLogoutBtn}
          >
            <Ionicons name="log-out-outline" size={16} color="#fff" />
            <Text style={styles.headerLogoutText}>Logout</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  // Web-only nav chips
  const NavChip = ({
    label,
    icon,
    isActive,
    onPress,
  }: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    isActive: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, isActive && styles.chipActive]}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Ionicons
        name={icon}
        size={16}
        color={isActive ? "#fff" : "#102a43"}
        style={{ marginRight: 6 }}
      />
      <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const NavBarWeb = () => (
    <View style={styles.navbarWeb}>
      {visiblePages.map((p) => (
        <NavChip
          key={p.key}
          label={p.label}
          icon={p.icon}
          isActive={active === p.key}
          onPress={() => handleSelect(p.key)}
        />
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Header />

          {/* WEB-ONLY NAV BAR. On mobile it is hidden (drawer only). */}
          {Platform.OS === "web" && <NavBarWeb />}

          {/* Guard: don’t render any panel until the active tab is allowed */}
          {!ready ? (
            <View
              style={[
                styles.content,
                styles.contentWeb,
                { alignItems: "center", justifyContent: "center" },
              ]}
            >
              <Text style={{ color: "#486581" }}>Loading…</Text>
            </View>
          ) : Platform.OS === "web" ? (
            <View style={[styles.content, styles.contentWeb]}>
              {renderContent()}
            </View>
          ) : (
            <FlatList
              data={[]}
              renderItem={() => null}
              keyExtractor={(_, i) => String(i)}
              ListHeaderComponent={renderContent}
              style={styles.mobileList}
              contentContainerStyle={styles.mobileListContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Drawer (mobile only) */}
      {Platform.OS !== "web" && drawerOpen && (
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.backdrop} onPress={closeDrawer} />
          <Animated.View
            style={[styles.drawer, { left: slideX, width: drawerWidth }]}
          >
            <View style={styles.drawerHeader}>
              <Image
                source={require("../../assets/images/jdn.jpg")}
                style={styles.drawerLogo}
              />
              <TouchableOpacity onPress={closeDrawer} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color="#102a43" />
              </TouchableOpacity>
            </View>

            {/* menu items (role-filtered) */}
            <View style={styles.drawerBody}>
              {visiblePages.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.drawerItem,
                    active === item.key && styles.drawerItemActive,
                  ]}
                  onPress={() => handleSelect(item.key)}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={active === item.key ? "#fff" : "#102a43"}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    style={[
                      styles.drawerItemText,
                      active === item.key && styles.drawerItemTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* LOGOUT pinned to bottom (mobile) */}
            <View style={styles.drawerFooter}>
              <TouchableOpacity
                style={styles.drawerLogout}
                onPress={async () => {
                  closeDrawer();
                  await logout();
                  router.replace("/(auth)/login");
                }}
              >
                <Ionicons name="log-out-outline" size={18} color="#fff" />
                <Text style={styles.drawerLogoutText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      )}

      {/* Welcome modal */}
      <Modal transparent visible={welcomeVisible} animationType="fade">
        <View style={styles.center}>
          <View style={styles.welcomeCard}>
            <Image
              source={require("../../assets/images/jdn.jpg")}
              style={styles.welcomeLogo}
            />
            <Text style={styles.welcomeTitle}>Welcome!</Text>
            {userInfo?.name ? (
              <Text style={styles.welcomeText}>
                Hi {userInfo.name}. Use the tabs to manage what your role
                allows.
              </Text>
            ) : (
              <Text style={styles.welcomeText}>
                Use the tabs to manage what your role allows.
              </Text>
            )}

            <TouchableOpacity
              onPress={() => setWelcomeVisible(false)}
              style={styles.modalBtn}
            >
              <Text style={styles.modalBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f9fc" },
  container: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 6,
    minHeight: 0, // important for RN Web scrolling
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomColor: "#e6eef7",
    borderBottomWidth: 1,
    gap: 10,
  },
  hamburger: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6efff",
  },
  headerTitleWrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd2d9",
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#102a43" },

  // Right side of web header: user + logout
  headerRight: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
  },
  headerUser: { color: "#486581", maxWidth: 240, fontSize: 12 },
  headerLogoutBtn: {
    marginLeft: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ef4444",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  headerLogoutText: { color: "#fff", fontWeight: "700", marginLeft: 6 },
  headerLowerMobile: {
    marginTop: 16,
  },

  // WEB-ONLY nav (chips)
  navbarWeb: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#eef4ff",
    borderWidth: 1,
    borderColor: "#d6e0ff",
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: "#1f4bd8",
    borderColor: "#1f4bd8",
  },
  chipText: { color: "#102a43", fontWeight: "700", fontSize: 13 },
  chipTextActive: { color: "#fff" },

  // Content shells
  content: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e6eef7",
    padding: 10,
    minHeight: 0,
  },
  contentWeb: {
    overflowY: "auto" as any,
  },

  // Mobile parent list wrapper
  mobileList: { flex: 1 },
  mobileListContent: { paddingBottom: 18 },

  // Drawer
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  drawer: {
    backgroundColor: "#fff",
    paddingTop: 12,
    paddingHorizontal: 12,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderWidth: 1,
    borderColor: "#e6eef7",
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  drawerLogo: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd2d9",
  },
  closeBtn: {
    marginLeft: "auto",
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e6efff",
  },
  drawerBody: {
    flex: 1,
    paddingTop: 4,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eef4ff",
    marginBottom: 8,
  },
  drawerItemActive: {
    backgroundColor: "#1f4bd8",
    borderColor: "#1f4bd8",
  },
  drawerItemText: { color: "#102a43", fontWeight: "700" },
  drawerItemTextActive: { color: "#fff" },

  // Drawer footer (Logout)
  drawerFooter: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#e6eef7",
  },
  drawerLogout: {
    backgroundColor: "#ef4444",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  drawerLogoutText: {
    color: "#fff",
    fontWeight: "700",
    marginLeft: 8,
  },

  // Welcome modal
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    padding: 16,
  },
  welcomeCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e6eef7",
    padding: 18,
  },
  welcomeLogo: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignSelf: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#cbd2d9",
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    color: "#102a43",
    marginBottom: 6,
  },
  welcomeText: {
    textAlign: "center",
    color: "#486581",
    marginBottom: 12,
  },
  modalBtn: {
    backgroundColor: "#1f4bd8",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalBtnText: { color: "#fff", fontWeight: "700", textAlign: "center" },
});