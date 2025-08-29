// app/(tabs)/_layout.tsx
import React, { useMemo } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Slot, useRouter, Tabs } from "expo-router";
import SideNav, { TabKey } from "../../components/SideNav";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";

function decodeRole(token: string | null): string {
  try {
    if (!token) return "";
    const p = token.split(".")[1];
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof (globalThis as any).atob === "function" ? (globalThis as any).atob(b64) : "";
    return json ? String(JSON.parse(json)?.user_level || "").toLowerCase() : "";
  } catch {
    return "";
  }
}

export default function TabLayout() {
  const { token } = useAuth();
  const role = useMemo(() => decodeRole(token), [token]);

  const [activeTab, setActiveTab] = React.useState<TabKey>(role === "reader" ? "scanner" : "admin");
  const router = useRouter();

  const handleSelectTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === "logout") router.replace("/(auth)/login");
    else router.replace(`/(tabs)/${tab}` as any);
  };

  // On web, show our SideNav (which already hides Admin for readers)
  if (Platform.OS === "web") {
    return (
      <View style={styles.container}>
        <SideNav active={activeTab} onSelect={handleSelectTab} />
        <View style={styles.content}>
          <Slot />
        </View>
      </View>
    );
  }

  // On mobile, hide the Admin tab entirely for readers via href=null
  const hideAdmin = role === "reader";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "#fff",
        tabBarStyle: { backgroundColor: "#007bff", borderTopWidth: 1, borderTopColor: "#eee" },
      }}
    >
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          // Hide this tab for readers
          href: hideAdmin ? null : "/(tabs)/admin",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person-circle" : "person-circle-outline"} size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="scanner"
        options={{
          title: "Scanner",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "scan" : "scan-outline"} size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="billing"
        options={{
          title: "Billing",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "card" : "card-outline"} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row", backgroundColor: "#f9f9f9" },
  content: { flex: 1 },
});