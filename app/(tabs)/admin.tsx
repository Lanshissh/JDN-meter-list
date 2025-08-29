import React, { useState, useRef, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Platform,
  FlatList,
  TouchableOpacity,
  Modal,
  Image,
  Animated,
} from "react-native";
import { useAuth } from "../../contexts/AuthContext";
import AccountsPanel from "../../components/admin/AccountsPanel";
import BuildingPanel from "../../components/admin/BuildingPanel";
import RatesPanel from "../../components/admin/RatesPanel";
import StallsPanel from "../../components/admin/StallsPanel";
import MeterPanel from "../../components/admin/MeterPanel";
import MeterReadingPanel from "../../components/admin/MeterReadingPanel";
import TenantsPanel from "../../components/admin/TenantsPanel";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { jwtDecode } from "jwt-decode";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function AdminScreen() {
  const { token, logout } = useAuth();
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState<
    | "accounts"
    | "buildings"
    | "rates"
    | "stalls"
    | "tenants"
    | "meters"
    | "readings"
  >("accounts");

  // drawer animation (mobile only)
  const drawerWidth = 250;
  const slideAnim = useRef(new Animated.Value(-drawerWidth)).current;

  const [userInfo, setUserInfo] = useState<{
    name: string;
    level: string;
  } | null>(null);
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  useEffect(() => {
    if (!token) return;

    try {
      const decoded: any = jwtDecode(token);
      setUserInfo({ name: decoded.user_fullname, level: decoded.user_level });
    } catch {}

    (async () => {
      try {
        const decoded: any = jwtDecode(token);
        const key = `welcome_shown_${decoded?.sub || "user"}_${decoded?.exp || "exp"}`;
        if (!(await AsyncStorage.getItem(key))) {
          setWelcomeVisible(true);
          await AsyncStorage.setItem(key, "1");
        }
      } catch {}
    })();
  }, [token]);

  const pages = [
    { label: "Accounts", key: "accounts", icon: "people-outline" },
    { label: "Buildings", key: "buildings", icon: "business-outline" },
    { label: "Rates", key: "rates", icon: "pricetag-outline" },
    { label: "Stalls", key: "stalls", icon: "storefront-outline" },
    { label: "Tenants", key: "tenants", icon: "person-outline" },
    { label: "Meters", key: "meters", icon: "speedometer-outline" },
    { label: "Meter Readings", key: "readings", icon: "reader-outline" },
  ] as const;

  const renderContent = () => {
    switch (activePage) {
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
      case "meters":
        return <MeterPanel token={token} />;
      case "readings":
        return <MeterReadingPanel token={token} />;
      default:
        return null;
    }
  };

  // ---- Drawer controls (mobile only) ----
  const openDrawer = () => {
    if (Platform.OS === "web") return; // hard guard
    setMenuOpen(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };
  const closeDrawer = () => {
    if (Platform.OS === "web") return;
    Animated.timing(slideAnim, {
      toValue: -drawerWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setMenuOpen(false));
  };

  const NavButton = ({
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
      style={[styles.navButton, isActive && styles.navButtonActive]}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={isActive ? "#fff" : "#102a43"}
        style={{ marginRight: 6 }}
      />
      <Text
        style={[styles.navButtonText, isActive && styles.navButtonTextActive]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* ----- WEB LAYOUT (no drawer here) ----- */}
      {Platform.OS === "web" ? (
        <>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.logoWrap}>
                <Image
                  source={require("../../assets/images/logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                />
              </View>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.userText}>
                {userInfo?.name} · {userInfo?.level?.toUpperCase()}
              </Text>
            </View>
          </View>

          {/* Top nav */}
          <View style={styles.navBar}>
            <View style={styles.navButtons}>
              {pages.map((item) => (
                <NavButton
                  key={item.key}
                  label={item.label}
                  icon={item.icon as any}
                  isActive={activePage === item.key}
                  onPress={() => setActivePage(item.key as any)}
                />
              ))}
            </View>
          </View>

          {/* Content */}
          <FlatList
            data={[]}
            renderItem={() => null}
            keyExtractor={(_, i) => String(i)}
            ListHeaderComponent={renderContent}
            contentContainerStyle={styles.container}
            nestedScrollEnabled
          />
        </>
      ) : (
        // ----- MOBILE LAYOUT (drawer lives only here) -----
        <>
          <View style={styles.mobileHeader}>
            <TouchableOpacity onPress={openDrawer} style={styles.menuIconWrap}>
              <Ionicons name="menu" size={24} color="#102a43" />
            </TouchableOpacity>
            <View style={styles.logoContainer}>
              <Image
                source={require("../../assets/images/logo.png")}
                style={styles.mobileLogo}
                resizeMode="contain"
              />
            </View>
            <View style={{ width: 30 }} />
          </View>

          <FlatList
            style={{ flex: 1 }}
            data={[]}
            renderItem={() => null}
            keyExtractor={(_, i) => String(i)}
            ListHeaderComponent={renderContent}
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          />

          {/* Drawer (MOBILE ONLY) */}
          <Modal
            animationType="none"
            transparent
            visible={menuOpen}
            onRequestClose={closeDrawer}
          >
            <View style={styles.drawerOverlay}>
              <Animated.View
                style={[
                  styles.drawer,
                  { transform: [{ translateX: slideAnim }] },
                ]}
              >
                <View style={styles.drawerHeader}>
                  <Image
                    source={require("../../assets/images/logo.png")}
                    style={styles.drawerLogo}
                    resizeMode="contain"
                  />
                  <TouchableOpacity
                    onPress={closeDrawer}
                    style={styles.closeBtn}
                  >
                    <Ionicons name="close" size={24} color="#102a43" />
                  </TouchableOpacity>
                </View>

                {pages.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.drawerItem,
                      activePage === item.key && styles.drawerItemActive,
                    ]}
                    onPress={() => {
                      setActivePage(item.key as any);
                      closeDrawer();
                    }}
                  >
                    <Ionicons
                      name={item.icon as any}
                      size={18}
                      color={activePage === item.key ? "#fff" : "#102a43"}
                      style={{ marginRight: 8 }}
                    />
                    <Text
                      style={[
                        styles.drawerItemText,
                        activePage === item.key && { color: "#fff" },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}

                {/* Logout pinned to bottom */}
                <View style={styles.drawerFooter}>
                  <TouchableOpacity
                    style={styles.drawerLogout}
                    onPress={async () => {
                      closeDrawer();
                      await logout();
                      router.replace("/(auth)/login");
                    }}
                  >
                    <Ionicons
                      name="log-out-outline"
                      size={18}
                      color="#fff"
                      style={{ marginRight: 8 }}
                    />
                    <Text style={styles.drawerLogoutText}>Logout</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>

              {/* Click-away to close */}
              <TouchableOpacity
                style={styles.overlayTouchable}
                onPress={closeDrawer}
                activeOpacity={1}
              />
            </View>
          </Modal>
        </>
      )}

      {/* (Welcome modal left as-is) */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f9fbfd" },

  // header (web)
  header: {
    height: 60,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6ecf1",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: { flexDirection: "row", alignItems: "center" },
  headerRight: {},
  logoWrap: { width: 110, height: 40, justifyContent: "center" },
  logo: { width: 110, height: 40 },
  userText: { color: "#102a43", fontWeight: "600" },

  // top nav (web)
  navBar: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6ecf1",
  },
  navButtons: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexWrap: "wrap",
    gap: 8,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eef2f7",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  navButtonActive: { backgroundColor: "#082cac" },
  navButtonText: { color: "#102a43", fontWeight: "600" },
  navButtonTextActive: { color: "#fff" },

  // content wrapper
  container: { padding: 16 },

  // mobile header
  mobileHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    paddingHorizontal: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6ecf1",
    marginTop: 30,
  },
  menuIconWrap: { padding: 8, borderRadius: 8 },
  logoContainer: { flex: 1, alignItems: "center" },
  mobileLogo: { width: 100, height: 50 },

  // drawer (mobile)
  drawerOverlay: { flex: 1, flexDirection: "row" },
  overlayTouchable: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)" },
  drawer: {
    width: 250,
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: "#e6ecf1",
  },
  drawerHeader: { flexDirection: "row", alignItems: "center" },
  drawerLogo: { width: 120, height: 40 },
  closeBtn: { marginLeft: "auto", padding: 6, borderRadius: 8 },

  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginTop: 6,
  },
  drawerItemActive: { backgroundColor: "#082cac" },
  drawerItemText: { color: "#102a43", fontWeight: "600" },

  drawerFooter: { marginTop: "auto" },
  drawerLogout: {
    backgroundColor: "#d32f2f",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  drawerLogoutText: { color: "#fff", fontWeight: "700" },
});
