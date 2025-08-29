// components/admin/BuildingPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
} from "react-native";
import axios from "axios";
import { BASE_API } from "../../constants/api";

type Building = {
  building_id: string;
  building_name: string;
  last_updated?: string;
  updated_by?: string;
};

export default function BuildingPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  // create form
  const [name, setName] = useState("");

  // edit form
  const [editVisible, setEditVisible] = useState(false);
  const [editBuilding, setEditBuilding] = useState<Building | null>(null);
  const [editName, setEditName] = useState("");

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token],
  );

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: authHeader,
        timeout: 15000,
      }),
    [authHeader],
  );

  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      Alert.alert(
        "Not logged in",
        "Please log in as admin to manage buildings.",
      );
      return;
    }
    try {
      setBusy(true);
      const buildingsRes = await api.get<Building[]>("/buildings");
      setBuildings(buildingsRes.data || []);
    } catch (err: any) {
      Alert.alert(
        "Load failed",
        err?.response?.data?.error ?? "Connection error.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return buildings;
    return buildings.filter(
      (b) =>
        b.building_id.toLowerCase().includes(q) ||
        b.building_name.toLowerCase().includes(q),
    );
  }, [buildings, query]);

  const onCreate = async () => {
    const building_name = name.trim();
    if (!building_name) {
      Alert.alert("Missing info", "Please enter a building name.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.post("/buildings", { building_name });
      // backend returns { message, buildingId }
      const assignedId: string =
        res?.data?.buildingId ?? res?.data?.building_id ?? res?.data?.id ?? "";

      setName("");
      await loadAll();

      const msg = assignedId
        ? `Building created.\nID assigned: ${assignedId}`
        : "Building created.";
      Alert.alert("Success", msg);
    } catch (err: any) {
      Alert.alert(
        "Create failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (b: Building) => {
    setEditBuilding(b);
    setEditName(b.building_name);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editBuilding) return;
    const building_name = editName.trim();
    if (!building_name) {
      Alert.alert("Missing info", "Please enter a building name.");
      return;
    }
    try {
      setSubmitting(true);
      await api.put(
        `/buildings/${encodeURIComponent(editBuilding.building_id)}`,
        {
          building_name,
        },
      );
      setEditVisible(false);
      await loadAll();
      Alert.alert("Updated", "Building updated successfully.");
    } catch (err: any) {
      Alert.alert(
        "Update failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = (b: Building) =>
    Platform.OS === "web"
      ? Promise.resolve(
          (globalThis as any).confirm?.(
            `Delete building ${b.building_name}?`,
          ) ?? false,
        )
      : new Promise((resolve) => {
          Alert.alert(
            "Delete building",
            `Are you sure you want to delete ${b.building_name}?`,
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => resolve(false),
              },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => resolve(true),
              },
            ],
          );
        });

  const onDelete = async (b: Building) => {
    const ok = await confirmDelete(b);
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/buildings/${encodeURIComponent(b.building_id)}`);
      await loadAll();
      if (Platform.OS !== "web") Alert.alert("Deleted", "Building removed.");
    } catch (err: any) {
      // server explains if refs exist (users/tenants/stalls)
      Alert.alert(
        "Delete failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const Row = ({ item }: { item: Building }) => {
    const meta =
      (item.updated_by ? item.updated_by : "—") +
      (item.last_updated
        ? ` • ${new Date(item.last_updated).toLocaleString()}`
        : "");
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.building_name}</Text>
          <Text style={styles.rowSub}>
            {item.building_id}
            {meta ? ` • ${meta}` : ""}
          </Text>
        </View>
        <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
          <Text style={styles.linkText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.link, { marginLeft: 8 }]}
          onPress={() => onDelete(item)}
        >
          <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.grid}>
      {/* Create Building */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create Building</Text>
        <TextInput
          style={styles.input}
          placeholder="Building name"
          value={name}
          onChangeText={setName}
        />
        <TouchableOpacity
          style={[styles.btn, submitting && styles.btnDisabled]}
          onPress={onCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Create Building</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Manage Buildings */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Manage Buildings</Text>
        <TextInput
          style={styles.search}
          placeholder="Search by ID or name…"
          value={query}
          onChangeText={setQuery}
        />
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.building_id}
            scrollEnabled={Platform.OS === "web"}
            nestedScrollEnabled={false}
            ListEmptyComponent={
              <Text style={styles.empty}>No buildings found.</Text>
            }
            renderItem={({ item }) => <Row item={item} />}
          />
        )}
      </View>

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Building</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setEditVisible(false)}
              >
                <Text style={[styles.btnText, { color: "#102a43" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={onUpdate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Save changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    ...Platform.select({
      web: { boxShadow: "0 10px 30px rgba(0,0,0,0.15)" as any },
      default: { elevation: 3 },
    }),
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: "#102a43",
    marginTop: 6,
  },
  btn: {
    marginTop: 12,
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.7 },
  btnGhost: { backgroundColor: "#e6efff" },
  btnText: { color: "#fff", fontWeight: "700" },

  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },

  row: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    backgroundColor: "#fdfefe",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  rowTitle: { fontWeight: "700", color: "#102a43" },
  rowSub: { color: "#627d98", marginTop: 2, fontSize: 12 },
  link: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#eef2ff",
  },
  linkText: { color: "#1f4bd8", fontWeight: "700" },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    ...Platform.select({
      web: { boxShadow: "0 20px 60px rgba(0,0,0,0.35)" as any },
      default: { elevation: 6 },
    }),
  },
  modalTitle: {
    fontWeight: "800",
    fontSize: 18,
    color: "#102a43",
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
});
