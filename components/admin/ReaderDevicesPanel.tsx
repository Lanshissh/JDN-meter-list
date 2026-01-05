import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  Alert,
  Platform,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";

import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import { Card, Button, Input, ModalSheet } from "../ui/ProUI";

type ReaderDevice = {
  device_id: number;
  device_name: string;
  device_serial?: string | null;
  device_token: string;
  status: "active" | "blocked";
  device_info?: string | null;
  created_at?: string;
};

export default function ReaderDevicesPanel() {
  const { token, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const [devices, setDevices] = useState<ReaderDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [createVisible, setCreateVisible] = useState(false);
  const [cSerial, setCSerial] = useState("");
  const [cName, setCName] = useState("");
  const [cInfo, setCInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const notify = (title: string, message?: string) => {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      Alert.alert(title, message);
    }
  };

  const errorText = (err: any) => {
    const d = err?.response?.data;
    if (typeof d === "string") return d;
    if (d?.error) return d.error;
    if (d?.message) return d.message;
    return err?.message || "Server error.";
  };

  // normalize Authorization header (prevents "Bearer Bearer")
  const headerToken =
    token && /^Bearer\s/i.test(token.trim())
      ? token.trim()
      : token
      ? `Bearer ${token.trim()}`
      : "";

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: headerToken ? { Authorization: headerToken } : {},
        timeout: 15000,
      }),
    [headerToken]
  );

  const loadDevices = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<ReaderDevice[]>("/reader-devices");
      setDevices(res.data || []);
    } catch (err) {
      const msg = errorText(err);
      setError(msg);
      notify("Load failed", msg);
    } finally {
      setLoading(false);
    }
  }, [api, isAdmin]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const createDevice = async () => {
    const serial = cSerial.trim();
    if (!serial) {
      notify("Missing info", "Device serial number is required.");
      return;
    }

    try {
      setSubmitting(true);
      await api.post("/reader-devices", {
        device_serial: serial,
        device_name: cName.trim() || `Device ${serial}`,
        device_info: cInfo.trim() || null,
      });

      setCreateVisible(false);
      setCSerial("");
      setCName("");
      setCInfo("");

      await loadDevices();
      notify("Success", "Device created (blocked). Activate it when ready.");
    } catch (err) {
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (d: ReaderDevice) => {
    try {
      setBusyId(d.device_id);
      await api.patch(`/reader-devices/${d.device_id}/status`, {
        status: d.status === "active" ? "blocked" : "active",
      });
      await loadDevices();
    } catch (err) {
      notify("Update failed", errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  const deleteDevice = async (id: number) => {
    try {
      setBusyId(id);
      await api.delete(`/reader-devices/${id}`);
      setDevices((prev) => prev.filter((x) => x.device_id !== id));
    } catch (err) {
      notify("Delete failed", errorText(err));
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={32} color="#9ca3af" />
        <Text style={styles.muted}>Admin access only</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Reader Devices</Text>
        <Button onPress={() => setCreateVisible(true)}>+ Add Device</Button>
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => String(d.device_id)}
          renderItem={({ item }) => (
            <Card style={{ padding: 12, marginBottom: 10 }}>
              <Text style={styles.deviceName}>{item.device_name}</Text>

              <Text style={styles.meta}>Serial: {item.device_serial || "—"}</Text>

              <Text style={styles.meta}>
                Token: {item.device_token.slice(0, 6)}…{item.device_token.slice(-4)}
              </Text>

              <Text style={styles.meta}>Status: {item.status}</Text>

              <View style={styles.actions}>
                <Button
                  disabled={busyId === item.device_id}
                  onPress={() => toggleStatus(item)}
                >
                  {item.status === "active" ? "Block" : "Activate"}
                </Button>

                <Button
                  variant="danger"
                  disabled={busyId === item.device_id}
                  onPress={() => deleteDevice(item.device_id)}
                >
                  Delete
                </Button>
              </View>
            </Card>
          )}
        />
      )}

      <ModalSheet
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        title="Register Device"
      >
        <View style={{ gap: 10 }}>
          <View>
            <Text style={styles.fieldLabel}>Device Serial Number</Text>
            <Input value={cSerial} onChangeText={setCSerial} placeholder="e.g. SN-001-XYZ" />
          </View>

          <View>
            <Text style={styles.fieldLabel}>Device Name (optional)</Text>
            <Input value={cName} onChangeText={setCName} placeholder="e.g. Scanner A" />
          </View>

          <View>
            <Text style={styles.fieldLabel}>Device Info (optional)</Text>
            <Input value={cInfo} onChangeText={setCInfo} placeholder="e.g. Zebra TC26" />
          </View>

          <Button disabled={submitting} onPress={createDevice}>
            {submitting ? "Saving..." : "Create Device"}
          </Button>
        </View>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { padding: 18, alignItems: "center", justifyContent: "center" },
  muted: { marginTop: 8, color: "#6b7280" },
  title: { fontSize: 18, fontWeight: "700" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  error: { color: "#b91c1c" },
  deviceName: { fontWeight: "700", fontSize: 16, marginBottom: 6 },
  meta: { color: "#374151", marginBottom: 2 },
  actions: { flexDirection: "row", gap: 10, marginTop: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "700", marginBottom: 6, color: "#374151" },
});