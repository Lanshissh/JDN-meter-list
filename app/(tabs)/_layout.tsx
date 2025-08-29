import React, { useState } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Slot, useRouter, Tabs } from "expo-router";
import SideNav, { TabKey } from "../../components/SideNav";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";

export default function TabLayout() {
  const [activeTab, setActiveTab] = useState<TabKey>("admin");
  const router = useRouter();
  const { logout } = useAuth();

  const handleSelectTab = async (tab: TabKey) => {
    setActiveTab(tab);
    if (tab === "logout") {
      // make sure we clear token on web logout too
      await logout();
      router.replace("/(auth)/login");
    } else {
      router.replace(`/(tabs)/${tab}` as any);
    }
  };

  // On web, use the vertical side nav (icons + logo + logout)
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

  // On mobile, use bottom tabs
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#fff",
        tabBarInactiveTintColor: "#fff",
        tabBarStyle: {
          backgroundColor: "#007bff",
          borderTopWidth: 1,
          borderTopColor: "#eee",
        },
      }}
    >
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? "person-circle" : "person-circle-outline"}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="scanner"
        options={{
          title: "Scanner",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? "scan" : "scan-outline"}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="billing"
        options={{
          title: "Billing",
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? "card" : "card-outline"}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

function TabBarIcon({ name, color }: { name: string; color: string }) {
  return <Ionicons name={name as any} size={24} color={color} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: "row", backgroundColor: "#f9f9f9" },
  content: { flex: 1 },
});
