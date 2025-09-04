import React, { useMemo, useState } from "react";
import { View, TouchableOpacity, StyleSheet, Image, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../contexts/AuthContext";

export type TabKey = "admin" | "scanner" | "billing" | "logout";

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
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={[styles.sideNav, expanded && styles.sideNavExpanded]}>
      {/* Logo */}
      <TouchableOpacity
        style={[styles.iconBtn, expanded && styles.iconBtnWide]}
        onPress={() => onSelect("admin")}
      >
        <Image
          source={require("../assets/images/jdn.jpg")}
          style={styles.logo}
        />
      </TouchableOpacity>

      {/* Nav buttons */}
      <View style={styles.navSection}>
        {canSeeAdmin && (
        <TouchableOpacity
          style={[
            styles.iconBtn,
            expanded && styles.iconBtnWide,
            active === "admin" && styles.active,
          ]}
          onPress={() => onSelect("admin")}
        >
          <View style={[styles.row, expanded && styles.rowExpanded]}>
            <Ionicons name="person-circle-outline" size={28} color="#fff" />
            {expanded && <Text style={styles.label}>Admin</Text>}
          </View>        
        </TouchableOpacity>

        )}

        <TouchableOpacity
          style={[
            styles.iconBtn,
            expanded && styles.iconBtnWide,
            active === "scanner" && styles.active,
          ]}
          onPress={() => onSelect("scanner")}
        >
          <View style={[styles.row, expanded && styles.rowExpanded]}>
            <Ionicons name="scan-outline" size={28} color="#fff" />
            {expanded && <Text style={styles.label}>Scanner</Text>}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.iconBtn,
            expanded && styles.iconBtnWide,
            active === "billing" && styles.active,
          ]}
          onPress={() => onSelect("billing")}
        >
          <View style={[styles.row, expanded && styles.rowExpanded]}>
            <Ionicons name="card-outline" size={28} color="#fff" />
            {expanded && <Text style={styles.label}>Billing</Text>}
          </View>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} />

      {/* Expand / Collapse toggle (replaces logout) */}
      <TouchableOpacity
        style={[styles.iconBtn, expanded && styles.iconBtnWide]}
        onPress={() => setExpanded((v) => !v)}
        accessibilityLabel={expanded ? "Collapse" : "Expand"}
      >
        <View style={[styles.row, expanded && styles.rowExpanded]}>
          {!expanded ? (
            // |→  (arrow then bar)
            <View style={styles.expandIconRow}>
              <Ionicons name="arrow-forward-outline" size={24} color="#fff" />
              <View style={styles.vertBar} />
            </View>
          ) : (
            // |←  (bar then arrow)
            <View style={styles.expandIconRow}>
              <View style={styles.vertBar} />
              <Ionicons name="arrow-back-outline" size={24} color="#fff" />
            </View>
          )}
          {expanded && <Text style={styles.label}>Collapse</Text>}
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  sideNav: {
    width: 68,
    backgroundColor: "#082cac",
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 20,
    borderRightWidth: 1,
    borderRightColor: "#eee",
    flexDirection: "column",
    height: "100%",
  },
  sideNavExpanded: {
    width: 220,
    alignItems: "flex-start",
    paddingLeft: 10,
    paddingRight: 10,
  },
  navSection: {
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    marginTop: 24,
  },
  iconBtn: {
    marginVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 16,
  },
  iconBtnWide: {
    width: "100%",
    alignItems: "flex-start",
    paddingHorizontal: 8,
  },
  row: {
    alignItems: "center",
  },
  rowExpanded: {
    flexDirection: "row",
    gap: 12,
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "#fff",
  },
  label: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  expandIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vertBar: {
    width: 3,
    height: 22,
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  active: { backgroundColor: "rgba(255,255,255,0.15)" },
});
