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
  ScrollView,
  useWindowDimensions,
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
  const { width } = useWindowDimensions();
  
  const isDesktop = width >= 1024;
  const isTablet = width >= 640 && width < 1024;
  const isMobile = width < 640;

  const pages: Page[] = useMemo(
    () => [
      { label: "Accounts", key: "accounts", icon: "people" },
      { label: "Buildings", key: "buildings", icon: "business" },
      { label: "Stalls", key: "stalls", icon: "storefront" },
      { label: "Withholding Tax", key: "wt", icon: "document-text" },
      { label: "VAT", key: "vat", icon: "calculator" },
      { label: "Tenants", key: "tenants", icon: "person" },
      { label: "Assign", key: "assign", icon: "person-add" },
      { label: "Meters", key: "meters", icon: "speedometer" },
      { label: "Readings", key: "readings", icon: "bar-chart" },
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
  const [showModulePicker, setShowModulePicker] = useState(false);

  useEffect(() => {
    const wanted = String(params?.panel || params?.tab || "").toLowerCase() as PageKey;
    const allowedSet = roleAllowed[role] ?? roleAllowed.admin;
    if (wanted && allowedSet.has(wanted)) setActive(wanted);
    else if (!allowedSet.has(active)) setActive(roleInitial[role] ?? "buildings");
  }, [role, token, params?.panel, params?.tab, allowed.size]);

  const ready = visiblePages.some((p) => p.key === active);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (showModulePicker) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 10,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.95,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [showModulePicker]);

  const applyRouteParam = (key: PageKey) => {
    try { router.setParams({ panel: key }); } catch {}
  };

  const handleSelect = (key: PageKey) => {
    setActive(key);
    applyRouteParam(key);
    setShowModulePicker(false);
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

  const currentPage = visiblePages.find(p => p.key === active);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Background Gradient */}
        <View style={styles.bgGradient}>
          <View style={styles.bgCircle1} />
          <View style={styles.bgCircle2} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.headerContent, isDesktop && styles.headerDesktop]}>
            {/* Logo & Brand */}
            <View style={styles.brand}>
              <View style={styles.logoWrapper}>
                <Image 
                  source={require("../../assets/images/jdn.jpg")} 
                  style={styles.logoImage} 
                />
              </View>
              <View style={styles.brandInfo}>
                <Text style={styles.brandName}>Admin Portal</Text>
                <View style={styles.statusBadge}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusLabel}>Active</Text>
                </View>
              </View>
            </View>

            {/* Desktop Navigation Tabs */}
            {isDesktop && (
              <View style={styles.desktopTabs}>
                <ScrollView 
                  horizontal 
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.tabsScroll}
                >
                  {visiblePages.map((page) => {
                    const isActive = active === page.key;
                    return (
                      <TouchableOpacity
                        key={page.key}
                        onPress={() => handleSelect(page.key)}
                        style={[styles.tab, isActive && styles.tabActive]}
                        activeOpacity={0.7}
                      >
                        <Ionicons 
                          name={page.icon} 
                          size={18} 
                          color={isActive ? "#ffffff" : "#64748b"} 
                        />
                        <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                          {page.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Header Actions */}
            <View style={styles.headerActions}>
              {/* Role Badge (Desktop only) */}
              {isDesktop && (
                <View style={styles.roleBadge}>
                  <Ionicons name="shield-checkmark" size={16} color="#8b5cf6" />
                  <Text style={styles.roleLabel}>{role.toUpperCase()}</Text>
                </View>
              )}

              {/* Module Picker (Mobile/Tablet) */}
              {!isDesktop && currentPage && (
                <TouchableOpacity
                  onPress={() => setShowModulePicker(true)}
                  style={styles.modulePicker}
                  activeOpacity={0.7}
                >
                  <Ionicons name={currentPage.icon} size={20} color="#3b82f6" />
                  <Text style={styles.modulePickerText} numberOfLines={1}>
                    {currentPage.label}
                  </Text>
                  <Ionicons name="chevron-down" size={18} color="#64748b" />
                </TouchableOpacity>
              )}

              {/* Logout */}
              <TouchableOpacity
                onPress={async () => { 
                  await logout(); 
                  router.replace("/(auth)/login"); 
                }}
                style={styles.logoutButton}
                activeOpacity={0.8}
              >
                <Ionicons name="power" size={20} color="#ffffff" />
                {isDesktop && <Text style={styles.logoutLabel}>Logout</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Content */}
        <ScrollView 
          style={styles.contentScroll}
          contentContainerStyle={[
            styles.contentWrapper,
            isDesktop && styles.contentWrapperDesktop,
            isTablet && styles.contentWrapperTablet,
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[
            styles.contentCard,
            isDesktop && styles.contentCardDesktop,
            isTablet && styles.contentCardTablet,
          ]}>
            {ready ? renderContent() : null}
          </View>
        </ScrollView>

        {/* Module Picker Modal (Mobile/Tablet) */}
        {!isDesktop && (
          <Modal 
            visible={showModulePicker} 
            transparent 
            animationType="none"
            onRequestClose={() => setShowModulePicker(false)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setShowModulePicker(false)}
            >
              <Animated.View 
                style={[
                  styles.pickerModal,
                  {
                    opacity: fadeAnim,
                    transform: [{ scale: scaleAnim }]
                  }
                ]}
                onStartShouldSetResponder={() => true}
              >
                {/* Modal Header */}
                <View style={styles.pickerHeader}>
                  <View>
                    <Text style={styles.pickerTitle}>Select Module</Text>
                    <Text style={styles.pickerSubtitle}>Choose a section to manage</Text>
                  </View>
                  <TouchableOpacity 
                    onPress={() => setShowModulePicker(false)}
                    style={styles.pickerClose}
                  >
                    <Ionicons name="close-circle" size={28} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {/* Role Badge */}
                <View style={styles.pickerRoleBadge}>
                  <Ionicons name="shield-checkmark" size={16} color="#8b5cf6" />
                  <Text style={styles.pickerRoleText}>{role.toUpperCase()} ACCESS</Text>
                </View>

                {/* Module Grid */}
                <ScrollView 
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.pickerGrid}
                >
                  {visiblePages.map((page) => {
                    const isActive = active === page.key;
                    return (
                      <TouchableOpacity
                        key={page.key}
                        onPress={() => handleSelect(page.key)}
                        style={[styles.gridItem, isActive && styles.gridItemActive]}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.gridIcon, isActive && styles.gridIconActive]}>
                          <Ionicons 
                            name={page.icon} 
                            size={28} 
                            color={isActive ? "#ffffff" : "#3b82f6"} 
                          />
                        </View>
                        <Text style={[styles.gridLabel, isActive && styles.gridLabelActive]}>
                          {page.label}
                        </Text>
                        {isActive && (
                          <View style={styles.gridCheck}>
                            <Ionicons name="checkmark" size={16} color="#10b981" />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            </TouchableOpacity>
          </Modal>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#fafbfc',
  },

  // Background
  bgGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 280,
    backgroundColor: '#f8fafc',
    overflow: 'hidden',
  },
  bgCircle1: {
    position: 'absolute',
    top: -100,
    right: -50,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#dbeafe',
    opacity: 0.4,
  },
  bgCircle2: {
    position: 'absolute',
    top: -50,
    left: -80,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: '#e0e7ff',
    opacity: 0.3,
  },

  // Header
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    zIndex: 1000,
    ...(Platform.OS === 'web' && {
      position: 'sticky' as any,
      top: 0,
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
    }),
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
  },
  headerDesktop: {
    paddingHorizontal: 32,
    paddingVertical: 16,
  },

  // Brand
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#3b82f6',
    backgroundColor: '#ffffff',
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  brandInfo: {
    justifyContent: 'center',
  },
  brandName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },

  // Desktop Tabs
  desktopTabs: {
    flex: 1,
    marginHorizontal: 16,
  },
  tabsScroll: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    ...(Platform.OS === 'web' && {
      cursor: 'pointer',
      transition: 'all 0.2s',
    }),
  },
  tabActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
    ...(Platform.OS === 'web' && {
      boxShadow: '0 2px 8px rgba(59, 130, 246, 0.25)',
    }),
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },

  // Header Actions
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8b5cf6',
    letterSpacing: 0.5,
  },
  modulePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    maxWidth: 180,
  },
  modulePickerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#ef4444',
    ...(Platform.OS === 'web' && {
      boxShadow: '0 2px 6px rgba(239, 68, 68, 0.3)',
    }),
  },
  logoutLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },

  // Content
  contentScroll: {
    flex: 1,
  },
  contentWrapper: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 32,
  },
  contentWrapperDesktop: {
    padding: 32,
  },
  contentWrapperTablet: {
    padding: 24,
  },
  contentCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    minHeight: 500,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    ...(Platform.OS === 'web' && {
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
    }),
  },
  contentCardDesktop: {
    padding: 32,
    borderRadius: 20,
  },
  contentCardTablet: {
    padding: 24,
  },

  // Module Picker Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pickerModal: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 500,
    maxHeight: '85%',
    ...(Platform.OS !== 'web' && {
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 15,
      shadowOffset: { width: 0, height: 8 },
    }),
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pickerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  pickerSubtitle: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  pickerClose: {
    padding: 4,
  },
  pickerRoleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 24,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
    alignSelf: 'flex-start',
  },
  pickerRoleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8b5cf6',
    letterSpacing: 0.5,
  },
  pickerGrid: {
    padding: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    width: '47%',
    aspectRatio: 1.2,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  gridItemActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6',
    ...(Platform.OS !== 'web' && {
      shadowColor: '#3b82f6',
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    }),
  },
  gridIcon: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#dbeafe',
  },
  gridIconActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#2563eb',
  },
  gridLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
  },
  gridLabelActive: {
    color: '#1e293b',
    fontWeight: '700',
  },
  gridCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
  },
});