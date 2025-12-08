import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";

import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import { Card, Button } from "../ui/ProUI";

type ReaderDevice = {
  device_id: number;
  device_name: string;
  device_token: string;
  status: "active" | "blocked";
  user_id?: number;
  device_info?: string | null;
  created_at?: string;
  last_used_at?: string | null;
};

export default function ReaderDevicesPanel() {
  const { token, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const [devices, setDevices] = useState<ReaderDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- helpers ----
  const notify = (title: string, message?: string) => {
    if (typeof window !== "undefined" && window.alert) {
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      console.log(title, message);
    }
  };

  const errorText = (err: any, fallback = "Server error.") => {
    const d = err?.response?.data;
    if (typeof d === "string") return d;
    if (d?.error) return String(d.error);
    if (d?.message) return String(d.message);
    if (err?.message) return String(err.message);
    try {
      return JSON.stringify(d ?? err);
    } catch {
      return fallback;
    }
  };

  // ---- stable API client ----
  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token]
  );

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        timeout: 15000,
        headers: authHeader,
      }),
    [authHeader]
  );

  const loadDevices = useCallback(async () => {
    if (!token || !isAdmin) return;
    try {
      setLoading(true);
      setError(null);

      const res = await api.get<ReaderDevice[]>("/reader-devices");
      setDevices(res.data || []);
    } catch (err) {
      const msg = errorText(err);
      setError(msg);
      notify("Failed to load devices", msg);
    } finally {
      setLoading(false);
    }
  }, [api, token, isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      loadDevices();
    }
  }, [isAdmin, loadDevices]);

  const updateStatus = async (
    device_id: number,
    status: "active" | "blocked"
  ) => {
    if (!token || !isAdmin) return;
    try {
      setBusyId(device_id);
      const res = await api.patch<ReaderDevice>(
        `/reader-devices/${device_id}/status`,
        { status }
      );

      const updated = res.data;
      setDevices((prev) =>
        prev.map((d) => (d.device_id === device_id ? updated : d))
      );
      notify("Success", `Device is now ${status}.`);
    } catch (err) {
      notify("Failed to update status", errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const deleteDevice = async (device_id: number) => {
    if (!token || !isAdmin) return;
    try {
      const ok =
        typeof window !== "undefined" && window.confirm
          ? window.confirm(
              "Are you sure you want to delete this device?\n\nThis cannot be undone."
            )
          : true;
      if (!ok) return;

      setBusyId(device_id);
      await api.delete(`/reader-devices/${device_id}`);

      setDevices((prev) => prev.filter((d) => d.device_id !== device_id));
      notify("Deleted", "Device has been removed.");
    } catch (err) {
      notify("Failed to delete device", errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={32} color="#9ca3af" />
        <Text style={styles.centerTitle}>Admin access only</Text>
        <Text style={styles.centerText}>
          Only admin users can manage reader devices.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Reader Devices</Text>
      <Text style={styles.subtitle}>
        Registered phones for offline meter reading.
      </Text>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Button variant="ghost" onPress={loadDevices}>
            Retry
          </Button>
        </View>
      ) : devices.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="phone-portrait-outline" size={32} color="#9ca3af" />
          <Text style={styles.centerTitle}>No reader devices yet</Text>
          <Text style={styles.centerText}>
            A device will appear here after a reader logs in on mobile and gets
            a token.
          </Text>
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => String(d.device_id)}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => {
            const isBusy = busyId === item.device_id;
            const isActive = item.status === "active";

            return (
              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    {/* Big line: phone / laptop model */}
                    <Text style={styles.deviceName}>
                      {item.device_name || "Unknown device"}
                    </Text>

                    {/* OS / platform info, if available */}
                    {item.device_info && (
                      <Text style={styles.deviceMeta}>{item.device_info}</Text>
                    )}

                    {/* Small meta: ID + token info */}
                    <Text style={styles.deviceMetaSmall}>
                      ID: {item.device_id} • Token length:{" "}
                      {(item.device_token || "").length}
                    </Text>

                    {/* Last used timestamp if present */}
                    {item.last_used_at && (
                      <Text style={styles.deviceMetaSmall}>
                        Last used: {item.last_used_at}
                      </Text>
                    )}
                  </View>

                  <View
                    style={[
                      styles.statusBadge,
                      isActive ? styles.badgeActive : styles.badgeBlocked,
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        isActive ? styles.dotActive : styles.dotBlocked,
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusText,
                        isActive
                          ? styles.statusTextActive
                          : styles.statusTextBlocked,
                      ]}
                    >
                      {isActive ? "Active" : "Blocked"}
                    </Text>
                  </View>
                </View>

                <View style={styles.tokenRow}>
                  <Text style={styles.tokenLabel}>Device Token</Text>
                  <Text style={styles.tokenText} numberOfLines={1}>
                    {item.device_token}
                  </Text>
                </View>

                <View style={styles.cardFooter}>
                  <Button
                    variant={isActive ? "ghost" : "solid"}
                    onPress={() =>
                      updateStatus(
                        item.device_id,
                        isActive ? "blocked" : "active"
                      )
                    }
                    disabled={isBusy}
                  >
                    {isBusy
                      ? "Working…"
                      : isActive
                      ? "Block this device"
                      : "Activate this device"}
                  </Button>

                  <View style={{ width: 8 }} />

                  <Button
                    variant="danger"
                    onPress={() => deleteDevice(item.device_id)}
                    disabled={isBusy}
                  >
                    {isBusy ? "Working…" : "Delete"}
                  </Button>
                </View>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 16,
    backgroundColor: "#f8fafc",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 4,
  },
  loader: {
    flex: 1,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  centerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginTop: 4,
  },
  centerText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    maxWidth: 320,
  },
  errorText: {
    fontSize: 14,
    color: "#b91c1c",
    textAlign: "center",
  },
  card: {
    marginVertical: 6,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  cardHeaderLeft: {
    flex: 1,
    paddingRight: 12,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  deviceMeta: {
    marginTop: 2,
    fontSize: 12,
    color: "#6b7280",
  },
  deviceMetaSmall: {
    marginTop: 2,
    fontSize: 11,
    color: "#9ca3af",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeActive: {
    backgroundColor: "#ecfdf5",
    borderColor: "#22c55e",
  },
  badgeBlocked: {
    backgroundColor: "#fef2f2",
    borderColor: "#ef4444",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginRight: 6,
  },
  dotActive: {
    backgroundColor: "#16a34a",
  },
  dotBlocked: {
    backgroundColor: "#dc2626",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  statusTextActive: {
    color: "#166534",
  },
  statusTextBlocked: {
    color: "#b91c1c",
  },
  tokenRow: {
    marginTop: 4,
    marginBottom: 10,
  },
  tokenLabel: {
    fontSize: 11,
    color: "#9ca3af",
    marginBottom: 2,
  },
  tokenText: {
    fontSize: 13,
    color: "#111827",
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 4,
  },
});