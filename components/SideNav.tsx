// components/SideNav.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Image,
  Text,
  Platform,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";

export type TabKey = "dashboard" | "admin" | "scanner" | "billing" | "logout";

type Props = {
  active: TabKey;
  onSelect: (tab: TabKey) => void;
};

function decodeRole(token: string | null): string {
  try {
    if (!token) return "";
    const p = token.split(".")[1];
    const base64 = p.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof (globalThis as any).atob === "function"
        ? (globalThis as any).atob(base64)
        : "";
    return json ? String(JSON.parse(json)?.user_level || "").toLowerCase() : "";
  } catch {
    return "";
  }
}

export default function SideNav({ active, onSelect }: Props) {
  const { token } = useAuth();
  const role = useMemo(() => decodeRole(token), [token]);
  const canSeeAdmin = true;

  // expand/collapse with animated width
  const [expanded, setExpanded] = useState(false);
  const widthAnim = useRef(new Animated.Value(68)).current;

  useEffect(() => {
    Animated.spring(widthAnim, {
      toValue: expanded ? 220 : 68,
      useNativeDriver: false,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [expanded, widthAnim]);

  const NavItem = ({
    icon,
    label,
    tab,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    tab: TabKey;
  }) => {
    const isActive = active === tab;
    return (
      <TouchableOpacity
        onPress={() => onSelect(tab)}
        style={[
          styles.item,
          expanded && styles.itemWide,
          isActive && styles.itemActive,
        ]}
        {...(Platform.OS === "web" && !expanded ? { title: label } : {})}
      >
        <View style={[styles.itemRow, expanded && styles.itemRowWide]}>
          <Ionicons
            name={icon}
            size={22}
            color="#fff"
          />
          {expanded && (
            <Text style={[styles.itemText, isActive && styles.itemTextActive]}>
              {label}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Animated.View style={[styles.shell, { width: widthAnim }]}>
      {/* soft overlay – keeps your #082cac base but adds subtle depth */}
      <View pointerEvents="none" style={styles.overlay} />

      {/* Logo / brand */}
      <TouchableOpacity
        style={[styles.logoBtn, expanded && styles.logoBtnWide]}
        onPress={() => onSelect("admin")}
        {...(Platform.OS === "web" && !expanded ? { title: "Admin" } : {})}
      >
        <Image source={require("../assets/images/jdn.jpg")} style={styles.logo} />
        {expanded && <Text style={styles.brand}>JDN</Text>}
      </TouchableOpacity>

      {/* Nav section */}
      <View style={styles.section}>
        {canSeeAdmin && <NavItem icon="person-circle-outline" label="Admin" tab="admin" />}
        <NavItem icon="scan-outline" label="Scanner" tab="scanner" />
        <NavItem icon="card-outline" label="Billing" tab="billing" />
      </View>

      <View style={{ flex: 1 }} />

      {/* Bottom items */}
      <NavItem icon="stats-chart-outline" label="Dashboard" tab="dashboard" />

      {/* Expand / Collapse */}
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        style={[styles.toggle, expanded && styles.itemWide]}
        accessibilityLabel={expanded ? "Collapse sidebar" : "Expand sidebar"}
        {...(Platform.OS === "web" ? { title: expanded ? "Collapse" : "Expand" } : {})}
      >
        <View style={[styles.itemRow, expanded && styles.itemRowWide]}>
          {!expanded ? (
            <View style={styles.expandIconRow}>
              <Ionicons name="arrow-forward-outline" size={18} color="#fff" />
              <View style={styles.vertBar} />
            </View>
          ) : (
            <View style={styles.expandIconRow}>
              <View style={styles.vertBar} />
              <Ionicons name="arrow-back-outline" size={18} color="#fff" />
            </View>
          )}
          {expanded && <Text style={styles.itemText}>Collapse</Text>}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ===================== styles ===================== */
/** brand palette — preserved from your original file */
const BRAND_BG = "#082cac";
const BORDER = "#eee";
const TEXT = "#fff";

const styles = StyleSheet.create({
  shell: {
    height: "100%",
    paddingVertical: 16,
    paddingHorizontal: 8,
    backgroundColor: BRAND_BG,              // <-- keep your base color
    borderRightWidth: 1,
    borderRightColor: BORDER,               // <-- keep your border color
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? {
          backdropFilter: "blur(8px)",      // subtle frost
          WebkitBackdropFilter: "blur(8px)",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.06), 0 8px 28px rgba(0,0,0,0.24)",
        }
      : {
          shadowColor: "#000",
          shadowOpacity: 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 8 },
        }),
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },

  overlay: {
    position: "absolute",
    inset: 0 as any,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    backgroundColor: "transparent",
    ...(Platform.OS === "web"
      ? {
          // very soft vertical light—keeps BRAND_BG dominant
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 40%, rgba(0,0,0,0.08) 100%)",
        }
      : {}),
  },

  /* logo */
  logoBtn: {
    height: 56,
    width: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    marginBottom: 12,
  },
  logoBtnWide: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-start",
    paddingHorizontal: 10,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  brand: { color: TEXT, fontWeight: "800", fontSize: 16, letterSpacing: 0.4 },

  /* section */
  section: { marginTop: 8, gap: 8 },

  /* items */
  item: {
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 4,
    backgroundColor: "rgba(255,255,255,0.08)",  // soft white veil on brand blue
    ...(Platform.OS === "web"
      ? { cursor: "pointer", transition: "box-shadow 140ms ease, background 140ms ease" }
      : {}),
  },
  itemWide: { alignItems: "flex-start", paddingHorizontal: 10 },

  itemRow: { alignItems: "center" },
  itemRowWide: { flexDirection: "row", gap: 10 },

  itemActive: {
    backgroundColor: "rgba(255,255,255,0.18)",  // brighter white, not cyan
    ...(Platform.OS === "web"
      ? { boxShadow: "0 0 0 3px rgba(255,255,255,0.24), 0 10px 24px rgba(0,0,0,0.25)" }
      : {
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 8 },
        }),
  },
  itemText: { color: TEXT, fontWeight: "700", fontSize: 14 },
  itemTextActive: { color: TEXT },

  /* toggle */
  toggle: {
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  expandIconRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  vertBar: {
    width: 3,
    height: 20,
    backgroundColor: TEXT,
    borderRadius: 2,
    opacity: 0.9,
  },
});