import React, { useState, useRef, useEffect } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
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
import { LogBox } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

LogBox.ignoreLogs([
  "VirtualizedLists should never be nested inside plain ScrollViews"
]);
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

  // decode for display (same as before)
  try {
    const decoded: any = jwtDecode(token);
    setUserInfo({ name: decoded.user_fullname, level: decoded.user_level });
  } catch (err) {
    console.error("Failed to decode token", err);
  }

  // show-once-per-login
  (async () => {
    // make a per-login session key; using part of the JWT is enough
    const sessionKey = `welcome-shown:${token.slice(-16)}`;
    const already = await AsyncStorage.getItem(sessionKey);

    if (!already) {
      setWelcomeVisible(true);          // show only once per token
      await AsyncStorage.setItem(sessionKey, "1");
    }
  })();
}, [token]);


  const menuItems = [
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
        return <AccountsPanel token={token} />;
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/(auth)/login");
  };

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: menuOpen ? 0 : -drawerWidth,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [menuOpen]);


  
  return (
    <SafeAreaView style={styles.safe}>
      {/* Welcome Modal */}
      <Modal
        visible={welcomeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWelcomeVisible(false)}
      >
        <View style={styles.modalOverlay}>
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
              activeOpacity={0.85}
            >
              <Text style={styles.okButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {Platform.OS === "web" ? (
        <>
          {/* Web Navigation */}
          <View style={styles.webNav}>
            <Image
              source={require("../../assets/images/logo.png")}
              style={styles.webLogo}
              resizeMode="contain"
            />
            <View style={styles.navCenter}>
              {menuItems.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.navButton,
                    activePage === item.key && styles.navButtonActive,
                  ]}
                  onPress={() => setActivePage(item.key as any)}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={18}
                    color={
                      activePage === item.key ? "#503dffff" : "#102a43"
                    }
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.navButtonText,
                      activePage === item.key && styles.navButtonTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Page Content */}
          <ScrollView contentContainerStyle={styles.container}>
            {renderContent()}
          </ScrollView>
        </>
      ) : (
        <>
          {/* Mobile Header */}
          <View style={styles.mobileHeader}>
            <TouchableOpacity onPress={() => setMenuOpen(true)}>
              <Ionicons name="menu" size={30} color="#297fffff" />
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

          {/* Mobile Content with scroll fix */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
          >
            {renderContent()}
          </ScrollView>

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
                  <TouchableOpacity
                    style={styles.closeBtn}
                    onPress={() => setMenuOpen(false)}
                  >
                    <Ionicons name="close" size={24} color="#102a43" />
                  </TouchableOpacity>
                </View>

                {menuItems.map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.drawerItem,
                      activePage === item.key && styles.drawerItemActive,
                    ]}
                    onPress={() => {
                      setActivePage(item.key as any);
                      setMenuOpen(false);
                    }}
                  >
                    <Ionicons
                      name={item.icon as any}
                      size={20}
                      color={
                        activePage === item.key ? "#fff" : "#102a43"
                      }
                      style={{ marginRight: 10 }}
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

                <TouchableOpacity
                  style={[styles.drawerItem, { marginTop: 20 }]}
                  onPress={handleLogout}
                >
                  <Ionicons
                    name="log-out-outline"
                    size={20}
                    color="#d9534f"
                    style={{ marginRight: 10 }}
                  />
                  <Text style={{ color: "#d9534f", fontWeight: "600" }}>
                    Logout
                  </Text>
                </TouchableOpacity>
              </Animated.View>

              <TouchableOpacity
                style={styles.overlayTouchable}
                onPress={() => setMenuOpen(false)}
                activeOpacity={1}
              />
            </View>
          </Modal>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#ffffffff" },
  container: { padding: 16, gap: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 16,
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#102a43",
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
    textTransform: "capitalize",
  },
  okButton: {
    backgroundColor: "#1f4bd8",
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  okButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  webNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#ffffffff",
    paddingHorizontal: 20,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  navButtonText: {
    color: "#102a43",
    fontWeight: "600",
  },
  navButtonTextActive: {
    color: "#1f4bd8",
  },
  webLogo: { height: 40, width: 100 },
  navCenter: { flexDirection: "row", gap: 8 },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  navButtonActive: { backgroundColor: "rgba(255,255,255,0.15)" },
  mobileHeader: {
    marginTop: 25,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffffff",
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  logoContainer: { flex: 1, alignItems: "center" },
  mobileLogo: { height: 30, width: 110 },
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
    paddingHorizontal: 16,
    height: "100%",
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 6,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
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
});