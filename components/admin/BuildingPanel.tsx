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
  KeyboardAvoidingView,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

/** Types (matches backend routes/buildings.js) */
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

/** Helpers */
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
const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // match backend DECIMAL(10,2) rounding
  return Math.round(n * 100) / 100;
};
const fmt = (n: number | null | undefined, unit?: string) => {
  if (n == null || !isFinite(Number(n))) return "—";
  const out = Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(n));
  return unit ? `${out} ${unit}` : out;
};

/** Tiny chip */
const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
  </TouchableOpacity>
);

export default function BuildingPanel({ token }: { token: string | null }) {
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // search + sort
  const [query, setQuery] = useState("");
  type SortMode = "newest" | "oldest" | "name" | "id";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // filters modal
  const [filtersVisible, setFiltersVisible] = useState(false);

  // create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [name, setName] = useState("");
  const [c_eRate, setC_eRate] = useState("");
  const [c_eMin, setC_eMin] = useState("");
  const [c_wRate, setC_wRate] = useState("");
  const [c_wMin, setC_wMin] = useState("");
  const [c_lRate, setC_lRate] = useState("");

  // edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editBuilding, setEditBuilding] = useState<Building | null>(null);
  const [editName, setEditName] = useState("");
  const [e_eRate, setE_eRate] = useState("");
  const [e_eMin, setE_eMin] = useState("");
  const [e_wRate, setE_wRate] = useState("");
  const [e_wMin, setE_wMin] = useState("");
  const [e_lRate, setE_lRate] = useState("");

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  const loadAll = async () => {
    if (!token) { setBusy(false); notify("Not logged in", "Please log in as admin to manage buildings."); return; }
    try {
      setBusy(true);
      // Backend: GET /buildings is admin-only; others will get 403. :contentReference[oaicite:3]{index=3}
      const res = await api.get<Building[]>("/buildings");
      setBuildings(res.data || []);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) notify("Unauthorized", "Your session expired. Please log in again.");
      else if (status === 403) notify("Forbidden", "Only administrators can view buildings.");
      else notify("Load failed", errorText(err, "Connection error."));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { loadAll(); }, [token]);

  /** Derived list */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = buildings;
    if (q) {
      list = list.filter((b) =>
        [b.building_id, b.building_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const arr = [...list];
    switch (sortMode) {
      case "name": arr.sort((a, b) => a.building_name.localeCompare(b.building_name)); break;
      case "id": arr.sort((a, b) => a.building_id.localeCompare(b.building_id)); break;
      case "oldest": arr.sort((a, b) => (Date.parse(a.last_updated || "") || 0) - (Date.parse(b.last_updated || "") || 0)); break;
      case "newest":
      default: arr.sort((a, b) => (Date.parse(b.last_updated || "") || 0) - (Date.parse(a.last_updated || "") || 0)); break;
    }
    return arr;
  }, [buildings, query, sortMode]);

  /** CRUD (aligned with routes/buildings.js) */
  const onCreate = async () => {
    const building_name = name.trim();
    if (!building_name) { notify("Missing info", "Please enter a building name."); return; }
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
      // Backend POST /buildings (admin-only). :contentReference[oaicite:4]{index=4}
      await api.post("/buildings", body);
      setName(""); setC_eRate(""); setC_eMin(""); setC_wRate(""); setC_wMin(""); setC_lRate("");
      setCreateVisible(false);
      await loadAll();
      notify("Success", "Building created.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally { setSubmitting(false); }
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
    if (!building_name) { notify("Missing info", "Please enter a building name."); return; }
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
      // Backend PUT /buildings/:id (admin; biller may be partially allowed server-side). :contentReference[oaicite:5]{index=5}
      await api.put(`/buildings/${encodeURIComponent(editBuilding.building_id)}`, body);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Building updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const onDelete = async (b: Building) => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const ok = window.confirm(`Delete ${b.building_name} (${b.building_id})?`);
      if (!ok) return;
    }
    try {
      setSubmitting(true);
      await api.delete(`/buildings/${encodeURIComponent(b.building_id)}`);
      await loadAll();
      notify("Deleted", "Building deleted.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  /** UI */
  return (
    <View style={styles.page}>
      <View style={styles.grid}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Manage Buildings</Text>
            <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
              <Text style={styles.btnText}>+ Create Building</Text>
            </TouchableOpacity>
          </View>

          {/* Search + filters */}
          <View style={styles.toolbar}>
            <View style={[styles.searchWrap, { flex: 1 }]}>
              <Ionicons name="search-outline" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or ID…"
                value={query}
                onChangeText={setQuery}
              />
            </View>
            <TouchableOpacity style={styles.btnGhost} onPress={() => setFiltersVisible(true)}>
              <Ionicons name="funnel-outline" size={16} color="#334155" />
              <Text style={styles.btnGhostText}>Filters</Text>
            </TouchableOpacity>
          </View>

          {/* List */}
          {busy ? (
            <ActivityIndicator size="small" color="#64748b" style={{ marginTop: 12 }} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.building_id}
              contentContainerStyle={{ paddingVertical: 6 }}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.building_name}</Text>
                    <Text style={styles.rowSub}>{item.building_id}</Text>
                  </View>
                  <View style={styles.rateCol}>
                    <Text style={styles.rateLine}>E-rate: {fmt(item.erate_perKwH, "₱/kWh")} • Min: {fmt(item.emin_con)}</Text>
                    <Text style={styles.rateLine}>W-rate: {fmt(item.wrate_perCbM, "₱/m³")} • Min: {fmt(item.wmin_con)}</Text>
                    <Text style={styles.rateLine}>LPG: {fmt(item.lrate_perKg, "₱/kg")}</Text>
                  </View>
                  <View style={styles.rowActions}>
                    <TouchableOpacity style={styles.actBtn} onPress={() => openEdit(item)}>
                      <Ionicons name="create-outline" size={18} color="#0ea5e9" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actBtn} onPress={() => onDelete(item)}>
                      <Ionicons name="trash-outline" size={18} color="#ef4444" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <Text style={{ textAlign: "center", color: "#64748b", marginTop: 14 }}>
                  No buildings found.
                </Text>
              }
            />
          )}
        </View>
      </View>

      {/* Filters modal (sort only for now) */}
      <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Sort by</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip label="Newest"  active={sortMode === "newest"} onPress={() => setSortMode("newest")} />
              <Chip label="Oldest"  active={sortMode === "oldest"} onPress={() => setSortMode("oldest")} />
              <Chip label="Name"    active={sortMode === "name"}   onPress={() => setSortMode("name")} />
              <Chip label="ID"      active={sortMode === "id"}     onPress={() => setSortMode("id")} />
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.btn} onPress={() => setFiltersVisible(false)}>
                <Text style={styles.btnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create modal */}
      <Modal visible={createVisible} animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.formCard}>
            <Text style={styles.formTitle}>Create Building</Text>
            <TextInput style={styles.input} placeholder="Building name" value={name} onChangeText={setName} />

            <Text style={styles.formGroupLabel}>Electric</Text>
            <TextInput style={styles.input} placeholder="E-rate (₱/kWh)" keyboardType="numeric" value={c_eRate} onChangeText={setC_eRate} />
            <TextInput style={styles.input} placeholder="E-min consumption" keyboardType="numeric" value={c_eMin} onChangeText={setC_eMin} />

            <Text style={styles.formGroupLabel}>Water</Text>
            <TextInput style={styles.input} placeholder="W-rate (₱/m³)" keyboardType="numeric" value={c_wRate} onChangeText={setC_wRate} />
            <TextInput style={styles.input} placeholder="W-min consumption" keyboardType="numeric" value={c_wMin} onChangeText={setC_wMin} />

            <Text style={styles.formGroupLabel}>LPG</Text>
            <TextInput style={styles.input} placeholder="LPG rate (₱/kg)" keyboardType="numeric" value={c_lRate} onChangeText={setC_lRate} />

            <View style={styles.formActions}>
              <TouchableOpacity style={[styles.btn, submitting && { opacity: 0.6 }]} disabled={submitting} onPress={onCreate}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setCreateVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit modal */}
      <Modal visible={editVisible} animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.formCard}>
            <Text style={styles.formTitle}>Edit Building</Text>
            <TextInput style={styles.input} placeholder="Building name" value={editName} onChangeText={setEditName} />

            <Text style={styles.formGroupLabel}>Electric</Text>
            <TextInput style={styles.input} placeholder="E-rate (₱/kWh)" keyboardType="numeric" value={e_eRate} onChangeText={setE_eRate} />
            <TextInput style={styles.input} placeholder="E-min consumption" keyboardType="numeric" value={e_eMin} onChangeText={setE_eMin} />

            <Text style={styles.formGroupLabel}>Water</Text>
            <TextInput style={styles.input} placeholder="W-rate (₱/m³)" keyboardType="numeric" value={e_wRate} onChangeText={setE_wRate} />
            <TextInput style={styles.input} placeholder="W-min consumption" keyboardType="numeric" value={e_wMin} onChangeText={setE_wMin} />

            <Text style={styles.formGroupLabel}>LPG</Text>
            <TextInput style={styles.input} placeholder="LPG rate (₱/kg)" keyboardType="numeric" value={e_lRate} onChangeText={setE_lRate} />

            <View style={styles.formActions}>
              <TouchableOpacity style={[styles.btn, submitting && { opacity: 0.6 }]} disabled={submitting} onPress={onUpdate}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setEditVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** Styles */
const styles = StyleSheet.create({
  page: { flex: 1, padding: 12 },
  grid: { flex: 1 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: "#0f172a" },
  btn: { backgroundColor: "#0f766e", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnText: { color: "#fff", fontWeight: "600" },
  btnGhost: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  btnGhostText: { color: "#334155", fontWeight: "600" },
  toolbar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f1f5f9", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, paddingVertical: 4, color: "#0f172a" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e2e8f0" },
  rowTitle: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  rowSub: { color: "#64748b", fontSize: 12 },
  rateCol: { flex: 2, gap: 2 },
  rateLine: { color: "#334155" },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8 },
  actBtn: { padding: 6, borderRadius: 8, backgroundColor: "#f8fafc" },

  // chips
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#0ea5e9" },
  chipIdle: { backgroundColor: "#e2e8f0" },
  chipText: { fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  chipTextIdle: { color: "#334155" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(2,6,23,0.5)", alignItems: "center", justifyContent: "center", padding: 16 },
  modalCard: { width: "100%", maxWidth: 520, borderRadius: 12, backgroundColor: "#fff", padding: 16, gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  modalFooter: { flexDirection: "row", justifyContent: "flex-end" },

  formCard: { padding: 16, gap: 10 },
  formTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  formGroupLabel: { marginTop: 10, marginBottom: 4, fontWeight: "600", color: "#0f172a" },
  input: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10, fontSize: 14, color: "#0f172a", backgroundColor: "#fff" },
  formActions: { marginTop: 12, flexDirection: "row", gap: 10, alignItems: "center" },
});