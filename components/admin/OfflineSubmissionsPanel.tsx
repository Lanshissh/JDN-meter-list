import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import axios from "axios";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

type Submission = {
  id: number;
  device_serial?: string | null;
  device_name?: string | null;

  reader_user_id: string;
  meter_id: string;

  reading_value: number;
  reading_date: string;

  remarks?: string | null;
  image_base64?: string | null;

  submitted_at: string;
  status: "pending" | "approved" | "rejected" | string;
};

function toText(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function pickMessage(data: any) {
  return data?.error || data?.message || data?.hint || (typeof data === "string" ? data : null);
}

export default function OfflineSubmissionsPanel() {
  const { token, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const api = useMemo(() => {
    return axios.create({
      baseURL: BASE_API,
      timeout: 25000,
      headers: { Authorization: `Bearer ${token ?? ""}` },
    });
  }, [token]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Submission[]>([]);
  const [error, setError] = useState<string>("");

  const fetchPending = async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const res = await api.get("/offlineExport/pending");

      const submissions = res.data?.submissions;
      if (Array.isArray(submissions)) {
        setItems(submissions);
      } else {
        setItems([]);
        setError(toText(pickMessage(res.data) || "Unexpected response from server."));
      }
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) ||
        e?.message ||
        "Failed to load pending submissions.";
      setError(toText(msg));
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && isAdmin) fetchPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  const approve = async (id: number) => {
    try {
      setLoading(true);
      await api.post(`/offlineExport/approve/${id}`);
      await fetchPending();
    } catch (e: any) {
      const msg = pickMessage(e?.response?.data) || e?.message || "Approve failed.";
      Alert.alert("Approve failed", toText(msg));
    } finally {
      setLoading(false);
    }
  };

  const reject = async (id: number) => {
    try {
      setLoading(true);
      await api.post(`/offlineExport/reject/${id}`);
      await fetchPending();
    } catch (e: any) {
      const msg = pickMessage(e?.response?.data) || e?.message || "Reject failed.";
      Alert.alert("Reject failed", toText(msg));
    } finally {
      setLoading(false);
    }
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
        <Text style={styles.title}>Offline Submissions (Pending)</Text>
        <TouchableOpacity style={styles.btn} onPress={fetchPending}>
          <Text style={styles.btnText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {!!error && <Text style={styles.err}>{toText(error)}</Text>}
      {loading ? <ActivityIndicator /> : null}

      <FlatList
        data={items}
        keyExtractor={(x) => String(x.id)}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshing={loading}
        onRefresh={fetchPending}
        ListEmptyComponent={<Text style={styles.empty}>No pending submissions.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.big}>Meter: {toText(item.meter_id)}</Text>
            <Text style={styles.meta}>Value: {Number(item.reading_value).toFixed(2)}</Text>
            <Text style={styles.meta}>Date: {toText(item.reading_date)}</Text>
            <Text style={styles.meta}>Reader: {toText(item.reader_user_id)}</Text>

            {!!item.device_serial && (
              <Text style={styles.meta}>Device: {toText(item.device_serial)} {item.device_name ? `(${toText(item.device_name)})` : ""}</Text>
            )}

            <Text style={styles.meta}>Submitted: {toText(item.submitted_at)}</Text>
            {!!item.remarks && <Text style={styles.meta}>Remarks: {toText(item.remarks)}</Text>}

            <Text style={styles.note}>Image stored: {item.image_base64 ? "✅" : "❌"}</Text>

            <View style={styles.row}>
              <TouchableOpacity style={[styles.smallBtn, styles.approveBtn]} onPress={() => approve(item.id)}>
                <Text style={styles.smallBtnText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn, styles.rejectBtn]} onPress={() => reject(item.id)}>
                <Text style={styles.smallBtnText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "800" },
  btn: { backgroundColor: "#47538b", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "700" },
  err: { color: "#c62828", marginBottom: 10 },
  empty: { opacity: 0.7, marginTop: 20, textAlign: "center" },
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: "#fff" },
  big: { fontWeight: "900" },
  meta: { opacity: 0.85, marginTop: 2 },
  note: { marginTop: 8, opacity: 0.7 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  smallBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  smallBtnText: { color: "#fff", fontWeight: "800" },
  approveBtn: { backgroundColor: "#2e7d32" },
  rejectBtn: { backgroundColor: "#d32f2f" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});