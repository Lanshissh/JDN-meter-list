// app/(tabs)/admin.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Platform,
  FlatList,
  TouchableOpacity,
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

type PageKey =
  | "accounts"
  | "buildings"
  | "rates"
  | "stalls"
  | "tenants"
  | "meters"
  | "readings";

export default function AdminScreen() {
  const { token } = useAuth();
  const router = useRouter();

  const role = useMemo(() => {
    try {
      const dec: any = token ? jwtDecode(token) : null;
      return String(dec?.user_level || "").toLowerCase();
    } catch {
      return "";
    }
  }, [token]);

  // Gate readers out of Admin entirely
  useEffect(() => {
    if (role === "reader") router.replace("/(tabs)/scanner");
  }, [role, router]);

  // Build role-allowed pages
  const allowedPages: { label: string; key: PageKey; icon: keyof typeof Ionicons.glyphMap }[] =
    useMemo(() => {
      if (role === "admin")
        return [
          { label: "Accounts", key: "accounts", icon: "people-outline" },
          { label: "Buildings", key: "buildings", icon: "business-outline" },
          { label: "Rates", key: "rates", icon: "pricetag-outline" },
          { label: "Stalls", key: "stalls", icon: "storefront-outline" },
          { label: "Tenants", key: "tenants", icon: "person-outline" },
          { label: "Meters", key: "meters", icon: "speedometer-outline" },
          { label: "Meter Readings", key: "readings", icon: "reader-outline" },
        ];
      if (role === "operator")
        return [
          { label: "Stalls", key: "stalls", icon: "storefront-outline" },
          { label: "Tenants", key: "tenants", icon: "person-outline" },
          { label: "Meters", key: "meters", icon: "speedometer-outline" },
          { label: "Meter Readings", key: "readings", icon: "reader-outline" },
        ];
      if (role === "biller")
        return [
          { label: "Rates", key: "rates", icon: "pricetag-outline" },
          { label: "Tenants", key: "tenants", icon: "person-outline" }, // read-only
        ];
      return [];
    }, [role]);

  const [activePage, setActivePage] = useState<PageKey>(
    allowedPages[0]?.key ?? "stalls"
  );

  // Drawer UI (kept)
  const [menuOpen, setMenuOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-250)).current;
  const drawerWidth = 250;
  const openDrawer = () => {
    setMenuOpen(true);
    Animated.timing(slideAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
  };
  const closeDrawer = () => {
    Animated.timing(slideAnim, { toValue: -drawerWidth, duration: 200, useNativeDriver: true }).start(() => setMenuOpen(false));
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
      <Ionicons name={icon} size={18} color={isActive ? "#fff" : "#102a43"} style={{ marginRight: 6 }} />
      <Text style={[styles.navButtonText, isActive && styles.navButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

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
        // 👉 biller sees Tenants read-only; others unchanged
        return <TenantsPanel token={token} readOnly={role === "biller"} />;
      case "meters":
        return <MeterPanel token={token} />;
      case "readings":
        return <MeterReadingPanel token={token} />;
      default:
        return null;
    }
  };

  // If a reader somehow lands here before redirect
  if (role === "reader") return null;

  return (
    <SafeAreaView style={styles.safe}>
      {/* (web) header kept from your original file */}
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
          <View style={styles.headerRight} />
        </View>
      )}

      {/* Web: top nav made from allowedPages only */}
      {Platform.OS === "web" ? (
        <>
          <View style={styles.navBar}>
            <View style={styles.navButtons}>
              {allowedPages.map((item) => (
                <NavButton
                  key={item.key}
                  label={item.label}
                  icon={item.icon}
                  isActive={activePage === item.key}
                  onPress={() => setActivePage(item.key)}
                />
              ))}
            </View>
          </View>

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
        // Mobile header/drawer kept, but menu shows only allowedPages
        <>
          <View style={styles.mobileHeader}>
            <TouchableOpacity onPress={openDrawer} style={styles.menuIconWrap}>
              <Ionicons name="menu" size={24} color="#102a43" />
            </TouchableOpacity>
            <View style={styles.logoContainer}>
              <Image
                source={require("../../assets/images/logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          </View>

          <Animated.View
            style={[
              styles.drawer,
              { transform: [{ translateX: slideAnim }] },
              { width: drawerWidth },
            ]}
          >
            <View style={styles.drawerContent}>
              {allowedPages.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.drawerItem,
                    activePage === item.key && styles.drawerItemActive,
                  ]}
                  onPress={() => {
                    setActivePage(item.key);
                    closeDrawer();
                  }}
                >
                  <Ionicons
                    name={item.icon}
                    size={18}
                    color={activePage === item.key ? "#fff" : "#102a43"}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={[
                      styles.drawerItemText,
                      activePage === item.key && styles.drawerItemTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>

          <View style={styles.mobileContent}>{renderContent()}</View>
        </>
      )}
    </SafeAreaView>
  );
}

// --- styles borrowed from your original file ---
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f7f9fc" },
  header: { height: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: "#eee", backgroundColor: "#fff" },
  headerLeft: { flex: 1, flexDirection: "row", alignItems: "center"},
  logoWrap: { width: 40, height: 40 },
  logo: { width: 70, height: 70, marginRight: 30 },
  headerRight: { },

  navBar: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#eee" },
  navButtons: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  navButton: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#f1f5f9" },
  navButtonActive: { backgroundColor: "#102a43" },
  navButtonText: { color: "#102a43", fontWeight: "600" },
  navButtonTextActive: { color: "#fff" },

  mobileHeader: { height: 56, backgroundColor: "#fff", flexDirection: "row", alignItems: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "#eee", marginTop: 30 },
  menuIconWrap: { padding: 8 },
  logoContainer: { flex: 1, alignItems: "center" },

  drawer: { position: "absolute", top: 50, left: 0, bottom: 0, backgroundColor: "#fff", borderRightWidth: 1, borderRightColor: "#eee", zIndex: 1000 },
  drawerContent: { paddingVertical: 8 },
  drawerItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  drawerItemActive: { backgroundColor: "#102a43" },
  drawerItemText: { color: "#102a43", fontWeight: "600" },
  drawerItemTextActive: { color: "#fff" },

  container: { padding: 16 },
  mobileContent: { flex: 1 },
});
