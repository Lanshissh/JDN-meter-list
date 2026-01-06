import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";

import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import { Card, Button } from "../ui/ProUI";

type ReaderDevice = {
  device_id: number;
  device_serial: string;
  device_name: string;
  device_token: string;
  status: "active" | "blocked";
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

  // create form
  const [serial, setSerial] = useState("");
  const [name, setName] = useState("");
  const [info, setInfo] = useState("");

  // search/filter
  const [query, setQuery] = useState("");

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

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token]
  );

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        timeout: 20000,
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
    if (isAdmin) loadDevices();
  }, [isAdmin, loadDevices]);

  const createDevice = async () => {
    if (!token || !isAdmin) return;
    const s = serial.trim();
    const n = name.trim();
    if (!s || !n) {
      notify("Missing fields", "device_serial and device_name are required.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.post<ReaderDevice>("/reader-devices", {
        device_serial: s,
        device_name: n,
        device_info: info.trim() || null,
      });

      setSerial("");
      setName("");
      setInfo("");
      setDevices((prev) => [res.data, ...prev]);
      notify("Registered", "Device serial is now registered and token generated.");
    } catch (err) {
      notify("Failed to register device", errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (device_id: number, status: "active" | "blocked") => {
    if (!token || !isAdmin) return;
    try {
      setBusyId(device_id);
      const res = await api.patch<ReaderDevice>(
        `/reader-devices/${device_id}/status`,
        { status }
      );
      const updated = res.data;
      setDevices((prev) => prev.map((d) => (d.device_id === device_id ? updated : d)));
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
          ? window.confirm("Delete this device?\n\nThis cannot be undone.")
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

  const copyToken = async (device_token: string) => {
    try {
      // Web copy support
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(device_token);
        notify("Copied", "Device token copied to clipboard.");
        return;
      }

      // Native fallback (no dependency added)
      notify(
        "Copy token",
        "On mobile: tap and hold the token text to copy (or add expo-clipboard if you want one-tap copy)."
      );
    } catch (err) {
      notify("Copy failed", errorText(err, "Unable to copy token."));
    }
  };

  const filteredDevices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;

    return devices.filter((d) => {
      const hay = [
        d.device_name,
        d.device_serial,
        d.device_token,
        d.device_info ?? "",
        d.status,
        String(d.device_id),
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [devices, query]);

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={32} color="#9ca3af" />
        <Text style={styles.centerTitle}>Admin access only</Text>
        <Text style={styles.centerText}>Only admin users can manage reader devices.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reader Devices</Text>
          <Text style={styles.subtitle}>Register device serials and manage tokens.</Text>
        </View>

        <Button variant="ghost" onPress={loadDevices} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </View>

      <Card style={styles.createCard}>
        <Text style={styles.sectionTitle}>Register Device (Admin)</Text>

        <Text style={styles.label}>Device Serial</Text>
        <TextInput
          value={serial}
          onChangeText={setSerial}
          placeholder="e.g. ANDROID-ABC123 / IMEI / your serial"
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Device Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Juan’s Phone"
          style={styles.input}
        />

        <Text style={styles.label}>Device Info (optional)</Text>
        <TextInput
          value={info}
          onChangeText={setInfo}
          placeholder="e.g. Android 14 • Samsung A54"
          style={styles.input}
        />

        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }}>
          <Button variant="solid" onPress={createDevice} disabled={loading}>
            {loading ? "Working…" : "Register"}
          </Button>
        </View>
      </Card>

      <Card style={styles.searchCard}>
        <Text style={styles.sectionTitle}>Search</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, serial, token, status…"
          style={styles.input}
          autoCapitalize="none"
        />
        <Text style={styles.countText}>
          Showing {filteredDevices.length} of {devices.length}
        </Text>
      </Card>

      {loading && devices.length === 0 ? (
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
      ) : filteredDevices.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="phone-portrait-outline" size={32} color="#9ca3af" />
          <Text style={styles.centerTitle}>No devices found</Text>
          <Text style={styles.centerText}>
            Register a serial above, or clear the search filter.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredDevices}
          keyExtractor={(d) => String(d.device_id)}
          contentContainerStyle={{ paddingVertical: 8 }}
          renderItem={({ item }) => {
            const isBusy = busyId === item.device_id;
            const isActive = item.status === "active";

            return (
              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <Text style={styles.deviceName}>
                      {item.device_name || "Unknown device"}
                    </Text>

                    <Text style={styles.deviceMeta}>Serial: {item.device_serial}</Text>

                    {item.device_info ? (
                      <Text style={styles.deviceMeta}>{item.device_info}</Text>
                    ) : null}

                    <Text style={styles.deviceMetaSmall}>
                      ID: {item.device_id} • Token length: {(item.device_token || "").length}
                    </Text>

                    {item.created_at ? (
                      <Text style={styles.deviceMetaSmall}>Created: {item.created_at}</Text>
                    ) : null}

                    {item.last_used_at ? (
                      <Text style={styles.deviceMetaSmall}>Last used: {item.last_used_at}</Text>
                    ) : null}
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
                        isActive ? styles.statusTextActive : styles.statusTextBlocked,
                      ]}
                    >
                      {isActive ? "Active" : "Blocked"}
                    </Text>
                  </View>
                </View>

                <View style={styles.tokenRow}>
                  <Text style={styles.tokenLabel}>Device Token</Text>
                  <Text style={styles.tokenText} selectable numberOfLines={1}>
                    {item.device_token}
                  </Text>

                  <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 8 }}>
                    <Button variant="ghost" onPress={() => copyToken(item.device_token)}>
                      Copy token
                    </Button>
                  </View>
                </View>

                <View style={styles.cardFooter}>
                  <Button
                    variant={isActive ? "ghost" : "solid"}
                    onPress={() => updateStatus(item.device_id, isActive ? "blocked" : "active")}
                    disabled={isBusy}
                  >
                    {isBusy ? "Working…" : isActive ? "Block this device" : "Activate this device"}
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
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
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
  createCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  searchCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    fontSize: 14,
    color: "#111827",
  },
  countText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
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