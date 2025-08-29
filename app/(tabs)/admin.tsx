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
import { Animated } from "react-native";
import { useRouter } from "expo-router";
import { jwtDecode } from "jwt-decode";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function AdminScreen() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState<
    "accounts" | "buildings" | "rates" | "stalls" | "tenants" | "meters" | "readings"
  >("accounts");
  const slideAnim = useRef(new Animated.Value(-250)).current;
  const drawerWidth = 250;

  const [userInfo, setUserInfo] = useState<{ name: string; level: string } | null>(null);
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  useEffect(() => {
    if (!token) return;

    try {
      const decoded: any = jwtDecode(token);
      setUserInfo({ name: decoded.user_fullname, level: decoded.user_level });
    } catch (err) {
      console.error("Failed to decode token", err);
    }

    (async () => {
      try {
        const decoded: any = jwtDecode(token);
        const key = `welcome_shown_${decoded?.sub || "user"}_${decoded?.exp || "exp"}`;
        const val = await AsyncStorage.getItem(key);
        if (!val) {
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
  ];

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

  // Drawer animation helpers
  const openDrawer = () => {
    setMenuOpen(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const closeDrawer = () => {
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
      <Text style={[styles.navButtonText, isActive && styles.navButtonTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header (web only) */}
      {Platform.OS === "web" && (
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
      )}

      {/* Desktop / Web layout */}
      {Platform.OS === "web" ? (
        <>
          {/* Top nav (web) */}
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

          {/* Page Content (VirtualizedList-backed) */}
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
        <>
          {/* Mobile Header */}
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

          {/* Mobile Content — VirtualizedList-backed */}
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

          {/* Drawer for Mobile */}
          <Modal
            animationType="none"
            transparent={true}
            visible={menuOpen}
            onRequestClose={() => setMenuOpen(false)}
          >
            <View style={styles.drawerOverlay}>
              <Animated.View
                style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}
              >
                <View style={styles.drawerHeader}>
                  <Image
                    source={require("../../assets/images/logo.png")}
                    style={styles.drawerLogo}
                    resizeMode="contain"
                  />
                  <TouchableOpacity onPress={closeDrawer} style={styles.closeBtn}>
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

                {/* 🔒 Logout button pinned to bottom of the drawer */}
                <View style={styles.drawerFooter}>
                  <TouchableOpacity
                    style={styles.drawerLogout}
                    onPress={() => {
                      closeDrawer();
                      logout();
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

              {/* Click-away area */}
              <TouchableOpacity
                style={styles.overlayTouchable}
                onPress={closeDrawer}
                activeOpacity={1}
              />
            </View>
          </Modal>
        </>
      )}

      {/* Welcome modal (shown once per login) */}
      <Modal visible={welcomeVisible} transparent animationType="fade">
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Ionicons
              name="checkmark-circle"
              size={48}
              color="#1f4bd8"
              style={{ marginBottom: 12 }}
            />
            <Text style={styles.modalTitle}>Welcome, {userInfo?.name}</Text>
            <Text style={styles.modalSubtitle}>
              {userInfo?.level?.toUpperCase()}
            </Text>

            <TouchableOpacity
              style={styles.okButton}
              onPress={() => setWelcomeVisible(false)}
            >
              <Text style={styles.okButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f7fb" },

  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#edf2f7",
  },

  headerLeft: { flexDirection: "row", alignItems: "center" },
  logoWrap: { marginLeft: 10 },
  logo: { height: 30, width: 110 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  userText: { color: "#102a43", fontWeight: "700" },

  navBar: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#edf2f7",
    paddingVertical: 8,
  },
  navButtons: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
  },
  navButtonActive: { backgroundColor: "#1f4bd8", borderColor: "#1f4bd8" },
  navButtonText: { color: "#102a43", fontWeight: "700" },
  navButtonTextActive: { color: "#fff" },

  container: {
    gap: 16,
    padding: 16,
  },

  mobileHeader: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#edf2f7",
    paddingHorizontal: 10,
    justifyContent: "space-between",
    marginTop: 25, // ← requested top margin on mobile
  },
  menuIconWrap: {
    height: 40,
    width: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef2ff",
  },
  logoContainer: {
    flex: 1,
    alignItems: "center",
    marginBottom: 20,
  },
  mobileLogo: { height: 30, width: 110 },

  // Drawer
  drawerOverlay: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  overlayTouchable: { flex: 1 },
  drawer: {
    width: 250,
    backgroundColor: "#fff",
    paddingTop: 20,
    paddingBottom: 20,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  drawerLogo: { height: 40, width: 120 },
  closeBtn: { marginLeft: "auto" },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  drawerItemActive: { backgroundColor: "#1f4bd8" },
  drawerItemText: { fontSize: 16, color: "#102a43" },

  // Drawer footer with logout
  drawerFooter: {
    marginTop: "auto",
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  drawerLogout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
  },
  drawerLogoutText: { color: "#fff", fontWeight: "700" },

  // Welcome modal styles
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
  },
  modalTitle: { fontWeight: "800", fontSize: 18, color: "#102a43", marginBottom: 6, textAlign: "center" },
  modalSubtitle: { color: "#627d98", marginBottom: 16, textAlign: "center" },
  okButton: {
    marginTop: 8,
    backgroundColor: "#1f4bd8",
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: "center",
  },
  okButtonText: { color: "#fff", fontWeight: "700" },
});