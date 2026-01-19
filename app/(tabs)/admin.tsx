import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Image,
  ScrollView,
  Modal,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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
import ReaderDevicesPanel from "../../components/admin/ReaderDevicesPanel";
import OfflineSubmissionsPanel from "../../components/admin/OfflineSubmissionsPanel";

export type PageKey =
  | "accounts"
  | "buildings"
  | "stalls"
  | "wt"
  | "vat"
  | "tenants"
  | "assign"
  | "meters"
  | "readings"
  | "readerDevices"
  | "offlineSubmissions";

type Page = {
  label: string;
  key: PageKey;
  icon: keyof typeof Ionicons.glyphMap;
};

const MOBILE_BREAKPOINT = 768;

function normalizeAccessKey(raw: any): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";

  const lower = s.toLowerCase();

  const alias: Record<string, string> = {
    readerdevices: "reader_devices",
    reader_device: "reader_devices",
    readerdevicespanel: "reader_devices",
    offlinesubmissions: "offline_submissions",
    offline_submission: "offline_submissions",
    offlinesubmission: "offline_submissions",
    assigntenants: "assign_tenants",
    assign_tenant: "assign_tenants",
    assigntenant: "assign_tenants",
    meterreadings: "meter_readings",
    meter_reading: "meter_readings",
    rateofchange: "rate_of_change",
    rate_of_change: "rate_of_change",
    buildings: "buildings",
    stalls: "stalls",
    tenants: "tenants",
    meters: "meters",
    billing: "billing",
    vat: "vat",
    withholding: "withholding",
    scanner: "scanner",
  };

  if (alias[lower]) return alias[lower];
  const snake = s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

  return snake;
}

function normalizeList(v: any): string[] {
  if (Array.isArray(v))
    return v.map((x) => normalizeAccessKey(x)).filter(Boolean);

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => normalizeAccessKey(x)).filter(Boolean);
      }
    } catch {}
    return s
      .split(",")
      .map((x) => normalizeAccessKey(x))
      .filter(Boolean);
  }

  if (v == null) return [];
  return [normalizeAccessKey(v)].filter(Boolean);
}

export default function AdminScreen() {
  const router = useRouter();
  const { token, user, logout } = useAuth();
  const params = useLocalSearchParams<{
    panel?: string;
    tab?: string;
    meterId?: string;
  }>();

  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;
  const [menuOpen, setMenuOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [taxMobileOpen, setTaxMobileOpen] = useState(false);
  const taxBtnRef = useRef<any>(null);
  const [taxAnchor, setTaxAnchor] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const openTaxMenu = () => {
    requestAnimationFrame(() => {
      taxBtnRef.current?.measureInWindow?.(
        (x: number, y: number, w: number, h: number) => {
          setTaxAnchor({ x, y, w, h });
          setTaxOpen(true);
        }
      );
    });
  };

  const toggleTaxMenu = () => {
    if (taxOpen) setTaxOpen(false);
    else openTaxMenu();
  };

  const role: string = useMemo(() => {
    const roles = normalizeList(
      (user as any)?.user_roles ?? (user as any)?.user_level
    );
    if (roles.includes("admin")) return "admin";
    if (roles.includes("operator")) return "operator";
    if (roles.includes("biller")) return "biller";
    if (roles.includes("reader")) return "reader";
    return "admin";
  }, [user]);
  const accessModules = useMemo(() => {
    const u: any = user || {};
    const raw =
      u.access_modules ?? u.access ?? u.accesses ?? u.user_access ?? [];
    return new Set(normalizeList(raw));
  }, [user]);

  const hasAccess = (key: string) => {
    if (role === "admin") return true;
    if (!key) return true;
    const k = normalizeAccessKey(key);
    return accessModules.has(k);
  };

  const roleAllowed: Record<string, Set<PageKey>> = useMemo(
    () => ({
      admin: new Set<PageKey>([
        "accounts",
        "buildings",
        "stalls",
        "wt",
        "vat",
        "tenants",
        "assign",
        "meters",
        "readings",
        "readerDevices",
        "offlineSubmissions",
      ]),
      operator: new Set<PageKey>([
        "buildings",
        "stalls",
        "wt",
        "vat",
        "tenants",
        "assign",
        "meters",
        "readings",
        "readerDevices",
        "offlineSubmissions",
      ]),
      biller: new Set<PageKey>([
        "buildings",
        "stalls",
        "wt",
        "vat",
        "tenants",
        "assign",
        "meters",
        "readings",
        "readerDevices",
        "offlineSubmissions",
      ]),
      reader: new Set<PageKey>([
        "buildings",
        "stalls",
        "wt",
        "vat",
        "tenants",
        "assign",
        "meters",
        "readings",
        "readerDevices",
        "offlineSubmissions",
      ]),
    }),
    []
  );

  const allowedByRole = roleAllowed[role] ?? roleAllowed.admin;
  const accessKeyForPage: Partial<Record<PageKey, string>> = useMemo(
    () => ({
      buildings: "buildings",
      stalls: "stalls",
      tenants: "tenants",
      assign: "assign_tenants",
      meters: "meters",
      readings: "meter_readings",
      vat: "vat",
      wt: "withholding",
      readerDevices: "reader_devices",
      offlineSubmissions: "offline_submissions",
    }),
    []
  );

  const canSee = (key: PageKey) => {
    if (!allowedByRole.has(key)) return false;
    if (key === "accounts") return role === "admin";
    const accessKey = accessKeyForPage[key];
    if (!accessKey) return true;
    return hasAccess(accessKey);
  };

  const pages: Page[] = useMemo(
    () => [
      { label: "Accounts", key: "accounts", icon: "people" },
      { label: "Buildings", key: "buildings", icon: "business" },
      { label: "Stalls", key: "stalls", icon: "storefront" },
      { label: "Tenants", key: "tenants", icon: "person" },
      { label: "Assign", key: "assign", icon: "person-add" },
      { label: "Meters", key: "meters", icon: "speedometer" },
      { label: "Readings", key: "readings", icon: "analytics" },
      { label: "Reader Devices", key: "readerDevices", icon: "phone-portrait" },
      {
        label: "Offline Submissions",
        key: "offlineSubmissions",
        icon: "cloud-upload",
      },
    ],
    []
  );

  const visiblePages = useMemo(
    () => pages.filter((p) => canSee(p.key)),
    [pages, role, accessModules]
  );

  const taxChildren = useMemo(() => {
    const children: Page[] = [];
    if (canSee("vat"))
      children.push({ label: "VAT", key: "vat", icon: "calculator" });
    if (canSee("wt"))
      children.push({ label: "Withholding", key: "wt", icon: "receipt" });
    return children;
  }, [role, accessModules]);

  const hasTax = taxChildren.length > 0;

  const roleInitial: Record<string, PageKey> = {
    admin: "buildings",
    operator: "stalls",
    biller: "buildings",
    reader: "readings",
  };

  const resolveInitial = (): PageKey => {
    const wanted = String(params?.panel || params?.tab || "")
      .toLowerCase() as PageKey;
    if (wanted && canSee(wanted)) return wanted;

    const fallback = roleInitial[role] ?? "buildings";
    if (canSee(fallback)) return fallback;

    return (visiblePages[0]?.key ?? "buildings") as PageKey;
  };

  const [active, setActive] = useState<PageKey>(resolveInitial());
  const isTaxActive = active === "vat" || active === "wt";

  useEffect(() => {
    const wanted = String(params?.panel || params?.tab || "")
      .toLowerCase() as PageKey;

    if (wanted && canSee(wanted)) {
      setActive(wanted);
      return;
    }

    if (!canSee(active)) {
      setActive(resolveInitial());
    }
  }, [role, params?.panel, params?.tab, accessModules]);

  const applyRouteParam = (key: PageKey) => {
    try {
      router.setParams?.({ panel: key });
    } catch {}
  };

  const handleSelect = (key: PageKey) => {
    if (!canSee(key)) return;
    setActive(key);
    applyRouteParam(key);
    setMenuOpen(false);
    setTaxOpen(false);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    router.replace?.("/(auth)/login");
  };

  const renderContent = () => {
    switch (active) {
      case "accounts":
        return <AccountsPanel token={token} />;

      case "buildings":
        return <BuildingPanel token={token} />;

      case "stalls":
        return <StallsPanel token={token} />;

      case "wt":
        return <WithholdingPanel token={token} />;

      case "vat":
        return <VATPanel token={token} />;

      case "tenants":
        return <TenantsPanel token={token} />;

      case "assign":
        return <AssignTenantPanel token={token} />;

      case "meters":
        return <MeterPanel token={token} />;

      case "readings":
        return (
          <MeterReadingPanel
            token={token}
            initialMeterId={
              params?.meterId ? String(params.meterId) : undefined
            }
          />
        );

      case "readerDevices":
        return <ReaderDevicesPanel />;

      case "offlineSubmissions":
        return <OfflineSubmissionsPanel />;

      default:
        return null;
    }
  };

  const displayName = (user as any)?.user_fullname ?? "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const roleColors: Record<string, { bg: string; text: string }> = {
    admin: { bg: "rgba(99, 102, 241, 0.1)", text: "#6366f1" },
    operator: { bg: "rgba(16, 185, 129, 0.1)", text: "#10b981" },
    biller: { bg: "rgba(245, 158, 11, 0.1)", text: "#f59e0b" },
    reader: { bg: "rgba(59, 130, 246, 0.1)", text: "#3b82f6" },
  };

  const currentRoleStyle = roleColors[role] || roleColors.admin;

  const activePageLabel =
    active === "vat"
      ? "VAT"
      : active === "wt"
      ? "Withholding"
      : visiblePages.find((p) => p.key === active)?.label || "Admin";
  const RIGHT_KEYS = useMemo(
    () => new Set<PageKey>(["accounts", "readerDevices"]),
    []
  );
  const rightTabs = useMemo(
    () => visiblePages.filter((p) => RIGHT_KEYS.has(p.key)),
    [visiblePages, RIGHT_KEYS]
  );
  const leftTabs = useMemo(
    () => visiblePages.filter((p) => !RIGHT_KEYS.has(p.key)),
    [visiblePages, RIGHT_KEYS]
  );

  const buildingsIndex = useMemo(
    () => leftTabs.findIndex((p) => p.key === "buildings"),
    [leftTabs]
  );

  const beforeBuildings = useMemo(() => {
    if (buildingsIndex < 0) return leftTabs;
    return leftTabs.slice(0, buildingsIndex + 1);
  }, [leftTabs, buildingsIndex]);

  const afterBuildings = useMemo(() => {
    if (buildingsIndex < 0) return [];
    return leftTabs.slice(buildingsIndex + 1);
  }, [leftTabs, buildingsIndex]);

  const mobileNavPages = useMemo<Page[]>(() => {
    const all: Page[] = [...beforeBuildings, ...afterBuildings, ...rightTabs];
    const seen = new Set<PageKey>();
    return all.filter((p) => {
      if (seen.has(p.key)) return false;
      seen.add(p.key);
      return true;
    });
  }, [beforeBuildings, afterBuildings, rightTabs]);

  const mobileNavWithTax = useMemo<{ before: Page[]; after: Page[] }>(() => {
    if (!hasTax) return { before: mobileNavPages, after: [] };
    const idxBuildings = mobileNavPages.findIndex((p) => p.key === "buildings");
    const insertAt = idxBuildings >= 0 ? idxBuildings + 1 : 0;
    return {
      before: mobileNavPages.slice(0, insertAt),
      after: mobileNavPages.slice(insertAt),
    };
  }, [mobileNavPages, hasTax]);


  const MobileMenu = () => (
    <Modal
      visible={menuOpen}
      animationType="fade"
      transparent
      onRequestClose={() => setMenuOpen(false)}
    >
      <View style={styles.modalOverlay}>
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setMenuOpen(false)}
        />
        <View style={styles.drawer}>
          <View style={styles.drawerHeader}>
            <View style={styles.drawerLogoRow}>
              <View style={styles.logoWrap}>
                <Image
                  source={require("../../assets/images/jdn.jpg")}
                  style={styles.logo}
                />
              </View>
              <View>
                <Text style={styles.drawerTitle}>Admin Portal</Text>
                <Text style={styles.drawerSub}>Management Console</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setMenuOpen(false)}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <View style={styles.drawerUser}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials || "U"}</Text>
            </View>
            <View style={styles.drawerUserInfo}>
              <Text style={styles.drawerUserName}>
                {displayName || "User"}
              </Text>
              <View
                style={[
                  styles.roleBadge,
                  { backgroundColor: currentRoleStyle.bg },
                ]}
              >
                <Text style={[styles.roleText, { color: currentRoleStyle.text }]}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </Text>
              </View>
            </View>
          </View>

          <ScrollView style={styles.drawerNav} showsVerticalScrollIndicator={false}>
            <Text style={styles.drawerLabel}>NAVIGATION</Text>

            {(hasTax ? mobileNavWithTax.before : mobileNavPages).map((page) => {
              const isActive2 = active === page.key;
              return (
                <TouchableOpacity
                  key={page.key}
                  onPress={() => handleSelect(page.key)}
                  style={[styles.drawerItem, isActive2 && styles.drawerItemActive]}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.drawerIconWrap,
                      isActive2 && styles.drawerIconWrapActive,
                    ]}
                  >
                    <Ionicons
                      name={
                        (isActive2 ? page.icon : `${page.icon}-outline`) as any
                      }
                      size={18}
                      color={isActive2 ? "#fff" : "#64748b"}
                    />
                  </View>
                  <Text
                    style={[
                      styles.drawerItemText,
                      isActive2 && styles.drawerItemTextActive,
                    ]}
                  >
                    {page.label}
                  </Text>
                  {isActive2 && (
                    <Ionicons name="checkmark-circle" size={18} color="#6366f1" />
                  )}
                </TouchableOpacity>
              );
            })}

            {hasTax && (
              <View style={{ marginTop: 2 }}>
                <TouchableOpacity
                  onPress={() => setTaxMobileOpen((v) => !v)}
                  style={[styles.drawerItem, isTaxActive && styles.drawerItemActive]}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.drawerIconWrap,
                      isTaxActive && styles.drawerIconWrapActive,
                    ]}
                  >
                    <Ionicons
                      name={(isTaxActive ? "cash" : "cash-outline") as any}
                      size={18}
                      color={isTaxActive ? "#fff" : "#64748b"}
                    />
                  </View>
                  <Text
                    style={[
                      styles.drawerItemText,
                      isTaxActive && styles.drawerItemTextActive,
                    ]}
                  >
                    TAX
                  </Text>
                  <Ionicons
                    name={taxMobileOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color="#64748b"
                  />
                </TouchableOpacity>

                {taxMobileOpen && (
                  <View style={styles.drawerSubList}>
                    {taxChildren.map((child) => {
                      const childActive2 = active === child.key;
                      return (
                        <TouchableOpacity
                          key={child.key}
                          onPress={() => {
                            handleSelect(child.key);
                            setMenuOpen(false);
                          }}
                          style={[
                            styles.drawerSubItem,
                            childActive2 && styles.drawerSubItemActive,
                          ]}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.drawerSubItemText,
                              childActive2 && styles.drawerSubItemTextActive,
                            ]}
                          >
                            {child.label}
                          </Text>
                          {childActive2 && (
                            <Ionicons name="checkmark" size={16} color="#6366f1" />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}

            {hasTax &&
              mobileNavWithTax.after.map((page) => {
                const isActive2 = active === page.key;
                return (
                  <TouchableOpacity
                    key={page.key}
                    onPress={() => handleSelect(page.key)}
                    style={[
                      styles.drawerItem,
                      isActive2 && styles.drawerItemActive,
                    ]}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.drawerIconWrap,
                        isActive2 && styles.drawerIconWrapActive,
                      ]}
                    >
                      <Ionicons
                        name={
                          (isActive2 ? page.icon : `${page.icon}-outline`) as any
                        }
                        size={18}
                        color={isActive2 ? "#fff" : "#64748b"}
                      />
                    </View>
                    <Text
                      style={[
                        styles.drawerItemText,
                        isActive2 && styles.drawerItemTextActive,
                      ]}
                    >
                      {page.label}
                    </Text>
                    {isActive2 && (
                      <Ionicons
                        name="checkmark-circle"
                        size={18}
                        color="#6366f1"
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
          </ScrollView>

          <View style={styles.drawerFooter}>
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.drawerLogout}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
              <Text style={styles.drawerLogoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.screen}>
      {isMobile && <MobileMenu />}

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {isMobile ? (
            <>
              <TouchableOpacity
                onPress={() => setMenuOpen(true)}
                style={styles.hamburger}
              >
                <Ionicons name="menu" size={24} color="#0f172a" />
              </TouchableOpacity>
              <Text style={styles.mobileTitle}>{activePageLabel}</Text>
            </>
          ) : (
            <>
              <View style={styles.logoWrap}>
                <Image
                  source={require("../../assets/images/jdn.jpg")}
                  style={styles.logo}
                />
              </View>
              <View style={styles.titleWrap}>
                <Text style={styles.brandTitle}>Admin Portal</Text>
                <Text style={styles.brandSub}>Management Console</Text>
              </View>
            </>
          )}
        </View>

        {!isMobile && (
          <View style={styles.headerRight}>
            <View style={styles.userCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials || "U"}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={styles.userName} numberOfLines={1}>
                  {displayName || "User"}
                </Text>
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: currentRoleStyle.bg },
                  ]}
                >
                  <Text style={[styles.roleText, { color: currentRoleStyle.text }]}>
                    {role.charAt(0).toUpperCase() + role.slice(1)}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.headerDivider} />
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.logoutBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={18} color="#64748b" />
              <Text style={styles.logoutText}>Logout</Text>
            </TouchableOpacity>
          </View>
        )}

        {isMobile && (
          <View style={styles.mobileHeaderRight}>
            <View style={styles.avatarSmall}>
              <Text style={styles.avatarTextSmall}>{initials || "U"}</Text>
            </View>
          </View>
        )}
      </View>

      {!isMobile && (
        <>
          <View style={styles.tabBar}>
            <View style={styles.tabBarRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabScroll}
                style={styles.leftTabScroll}
              >
                {beforeBuildings.map((page) => {
                  const isActive2 = active === page.key;
                  return (
                    <TouchableOpacity
                      key={page.key}
                      onPress={() => handleSelect(page.key)}
                      style={[styles.tab, isActive2 && styles.tabActive]}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={
                          (isActive2 ? page.icon : `${page.icon}-outline`) as any
                        }
                        size={16}
                        color={isActive2 ? "#6366f1" : "#64748b"}
                      />
                      <Text style={[styles.tabText, isActive2 && styles.tabTextActive]}>
                        {page.label}
                      </Text>
                      {isActive2 && <View style={styles.tabIndicator} />}
                    </TouchableOpacity>
                  );
                })}

                {hasTax && (
                  <View style={styles.taxWrap}>
                    <TouchableOpacity
                      ref={taxBtnRef}
                      onPress={toggleTaxMenu}
                      style={[styles.tab, isTaxActive && styles.tabActive]}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={(isTaxActive ? "cash" : "cash-outline") as any}
                        size={16}
                        color={isTaxActive ? "#6366f1" : "#64748b"}
                      />
                      <Text style={[styles.tabText, isTaxActive && styles.tabTextActive]}>
                        TAX
                      </Text>
                      <Ionicons
                        name={taxOpen ? "chevron-up" : "chevron-down"}
                        size={14}
                        color={isTaxActive ? "#6366f1" : "#64748b"}
                      />
                      {isTaxActive && <View style={styles.tabIndicator} />}
                    </TouchableOpacity>
                  </View>
                )}

                {afterBuildings.map((page) => {
                  const isActive2 = active === page.key;
                  return (
                    <TouchableOpacity
                      key={page.key}
                      onPress={() => handleSelect(page.key)}
                      style={[styles.tab, isActive2 && styles.tabActive]}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={
                          (isActive2 ? page.icon : `${page.icon}-outline`) as any
                        }
                        size={16}
                        color={isActive2 ? "#6366f1" : "#64748b"}
                      />
                      <Text style={[styles.tabText, isActive2 && styles.tabTextActive]}>
                        {page.label}
                      </Text>
                      {isActive2 && <View style={styles.tabIndicator} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.rightTabs}>
                {rightTabs.map((page) => {
                  const isActive2 = active === page.key;
                  return (
                    <TouchableOpacity
                      key={page.key}
                      onPress={() => handleSelect(page.key)}
                      style={[styles.tab, isActive2 && styles.tabActive]}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={
                          (isActive2 ? page.icon : `${page.icon}-outline`) as any
                        }
                        size={16}
                        color={isActive2 ? "#6366f1" : "#64748b"}
                      />
                      <Text style={[styles.tabText, isActive2 && styles.tabTextActive]}>
                        {page.label}
                      </Text>
                      {isActive2 && <View style={styles.tabIndicator} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {taxOpen && hasTax && (
            <Modal
              transparent
              animationType="fade"
              visible
              onRequestClose={() => setTaxOpen(false)}
            >
              <Pressable
                style={styles.taxModalBackdrop}
                onPress={() => setTaxOpen(false)}
              />
              <View
                style={[
                  styles.taxModalMenu,
                  {
                    top: taxAnchor.y + taxAnchor.h + 8,
                    left: taxAnchor.x,
                    minWidth: Math.max(160, taxAnchor.w),
                  },
                ]}
              >
                {taxChildren.map((child) => {
                  const childActive2 = active === child.key;
                  return (
                    <TouchableOpacity
                      key={child.key}
                      onPress={() => handleSelect(child.key)}
                      style={[styles.taxItem, childActive2 && styles.taxItemActive]}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={
                          (childActive2 ? child.icon : `${child.icon}-outline`) as any
                        }
                        size={16}
                        color={childActive2 ? "#6366f1" : "#64748b"}
                      />
                      <Text
                        style={[
                          styles.taxItemText,
                          childActive2 && styles.taxItemTextActive,
                        ]}
                      >
                        {child.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Modal>
          )}
        </>
      )}

      <View style={[styles.content, isMobile && styles.contentMobile]}>
        {renderContent()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f8fafc" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" } as any)
      : {
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 1 },
        }),
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  hamburger: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a" },

  logoWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 2px 6px rgba(0,0,0,0.08)" } as any)
      : {
          shadowColor: "#000",
          shadowOpacity: 0.08,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }),
  },
  logo: { width: 42, height: 42 },
  titleWrap: { gap: 1 },
  brandTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0f172a",
    letterSpacing: -0.3,
  },
  brandSub: { fontSize: 12, color: "#94a3b8", fontWeight: "500" },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 16 },
  mobileHeaderRight: { flexDirection: "row", alignItems: "center" },

  userCard: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  avatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#6366f1",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarTextSmall: { fontSize: 12, fontWeight: "700", color: "#fff" },

  userInfo: { gap: 2 },
  userName: { fontSize: 13, fontWeight: "600", color: "#0f172a", maxWidth: 120 },

  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleText: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  headerDivider: { width: 1, height: 28, backgroundColor: "#e2e8f0" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  logoutText: { fontSize: 13, fontWeight: "500", color: "#64748b" },

  tabBar: {
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    zIndex: 2000,
    overflow: "visible",
  },
  tabBarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leftTabScroll: { flex: 1, overflow: "visible" },
  rightTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingRight: 16,
    paddingLeft: 8,
  },
  tabScroll: {
    paddingHorizontal: 16,
    gap: 4,
    alignItems: "center",
    overflow: "visible",
  },

  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: "relative",
  },
  tabActive: {},
  tabText: { fontSize: 13, fontWeight: "500", color: "#64748b" },
  tabTextActive: { color: "#6366f1", fontWeight: "600" },
  tabIndicator: {
    position: "absolute",
    bottom: 0,
    left: 14,
    right: 14,
    height: 2,
    backgroundColor: "#6366f1",
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },

  taxWrap: { position: "relative", zIndex: 3000, overflow: "visible" },
  taxModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "transparent" },
  taxModalMenu: {
    position: "absolute",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingVertical: 6,
    zIndex: 999999,
    elevation: 999999,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 12px 28px rgba(0,0,0,0.12)" } as any)
      : {
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
        }),
  },
  taxItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  taxItemActive: { backgroundColor: "rgba(99, 102, 241, 0.08)" },
  taxItemText: { fontSize: 13, fontWeight: "500", color: "#0f172a" },
  taxItemTextActive: { color: "#6366f1", fontWeight: "600" },

  content: { flex: 1, padding: 20 },
  contentMobile: { padding: 12 },

  modalOverlay: { flex: 1, flexDirection: "row" },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
  },

  drawer: {
    width: 300,
    maxWidth: "85%",
    backgroundColor: "#ffffff",
    height: "100%",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "4px 0 24px rgba(0,0,0,0.12)" } as any)
      : {
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 24,
          shadowOffset: { width: 4, height: 0 },
        }),
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  drawerLogoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  drawerTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  drawerSub: { fontSize: 11, color: "#94a3b8", fontWeight: "500" },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },

  drawerUser: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: "#f8fafc",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
  },
  drawerUserInfo: { flex: 1, gap: 4 },
  drawerUserName: { fontSize: 14, fontWeight: "600", color: "#0f172a" },

  drawerNav: { flex: 1, paddingHorizontal: 16, paddingTop: 20 },
  drawerLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94a3b8",
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },

  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    marginBottom: 4,
  },
  drawerItemActive: { backgroundColor: "#f1f5f9" },

  drawerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  drawerIconWrapActive: { backgroundColor: "#6366f1" },

  drawerItemText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: "#64748b",
  },
  drawerItemTextActive: { color: "#0f172a", fontWeight: "600" },

  drawerSubList: {
    marginLeft: 52,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#e2e8f0",
    paddingLeft: 10,
  },
  drawerSubItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  drawerSubItemActive: { backgroundColor: "rgba(99, 102, 241, 0.08)" },
  drawerSubItemText: { fontSize: 13, fontWeight: "500", color: "#64748b" },
  drawerSubItemTextActive: { color: "#6366f1", fontWeight: "600" },

  drawerFooter: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  drawerLogout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
  drawerLogoutText: { fontSize: 14, fontWeight: "600", color: "#ef4444" },
});