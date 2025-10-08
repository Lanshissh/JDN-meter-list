
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
  Dimensions,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

/** Types */
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
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number | null | undefined, unit?: string) => {
  if (n == null || !isFinite(Number(n))) return "—";
  const out = Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));
  return unit ? `${out} ${unit}` : out;
};

const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

/** Component */
export default function BuildingPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // search + sort
  const [query, setQuery] = useState("");
  type SortMode = "newest" | "oldest" | "name" | "id";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // FILTERS MODAL
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
      const res = await api.get<Building[]>("/buildings");
      setBuildings(res.data || []);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { loadAll(); }, [token]);

  /** Derived list with search + sort */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = buildings;
    if (q) {
      list = list.filter((b) =>
        [b.building_id, b.building_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
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

  /** Actions */
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
      const ok = window.confirm(`Delete ${b.building_name}?`);
      if (!ok) return;
    } else {
      // simple native confirm
    }
    try {
      setSubmitting(true);
      await api.delete(`/buildings/${encodeURIComponent(b.building_id)}`);
      await loadAll();
      notify("Deleted", "Building removed.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  /** UI */
  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.grid}>
      {/* LIST CARD */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Manage Buildings</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
            <Text style={styles.btnText}>+ Create Building</Text>
          </TouchableOpacity>
        </View>

        {/* Search bar + Filter button (filters moved into modal) */}
        <View style={styles.filtersBar}>
          <View style={[styles.searchWrap, { flex: 1 }]}>
            <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search building by name or ID…"
              placeholderTextColor="#9aa5b1"
              style={styles.search}
            />
          </View>

          <TouchableOpacity style={styles.btnGhost} onPress={() => setFiltersVisible(true)}>
            <Ionicons name="filter-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
            <Text style={styles.btnGhostText}>Filters</Text>
          </TouchableOpacity>
        </View>

        {/* List */}
        {busy ? (
          <View style={styles.loader}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(b) => b.building_id}
            style={{ flexGrow: 1, marginTop: 4 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            nestedScrollEnabled
            ListEmptyComponent={<Text style={styles.empty}>No buildings found.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.building_name} <Text style={styles.rowSub}>({item.building_id})</Text>
                  </Text>
                  <Text style={styles.rowMeta}>
                    Elec: {fmt(item.erate_perKwH, "rate/kWh")} • Min: {fmt(item.emin_con)}
                    {"  "}Water: {fmt(item.wrate_perCbM, "rate/cbm")} • Min: {fmt(item.wmin_con)}
                    {"  "}LPG: {fmt(item.lrate_perKg, "rate/kg")}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => openEdit(item)}>
                    <Text style={styles.actionBtnGhostText}>Update</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => onDelete(item)}>
                    <Text style={styles.actionBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* CREATE modal */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.85) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Create Building</Text>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Building Name</Text>
                <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. JDN Plaza" />
              </View>
              <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Rates</Text></View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.dropdownLabel}>Electric: rate/kWh</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={c_eRate} onChangeText={setC_eRate} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownLabel}>Electric: min. consumption</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={c_eMin} onChangeText={setC_eMin} />
                </View>
              </View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.dropdownLabel}>Water: rate/cbm</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={c_wRate} onChangeText={setC_wRate} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownLabel}>Water: min. consumption</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={c_wMin} onChangeText={setC_wMin} />
                </View>
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>LPG: rate/kg</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={c_lRate} onChangeText={setC_lRate} />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setCreateVisible(false)}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT modal */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.85) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Update Building</Text>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Building Name</Text>
                <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="e.g. JDN Plaza" />
              </View>
              <View style={styles.sectionHeader}><Text style={styles.sectionHeaderText}>Rates</Text></View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.dropdownLabel}>Electric: rate/kWh</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={e_eRate} onChangeText={setE_eRate} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownLabel}>Electric: min. consumption</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={e_eMin} onChangeText={setE_eMin} />
                </View>
              </View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.dropdownLabel}>Water: rate/cbm</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={e_wRate} onChangeText={setE_wRate} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dropdownLabel}>Water: min. consumption</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={e_wMin} onChangeText={setE_wMin} />
                </View>
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>LPG: rate/kg</Text>
                <TextInput style={styles.input} keyboardType="numeric" value={e_lRate} onChangeText={setE_lRate} />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save Changes</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FILTERS modal (Sort options moved here) */}
      <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.modalTitle}>Filters & Sort</Text>
            <View style={styles.modalDivider} />

            <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>Sort by</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "Name", val: "name" },
                { label: "ID", val: "id" },
              ].map(({ label, val }) => (
                <Chip key={val} label={label} active={sortMode === (val as SortMode)} onPress={() => setSortMode(val as SortMode)} />
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => { setSortMode("newest"); setFiltersVisible(false); }}
              >
                <Text style={styles.btnGhostText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => setFiltersVisible(false)}>
                <Text style={styles.btnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Styles (kept consistent with other admin panels) */
const styles = StyleSheet.create({
  grid: { flex: 1, gap: 12 },
  card: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16,42,67,0.05)" as any },
      default: { elevation: 2 },
    }) as any),
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },

  filtersBar: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  search: { flex: 1, color: "#102a43", paddingVertical: 6 },

  btn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },

  btnGhost: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  btnGhostText: { color: "#394e6a", fontWeight: "700" },
  btnDisabled: { opacity: 0.7 },

  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { color: "#64748b", textAlign: "center", paddingVertical: 16 },

  row: {
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowTitle: { fontSize: 14, fontWeight: "700", color: "#0b1f33" },
  rowSub: { color: "#64748b", fontSize: 12 },
  rowMeta: { color: "#475569", marginTop: 2, fontSize: 12 },
  rowActions: { flexDirection: "row", gap: 8 },

  actionBtn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionBtnText: { color: "#fff", fontWeight: "700" },
  actionBtnGhost: {
    backgroundColor: "#edf2ff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionBtnGhostText: { color: "#082cac", fontWeight: "700" },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(16,42,67,0.2)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  modalCard: {
    width: "100%",
    maxWidth: 740,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 10px 28px rgba(16,42,67,0.08)" as any },
      default: { elevation: 3 },
    }) as any),
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },
  modalActions: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  sectionHeader: { marginTop: 10, marginBottom: 2 },
  sectionHeaderText: { color: "#486581", fontWeight: "800" },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#102a43",
    marginTop: 6,
  },
  rowWrap: { flexDirection: "row", gap: 8, marginTop: 6 },
  dropdownLabel: { fontSize: 12, color: "#5d7285", marginTop: 6 },

  // Small prompt modal (for Filters)
  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(16,42,67,0.25)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  promptCard: {
    backgroundColor: "#fff",
    width: "100%",
    maxWidth: 520,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16,42,67,0.08)" as any },
      default: { elevation: 3 },
    }) as any),
  },
  modalDivider: {
    height: 1,
    backgroundColor: "#edf2f7",
    marginVertical: 8,
  },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
  },
  chipActive: { backgroundColor: "#082cac" },
  chipIdle: {},
  chipText: { fontWeight: "700", color: "#082cac" },
  chipTextActive: { color: "#fff" },
  chipTextIdle: { color: "#082cac" },
});