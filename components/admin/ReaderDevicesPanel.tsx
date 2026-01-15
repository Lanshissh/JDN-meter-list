import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import axios from "axios";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

type Device = {
  id: number;
  device_serial: string;
  device_name: string | null;
  device_token: string;
  status: "active" | "blocked" | string;
  last_seen_at?: any;
  created_at?: any;
};

function toText(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  // Objects (ex: {message:"..."}) -> stringify so React won't crash
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function pickMessage(data: any) {
  // Supports {error:""}, {message:""}, {hint:""} etc.
  return (
    data?.error ||
    data?.message ||
    data?.hint ||
    (typeof data === "string" ? data : null)
  );
}

export default function ReaderDevicesPanel() {
  const { token, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const api = useMemo(() => {
    return axios.create({
      baseURL: BASE_API,
      timeout: 20000,
      headers: { Authorization: `Bearer ${token ?? ""}` },
    });
  }, [token]);

  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string>("");

  const [addOpen, setAddOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const [name, setName] = useState("");

  const fetchDevices = async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const res = await api.get("/reader-devices");
      const devs = res.data?.devices;

      if (Array.isArray(devs)) {
        setDevices(devs);
      } else {
        // backend returned an object like {message:"..."} or something unexpected
        setDevices([]);
        const msg = pickMessage(res.data) || "Unexpected response from server.";
        setError(toText(msg));
      }
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) ||
        e?.message ||
        "Failed to load devices.";
      setError(toText(msg));
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && isAdmin) fetchDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  const onRegister = async () => {
    const device_serial = serial.trim().toUpperCase();
    const device_name = name.trim();

    if (!device_serial) {
      Alert.alert("Missing", "Please enter a device serial.");
      return;
    }

    try {
      setLoading(true);
      await api.post("/reader-devices/register", {
        device_serial,
        device_name: device_name || undefined,
      });

      setAddOpen(false);
      setSerial("");
      setName("");
      await fetchDevices();
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Register failed.";
      Alert.alert("Register failed", toText(msg));
    } finally {
      setLoading(false);
    }
  };

  const onToggleBlock = async (d: Device) => {
    const next =
      String(d.status).toLowerCase() === "active" ? "blocked" : "active";
    try {
      setLoading(true);
      await api.patch(`/reader-devices/${d.id}`, { status: next });
      await fetchDevices();
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Update failed.";
      Alert.alert("Update failed", toText(msg));
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (d: Device) => {
    Alert.alert(
      "Delete device?",
      `Serial: ${d.device_serial}\nThis will remove the token from server control.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await api.delete(`/reader-devices/${d.id}`);
              await fetchDevices();
            } catch (e: any) {
              const msg =
                pickMessage(e?.response?.data) ||
                e?.message ||
                "Delete failed.";
              Alert.alert("Delete failed", toText(msg));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Admin only.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Reader Devices</Text>
        <TouchableOpacity style={styles.btn} onPress={() => setAddOpen(true)}>
          <Text style={styles.btnText}>+ Register</Text>
        </TouchableOpacity>
      </View>

      {!!error && <Text style={styles.err}>{toText(error)}</Text>}
      {loading ? <ActivityIndicator /> : null}

      <FlatList
        data={devices}
        keyExtractor={(d) => String(d.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshing={loading}
        onRefresh={fetchDevices}
        ListEmptyComponent={
          <Text style={styles.empty}>No devices registered yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.serial}>{toText(item.device_serial)}</Text>
            <Text style={styles.meta}>
              Name: {toText(item.device_name || "-")}
            </Text>
            <Text style={styles.meta}>Token: {toText(item.device_token)}</Text>
            <Text style={styles.meta}>Status: {toText(item.status)}</Text>

            <View style={styles.row}>
              <TouchableOpacity
                style={[
                  styles.smallBtn,
                  String(item.status).toLowerCase() === "active"
                    ? styles.blockBtn
                    : styles.unblockBtn,
                ]}
                onPress={() => onToggleBlock(item)}
              >
                <Text style={styles.smallBtnText}>
                  {String(item.status).toLowerCase() === "active"
                    ? "Block"
                    : "Unblock"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.smallBtn, styles.deleteBtn]}
                onPress={() => onDelete(item)}
              >
                <Text style={styles.smallBtnText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Register Device</Text>

            <TextInput
              style={styles.input}
              placeholder="Device Serial (from Device Settings)"
              value={serial}
              onChangeText={setSerial}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Device Name (optional)"
              value={name}
              onChangeText={setName}
            />

            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => setAddOpen(false)}
              >
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={onRegister}>
                <Text style={styles.btnText}>Save</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.hint}>
              Token is generated by server. Reader resolves it on login using
              the serial.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: "700" },
  btn: {
    backgroundColor: "#47538b",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontWeight: "700" },
  err: { color: "#c62828", marginBottom: 10 },
  empty: { opacity: 0.7, marginTop: 20, textAlign: "center" },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  serial: { fontWeight: "800", marginBottom: 4 },
  meta: { opacity: 0.8, marginTop: 2 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  smallBtnText: { color: "#fff", fontWeight: "700" },
  blockBtn: { backgroundColor: "#d32f2f" },
  unblockBtn: { backgroundColor: "#2e7d32" },
  deleteBtn: { backgroundColor: "#6d4c41" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#fff",
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalTitle: { fontWeight: "800", fontSize: 16, marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  cancelBtn: { backgroundColor: "#888" },
  hint: { marginTop: 10, opacity: 0.7 },
});