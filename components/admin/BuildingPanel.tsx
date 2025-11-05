// components/admin/BuildingPanel.tsx (FULL CRUD: list, create, update, delete)
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

/** Types (aligned with backend /buildings) */
type Building = {
  building_id: string;
  building_name: string;
  erate_perKwH?: number | null;
  emin_con?: number | null;
  wrate_perCbM?: number | null;
  wmin_con?: number | null;
  lrate_perKg?: number | null;
  markup_rate?: number | null; // NEW
  last_updated?: string | null;
  updated_by?: string | null;
};

type Props = { token: string | null };

/* Helpers */
function notify(title: string, message?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && (window as any).alert) {
    (window as any).alert(message ? `${title}

${message}` : title);
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
  return Number.isFinite(n) ? n : null;
};
const fmt = (n?: number | null, unit?: string) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const out = Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
  return unit ? `${out} ${unit}` : out;
};

const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
  </TouchableOpacity>
);

// cross-platform confirm dialog that returns a Promise<boolean>
const askConfirm = (title: string, message: string): Promise<boolean> => {
  if (Platform.OS === "web" && typeof window !== "undefined" && (window as any).confirm) {
    const ok = (window as any).confirm(`${title}

${message}`);
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
};

export default function BuildingPanel({ token }: Props) {
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // search + sort
  const [query, setQuery] = useState("");
  type SortMode = "newest" | "oldest" | "name" | "id";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // filters modal (placeholder for future)
  const [filtersVisible, setFiltersVisible] = useState(false);

  // create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [c_name, setC_name] = useState("");
  const [c_eRate, setC_eRate] = useState("");
  const [c_eMin, setC_eMin] = useState("");
  const [c_wRate, setC_wRate] = useState("");
  const [c_wMin, setC_wMin] = useState("");
  const [c_lRate, setC_lRate] = useState("");
  const [c_markup, setC_markup] = useState(""); // NEW

  // edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Building | null>(null);
  const [e_name, setE_name] = useState("");
  const [e_eRate, setE_eRate] = useState("");
  const [e_eMin, setE_eMin] = useState("");
  const [e_wRate, setE_wRate] = useState("");
  const [e_wMin, setE_wMin] = useState("");
  const [e_lRate, setE_lRate] = useState("");
  const [e_markup, setE_markup] = useState(""); // NEW

  // axios
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  /* Load */
  useEffect(() => { loadAll(); }, [token]);
  const loadAll = async () => {
    if (!token) { setBusy(false); notify("Not logged in", "Please log in as admin to manage buildings."); return; }
    try {
      setBusy(true);
      const res = await api.get<Building[]>("/buildings");
      setBuildings(res.data || []);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally { setBusy(false); }
  };

  /* Derived list */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = buildings;
    if (q) list = list.filter((b) => [b.building_id, b.building_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
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

  /* CRUD */
  const onCreate = async () => {
    const building_name = c_name.trim();
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
        markup_rate: toNum(c_markup), // NEW
      };
      await api.post("/buildings", body);
      setCreateVisible(false);
      setC_name(""); setC_eRate(""); setC_eMin(""); setC_wRate(""); setC_wMin(""); setC_lRate(""); setC_markup("");
      await loadAll();
      notify("Success", "Building created.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const openEdit = (b: Building) => {
    setEditRow(b);
    setE_name(b.building_name || "");
    setE_eRate(b.erate_perKwH != null ? String(b.erate_perKwH) : "");
    setE_eMin(b.emin_con != null ? String(b.emin_con) : "");
    setE_wRate(b.wrate_perCbM != null ? String(b.wrate_perCbM) : "");
    setE_wMin(b.wmin_con != null ? String(b.wmin_con) : "");
    setE_lRate(b.lrate_perKg != null ? String(b.lrate_perKg) : "");
    setE_markup(b.markup_rate != null ? String(b.markup_rate) : "");
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editRow) return;
    const building_name = e_name.trim();
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
        markup_rate: toNum(e_markup), // NEW
      };
      await api.put(`/buildings/${encodeURIComponent(editRow.building_id)}`, body);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Building updated.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const onDelete = async (row: Building) => {
    const ok = await askConfirm("Delete building?", `This will permanently remove “${row.building_name}”. This action cannot be undone.`);
    if (!ok) return;
    try {
      setDeletingId(row.building_id);
      await api.delete(`/buildings/${encodeURIComponent(row.building_id)}`);
      // close edit modal if we deleted the currently open row
      if (editVisible && editRow?.building_id === row.building_id) setEditVisible(false);
      await loadAll();
      notify("Deleted", "Building removed.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally {
      setDeletingId(null);
    }
  };

  /* UI */
  const Header = () => (
    <View style={styles.headerRow}>
      <Text style={styles.title}>Buildings</Text>
      <Text style={styles.subtitle}>Manage base utility rates, markup, and metadata. Total: {buildings.length}</Text>
    </View>
  );

  const Toolbar = () => (
    <View style={styles.toolbar}>
      <View style={[styles.searchWrap, { flex: 1 }]}>
        <Ionicons name="search" size={16} color="#667085" style={{ marginRight: 6 }} />
        <TextInput
          placeholder="Search by name or ID"
          placeholderTextColor="#98A2B3"
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
        />
      </View>

      <TouchableOpacity onPress={() => setFiltersVisible(true)} style={styles.btnGhost}>
        <Ionicons name="filter" size={16} color="#344054" />
        <Text style={styles.btnGhostText}>Filters</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setCreateVisible(true)} style={styles.btnPrimary}>
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.btnPrimaryText}>Add</Text>
      </TouchableOpacity>
    </View>
  );

  const SortChips = () => (
    <View style={styles.chipsRow}>
      <Chip label="Newest" active={sortMode === "newest"} onPress={() => setSortMode("newest")} />
      <Chip label="Oldest" active={sortMode === "oldest"} onPress={() => setSortMode("oldest")} />
      <Chip label="Name" active={sortMode === "name"} onPress={() => setSortMode("name")} />
      <Chip label="ID" active={sortMode === "id"} onPress={() => setSortMode("id")} />
    </View>
  );

  const Row = ({ item }: { item: Building }) => (
    <View style={styles.row}>
      <View style={[styles.cell, { flex: 1.2 }]}><Text style={styles.cellTitle}>{item.building_name}</Text><Text style={styles.cellSub}>{item.building_id}</Text></View>
      <View style={styles.cell}><Text style={styles.mono}>{fmt(item.erate_perKwH, "₱/kWh")}</Text></View>
      <View style={styles.cell}><Text style={styles.mono}>{fmt(item.emin_con, "kWh")}</Text></View>
      <View style={styles.cell}><Text style={styles.mono}>{fmt(item.wrate_perCbM, "₱/m³")}</Text></View>
      <View style={styles.cell}><Text style={styles.mono}>{fmt(item.wmin_con, "m³")}</Text></View>
      <View style={styles.cell}><Text style={styles.mono}>{fmt(item.lrate_perKg, "₱/kg")}</Text></View>
      <View style={styles.cell}><Text style={[styles.mono, styles.badge]}>{fmt(item.markup_rate, "%")}</Text></View>
      <View style={[styles.cell, { minWidth: 120 }]}>
        <Text style={styles.cellSub} numberOfLines={1}>
          {item.last_updated ? new Date(item.last_updated).toLocaleString() : ""}
        </Text>
        <Text style={styles.cellSub} numberOfLines={1}>{item.updated_by || ""}</Text>
      </View>
      <View style={[styles.cell, styles.actions]}>
        <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn} accessibilityLabel="Edit">
          <Ionicons name="create-outline" size={18} color="#344054" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onDelete(item)}
          style={[styles.iconBtn, { backgroundColor: "#FEE4E2" }]}
          accessibilityLabel="Delete"
          disabled={deletingId === item.building_id}
        >
          {deletingId === item.building_id ? (
            <ActivityIndicator />
          ) : (
            <Ionicons name="trash-outline" size={18} color="#B42318" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.page}>
      <Header />
      <Toolbar />
      <SortChips />

      {busy ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.building_id}
          renderItem={Row}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={<Text style={styles.empty}>No buildings found.</Text>}
        />
      )}

      {/* Filters Modal (placeholder UI) */}
      <Modal visible={filtersVisible} transparent animationType="fade" onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filters</Text>
            <Text style={styles.modalHint}>No advanced filters yet.</Text>
            <View style={{ height: 12 }} />
            <TouchableOpacity onPress={() => setFiltersVisible(false)} style={styles.btnPrimary}>
              <Text style={styles.btnPrimaryText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Create Modal */}
      <Modal visible={createVisible} transparent animationType="slide" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={[styles.modalCard, { alignItems: "stretch" }]}>            
            <Text style={styles.modalTitle}>New Building</Text>
            <TextInput placeholder="Building name" value={c_name} onChangeText={setC_name} style={styles.input} />
            <View style={styles.grid2}>
              <TextInput placeholder="Electric rate ₱/kWh" keyboardType="numeric" value={c_eRate} onChangeText={setC_eRate} style={styles.input} />
              <TextInput placeholder="Electric min kWh" keyboardType="numeric" value={c_eMin} onChangeText={setC_eMin} style={styles.input} />
              <TextInput placeholder="Water rate ₱/m³" keyboardType="numeric" value={c_wRate} onChangeText={setC_wRate} style={styles.input} />
              <TextInput placeholder="Water min m³" keyboardType="numeric" value={c_wMin} onChangeText={setC_wMin} style={styles.input} />
              <TextInput placeholder="LPG rate ₱/kg" keyboardType="numeric" value={c_lRate} onChangeText={setC_lRate} style={styles.input} />
              <TextInput placeholder="Markup %" keyboardType="numeric" value={c_markup} onChangeText={setC_markup} style={styles.input} />
            </View>
            <View style={styles.rowEnd}>
              <TouchableOpacity onPress={() => setCreateVisible(false)} style={styles.btnGhost}>                
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onCreate} disabled={submitting} style={[styles.btnPrimary, submitting && { opacity: 0.7 }]}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editVisible} transparent animationType="slide" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={[styles.modalCard, { alignItems: "stretch" }]}>            
            <Text style={styles.modalTitle}>Edit Building</Text>
            <Text style={styles.modalHint}>{editRow?.building_id}</Text>
            <TextInput placeholder="Building name" value={e_name} onChangeText={setE_name} style={styles.input} />
            <View style={styles.grid2}>
              <TextInput placeholder="Electric rate ₱/kWh" keyboardType="numeric" value={e_eRate} onChangeText={setE_eRate} style={styles.input} />
              <TextInput placeholder="Electric min kWh" keyboardType="numeric" value={e_eMin} onChangeText={setE_eMin} style={styles.input} />
              <TextInput placeholder="Water rate ₱/m³" keyboardType="numeric" value={e_wRate} onChangeText={setE_wRate} style={styles.input} />
              <TextInput placeholder="Water min m³" keyboardType="numeric" value={e_wMin} onChangeText={setE_wMin} style={styles.input} />
              <TextInput placeholder="LPG rate ₱/kg" keyboardType="numeric" value={e_lRate} onChangeText={setE_lRate} style={styles.input} />
              <TextInput placeholder="Markup %" keyboardType="numeric" value={e_markup} onChangeText={setE_markup} style={styles.input} />
            </View>
            <View style={[styles.rowEnd, { justifyContent: "space-between" }]}>
              <TouchableOpacity
                onPress={() => onDelete(editRow as Building)}
                style={[styles.btnGhost, { borderColor: "#FEE4E2", backgroundColor: "#FEF3F2" }]}
                disabled={!editRow || deletingId === editRow?.building_id}
              >
                {deletingId === editRow?.building_id ? (
                  <ActivityIndicator />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={16} color="#B42318" />
                    <Text style={[styles.btnGhostText, { color: "#B42318" }]}>Delete</Text>
                  </>
                )}
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => setEditVisible(false)} style={styles.btnGhost}>                
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={onUpdate} disabled={submitting} style={[styles.btnPrimary, submitting && { opacity: 0.7 }]}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/* Styles */
const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  headerRow: { marginBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", color: "#101828" },
  subtitle: { color: "#475467", marginTop: 2 },

  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 10 },
  searchWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: "#D0D5DD", paddingHorizontal: 10, borderRadius: 10, height: 40, backgroundColor: "#fff" },
  searchInput: { flex: 1, paddingVertical: 6, fontSize: 14, color: "#101828" },

  btnPrimary: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#082cac", paddingHorizontal: 14, height: 40, borderRadius: 10 },
  btnPrimaryText: { color: "#fff", fontWeight: "600" },
  btnGhost: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 40, borderRadius: 10, borderWidth: 1, borderColor: "#D0D5DD", backgroundColor: "#fff" },
  btnGhostText: { color: "#344054", fontWeight: "600" },

  chipsRow: { flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  chipActive: { backgroundColor: "#082cac", borderColor: "#082cac" },
  chipIdle: { backgroundColor: "#fff", borderColor: "#D0D5DD" },
  chipText: { fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  chipTextIdle: { color: "#344054" },

  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: "#EAECF0", gap: 8 },
  cell: { minWidth: 90 },
  cellTitle: { fontSize: 14, fontWeight: "700", color: "#101828" },
  cellSub: { fontSize: 12, color: "#667085" },
  mono: { fontVariant: ["tabular-nums"], color: "#101828" },
  badge: { paddingVertical: 2 },
  actions: { flexDirection: "row", gap: 8 },
  iconBtn: { padding: 8, borderRadius: 8, backgroundColor: "#F2F4F7" },

  center: { padding: 24, alignItems: "center" },
  empty: { textAlign: "center", color: "#667085", padding: 24 },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 },
  modalCard: { backgroundColor: "#fff", padding: 16, borderRadius: 16, maxHeight: 560, width: "100%" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#101828", marginBottom: 6 },
  modalHint: { fontSize: 12, color: "#667085", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#D0D5DD", borderRadius: 10, paddingHorizontal: 12, height: 40, marginBottom: 8, backgroundColor: "#fff" },
  grid2: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rowEnd: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 },
});