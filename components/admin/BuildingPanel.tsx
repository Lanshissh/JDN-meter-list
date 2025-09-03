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

/** ------------ ALERT HELPERS (web + mobile) ------------ */
function notify(title: string, message?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

function errorText(err: any, fallback = "Server error.") {
  const d = err?.response?.data;
  if (typeof d === "string") return d;
  if (d?.error) return String(d.error);
  if (d?.message) return String(d.message);
  if (err?.message) return String(err.message);
  try { return JSON.stringify(d ?? err); } catch { return fallback; }
}

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return Promise.resolve(!!window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
/** ------------------------------------------------------ */

export default function BuildingPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  // create form (now in a modal)
  const [createVisible, setCreateVisible] = useState(false);
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
      notify("Not logged in", "Please log in as admin to manage buildings.");
      return;
    }
    try {
      setBusy(true);
      const buildingsRes = await api.get<Building[]>("/buildings");
      setBuildings(buildingsRes.data || []);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
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
      notify("Missing info", "Please enter a building name.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.post("/buildings", { building_name });
      // backend returns { message, buildingId } (or similar)
      const assignedId: string =
        res?.data?.buildingId ?? res?.data?.building_id ?? res?.data?.id ?? "";

      setName("");
      setCreateVisible(false);
      await loadAll();

      const msg = assignedId
        ? `Building created.\nID assigned: ${assignedId}`
        : "Building created.";
      notify("Success", msg);
    } catch (err: any) {
      notify("Create failed", errorText(err));
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
      notify("Missing info", "Please enter a building name.");
      return;
    }
    try {
      setSubmitting(true);
      await api.put(`/buildings/${encodeURIComponent(editBuilding.building_id)}`, {
        building_name,
      });
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Building updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (b: Building) => {
    const ok = await confirm(
      "Delete building",
      `Are you sure you want to delete ${b.building_name}?`,
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/buildings/${encodeURIComponent(b.building_id)}`);
      await loadAll();
      notify("Deleted", "Building removed.");
    } catch (err: any) {
      // Surfaces dependency errors like:
      // "Cannot delete building. It is still referenced by: ..."
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const Row = ({ item }: { item: Building }) => {
    const meta =
      (item.updated_by ? item.updated_by : "—") +
      (item.last_updated ? ` • ${new Date(item.last_updated).toLocaleString()}` : "");
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
          <Text style={styles.linkText}>Update</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => onDelete(item)}>
          <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.grid}>
      {/* Manage Buildings + Create button */}
      <View style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <Text style={styles.cardTitle}>Manage Buildings</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
            <Text style={styles.btnText}>+ Create Building</Text>
          </TouchableOpacity>
        </View>

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
            ListEmptyComponent={<Text style={styles.empty}>No buildings found.</Text>}
            renderItem={({ item }) => <Row item={item} />}
          />
        )}
      </View>

      {/* Create Modal */}
      <Modal visible={createVisible} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Building</Text>
            <TextInput
              style={styles.input}
              placeholder="Building name"
              value={name}
              onChangeText={setName}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setCreateVisible(false)}>
                <Text style={[styles.btnText, { color: "#102a43" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={onCreate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Building</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Building</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                <Text style={[styles.btnText, { color: "#102a43" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={onUpdate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save changes</Text>}
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
    paddingHorizontal: 12,
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