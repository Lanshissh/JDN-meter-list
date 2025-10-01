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
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

type Building = {
  building_id: string;
  building_name: string;
  erate_perKwH?: number | null;
  emin_con?: number | null;
  wrate_perCbM?: number | null;
  wmin_con?: number | null;
  lrate_perKg?: number | null;
  last_updated?: string;
  updated_by?: string;
};

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
  try {
    return JSON.stringify(d ?? err);
  } catch {
    return fallback;
  }
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

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number | null | undefined, unit?: string) => {
  if (n == null || !isFinite(Number(n))) return "—";
  const out = Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
  return unit ? `${out} ${unit}` : out;
};

export default function BuildingPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");
  type SortMode = "newest" | "oldest" | "name" | "id";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const [createVisible, setCreateVisible] = useState(false);
  const [name, setName] = useState("");
  const [c_eRate, setC_eRate] = useState("");
  const [c_eMin, setC_eMin] = useState("");
  const [c_wRate, setC_wRate] = useState("");
  const [c_wMin, setC_wMin] = useState("");
  const [c_lRate, setC_lRate] = useState("");

  const [editVisible, setEditVisible] = useState(false);
  const [editBuilding, setEditBuilding] = useState<Building | null>(null);
  const [editName, setEditName] = useState("");
  const [e_eRate, setE_eRate] = useState("");
  const [e_eMin, setE_eMin] = useState("");
  const [e_wRate, setE_wRate] = useState("");
  const [e_wMin, setE_wMin] = useState("");
  const [e_lRate, setE_lRate] = useState("");

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
      const res = await api.get<Building[]>("/buildings");
      setBuildings(res.data || []);
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
    let list = buildings;
    if (q) {
      list = list.filter((b) =>
        [b.building_id, b.building_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    const arr = [...list];
    switch (sortMode) {
      case "name":
        arr.sort((a, b) => a.building_name.localeCompare(b.building_name));
        break;
      case "id":
        arr.sort((a, b) => a.building_id.localeCompare(b.building_id));
        break;
      case "oldest":
        arr.sort(
          (a, b) =>
            (Date.parse(a.last_updated || "") || 0) -
            (Date.parse(b.last_updated || "") || 0),
        );
        break;
      case "newest":
      default:
        arr.sort(
          (a, b) =>
            (Date.parse(b.last_updated || "") || 0) -
            (Date.parse(a.last_updated || "") || 0),
        );
        break;
    }
    return arr;
  }, [buildings, query, sortMode]);

  const onCreate = async () => {
    const building_name = name.trim();
    if (!building_name) {
      notify("Missing info", "Please enter a building name.");
      return;
    }
    try {
      setSubmitting(true);
      const body: any = {
        building_name,
        erate_perKwH: toNum(c_eRate),
        emin_con: toNum(c_eMin),
        wrate_perCbM: toNum(c_wRate),
        wmin_con: toNum(c_wMin),
        lrate_perKg: toNum(c_lRate),
      };
      await api.post("/buildings", body);
      setName("");
      setC_eRate("");
      setC_eMin("");
      setC_wRate("");
      setC_wMin("");
      setC_lRate("");
      setCreateVisible(false);
      await loadAll();
      notify("Success", "Building created.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (b: Building) => {
    setEditBuilding(b);
    setEditName(b.building_name);
    setE_eRate(b.erate_perKwH != null ? String(b.erate_perKwH) : "");
    setE_eMin(b.emin_con != null ? String(b.emin_con) : "");
    setE_wRate(b.wrate_perCbM != null ? String(b.wrate_perCbM) : "");
    setE_wMin(b.wmin_con != null ? String(b.wmin_con) : "");
    setE_lRate(b.lrate_perKg != null ? String(b.lrate_perKg) : "");
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
      const body: any = {
        building_name,
        erate_perKwH: toNum(e_eRate),
        emin_con: toNum(e_eMin),
        wrate_perCbM: toNum(e_wRate),
        wmin_con: toNum(e_wMin),
        lrate_perKg: toNum(e_lRate),
      };
      await api.put(
        `/buildings/${encodeURIComponent(editBuilding.building_id)}`,
        body,
      );
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
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const Chip = ({
    label,
    active,
    onPress,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
    >
      <Text
        style={[
          styles.chipText,
          active ? styles.chipTextActive : styles.chipTextIdle,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const Empty = ({ title, note }: { title: string; note?: string }) => (
    <View style={styles.emptyWrap}>
      <Ionicons name="business-outline" size={28} color="#94a3b8" />
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!note && <Text style={styles.emptyNote}>{note}</Text>}
    </View>
  );

  const Row = ({ item }: { item: Building }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.building_name}</Text>
        <Text style={styles.rowSub}>{item.building_id}</Text>
      </View>
      <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
        <Text style={styles.linkText}>Update</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.link, { marginLeft: 8 }]}
        onPress={() => onDelete(item)}
      >
        <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.grid}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Manage Buildings</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => setCreateVisible(true)}
          >
            <Text style={styles.btnText}>+ Create Building</Text>
          </TouchableOpacity>
        </View>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Ionicons
            name="search"
            size={16}
            color="#94a3b8"
            style={{ marginRight: 6 }}
          />
          <TextInput
            style={styles.search}
            placeholder="Search by ID or name…"
            placeholderTextColor="#9aa5b1"
            value={query}
            onChangeText={setQuery}
          />
        </View>

        {/* Filters below search */}
        <View style={styles.filtersRow}>
          <Text style={styles.filterLabel}>Sort by</Text>
          <View style={styles.chipsRow}>
            {(
              [
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "Name", val: "name" },
                { label: "ID", val: "id" },
              ] as const
            ).map(({ label, val }) => (
              <Chip
                key={label}
                label={label}
                active={sortMode === (val as any)}
                onPress={() => setSortMode(val as any)}
              />
            ))}
          </View>
        </View>

        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(b) => b.building_id}
            style={{ marginTop: 4 }}
            ListEmptyComponent={
              <Empty
                title="No buildings found"
                note="Try adjusting filters or create a new building."
              />
            }
            renderItem={Row}
          />
        )}
      </View>

      {/* CREATE MODAL */}
      <Modal
        visible={createVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Building</Text>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Building name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Building A"
                  placeholderTextColor="#9aa5b1"
                  value={name}
                  onChangeText={setName}
                />
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.dropdownLabel}>Electric</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Rate per kWh"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={c_eRate}
                    onChangeText={setC_eRate}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Min. consumption"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={c_eMin}
                    onChangeText={setC_eMin}
                  />
                </View>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.dropdownLabel}>Water (optional)</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Rate per m³"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={c_wRate}
                    onChangeText={setC_wRate}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Min. consumption"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={c_wMin}
                    onChangeText={setC_wMin}
                  />
                </View>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.dropdownLabel}>LPG (optional)</Text>
                <TextInput
                  style={[styles.input, { marginTop: 6 }]}
                  placeholder="Rate per kg"
                  placeholderTextColor="#9aa5b1"
                  keyboardType="numeric"
                  value={c_lRate}
                  onChangeText={setC_lRate}
                />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.link}
                onPress={() => setCreateVisible(false)}
              >
                <Text style={styles.linkText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={onCreate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* UPDATE MODAL */}
      <Modal
        visible={editVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Building</Text>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Building name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Building name"
                  placeholderTextColor="#9aa5b1"
                  value={editName}
                  onChangeText={setEditName}
                />
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.dropdownLabel}>Electric</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Rate per kWh"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={e_eRate}
                    onChangeText={setE_eRate}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Min. consumption"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={e_eMin}
                    onChangeText={setE_eMin}
                  />
                </View>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.dropdownLabel}>Water (optional)</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Rate per m³"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={e_wRate}
                    onChangeText={setE_wRate}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    placeholder="Min. consumption"
                    placeholderTextColor="#9aa5b1"
                    keyboardType="numeric"
                    value={e_wMin}
                    onChangeText={setE_wMin}
                  />
                </View>
              </View>

              <View style={{ marginTop: 10 }}>
                <Text style={styles.dropdownLabel}>LPG (optional)</Text>
                <TextInput
                  style={[styles.input, { marginTop: 6 }]}
                  placeholder="Rate per kg"
                  placeholderTextColor="#9aa5b1"
                  keyboardType="numeric"
                  value={e_lRate}
                  onChangeText={setE_lRate}
                />
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.link}
                onPress={() => setEditVisible(false)}
              >
                <Text style={styles.linkText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={onUpdate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flex: 1, padding: 12, gap: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(2,10,50,0.06)" as any },
      default: { elevation: 1 },
    }) as any),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#102a43" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e2e8f0",
  },
  search: { flex: 1, fontSize: 14, color: "#0b1f33" },
  btn: {
    backgroundColor: "#0f62fe",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
   // top filters + search layout
  filtersBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "flex-start",
    marginTop: 6,
  },

  filterCol: { minWidth: 220, flexShrink: 1 },

  dropdownLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#486581",
    marginBottom: 6,
  },

  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipIdle: { borderColor: "#94a3b8", backgroundColor: "#fff" },
  chipActive: { borderColor: "#2563eb", backgroundColor: "#2563eb" },
  chipText: { fontSize: 12 },
  chipTextIdle: { color: "#334e68" },
  chipTextActive: { color: "#fff" },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#edf2f7",
  },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#102a43" },
  rowSub: { fontSize: 12, color: "#627d98", marginTop: 2 },
  link: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
  },
  linkText: { color: "#0b1f33", fontWeight: "700" },

  // Modal base
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    width: "100%",
    maxWidth: 640,
    maxHeight: Platform.OS === "web" ? 700 : undefined,
    ...(Platform.select({
      web: { boxShadow: "0 12px 30px rgba(16,42,67,0.25)" as any },
      default: { elevation: 4 },
    }) as any),
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0b1f33",
    marginBottom: 4,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 10,
  },

  // Inputs
  input: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0b1f33",
    fontSize: 14,
    marginTop: 4,
  },
  rowWrap: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "flex-start",
  },

  // Rates summary
  rateRow: { flexDirection: "row", gap: 10, marginTop: 6, flexWrap: "wrap" },
  rateCol: { flexDirection: "row", gap: 6, alignItems: "center" },
  rateLabel: { fontSize: 12, fontWeight: "700", color: "#475569" },
  rateVal: { fontSize: 12, color: "#1f2937" },

  // Misc
  loader: { paddingVertical: 20, alignItems: "center" },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
    gap: 8,
  },
  emptyTitle: { color: "#486581", fontWeight: "700" },
  emptyNote: { color: "#7b8794", fontSize: 12 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
  filtersRow: {
    marginTop: 10,
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
});