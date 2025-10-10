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
  Dimensions,
  useWindowDimensions,
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
      const res = await api.get<Building[]>("/buildings");
      setBuildings(res.data || []);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { loadAll(); }, [token]);

  /** Derived list: shows immediately (no modal needed) */
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

  /** CRUD (unchanged) */
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

  /** UI (FlatList is the only vertical scroller) */
  return (
    <View style={styles.page}>
      <View style={styles.grid}>
        {/* Header card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Manage Buildings</Text>
            <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
              <Text style={styles.btnText}>+ Create Building</Text>
            </TouchableOpacity>
          </View>

          {/* Toolbar: Search + Filters beside each other */}
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
              <Ionicons name="options-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
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
              style={{ flex: 1 }}
              contentContainerStyle={filtered.length === 0 ? styles.emptyPad : { paddingBottom: 24 }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="business-outline" size={42} color="#cbd5e1" />
                  <Text style={styles.emptyTitle}>No buildings</Text>
                  <Text style={styles.emptyText}>Try adjusting your search or create a new one.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.row, isMobile && styles.rowMobile]}>
                  {/* Main details */}
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>
                      {item.building_name} <Text style={styles.rowSub}>({item.building_id})</Text>
                    </Text>
                    <Text style={styles.rowMeta}>
                      E: {fmt(item.erate_perKwH, "₱/kWh")} • Min: {fmt(item.emin_con, "kWh")}  |  W: {fmt(item.wrate_perCbM, "₱/m³")} • Min: {fmt(item.wmin_con, "m³")}  |  LPG: {fmt(item.lrate_perKg, "₱/kg")}
                    </Text>
                    {item.last_updated ? (
                      <Text style={styles.rowMetaSmall}>
                        Updated {new Date(item.last_updated).toLocaleString()} {item.updated_by ? `• by ${item.updated_by}` : ""}
                      </Text>
                    ) : null}
                  </View>

                  {/* Actions: right on desktop/tablet, below on mobile */}
                  {isMobile ? (
                    <View style={styles.rowActionsMobile}>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionEdit]} onPress={() => openEdit(item)}>
                        <Ionicons name="create-outline" size={16} color="#1f2937" />
                        <Text style={[styles.actionText, styles.actionEditText]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={() => onDelete(item)}>
                        <Ionicons name="trash-outline" size={16} color="#fff" />
                        <Text style={[styles.actionText, styles.actionDeleteText]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.rowActions}>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionEdit]} onPress={() => openEdit(item)}>
                        <Ionicons name="create-outline" size={16} color="#1f2937" />
                        <Text style={[styles.actionText, styles.actionEditText]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={() => onDelete(item)}>
                        <Ionicons name="trash-outline" size={16} color="#fff" />
                        <Text style={[styles.actionText, styles.actionDeleteText]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            />
          )}
        </View>

        {/* Filters Modal (sort only) */}
        <Modal visible={filtersVisible} transparent animationType="fade" onRequestClose={() => setFiltersVisible(false)}>
          <View style={styles.promptOverlay}>
            <View style={styles.promptCard}>
              <Text style={styles.modalTitle}>Filters & Sort</Text>
              <View style={styles.modalDivider} />
              <Text style={styles.dropdownLabel}>Sort by</Text>
              <View style={styles.chipsRow}>
                {[
                  { label: "Newest", val: "newest" as SortMode },
                  { label: "Oldest", val: "oldest" as SortMode },
                  { label: "Name", val: "name" as SortMode },
                  { label: "ID", val: "id" as SortMode },
                ].map(({ label, val }) => (
                  <Chip key={val} label={label} active={sortMode === val} onPress={() => setSortMode(val)} />
                ))}
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, { minWidth: 120 }]} onPress={() => setFiltersVisible(false)}>
                  <Text style={styles.btnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Create Modal */}
        <Modal visible={createVisible} animationType="fade" transparent onRequestClose={() => setCreateVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Create Building</Text>
              <View style={styles.modalDivider} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Name</Text>
                  <TextInput value={name} onChangeText={setName} placeholder="e.g. JDN Center" style={styles.input} placeholderTextColor="#9aa5b1" />
                </View>

                <Text style={styles.sectionTitle}>Base Rates</Text>
                <View style={styles.grid2}>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Electric Rate (₱/kWh)</Text>
                    <TextInput value={c_eRate} onChangeText={setC_eRate} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Electric Min (kWh)</Text>
                    <TextInput value={c_eMin} onChangeText={setC_eMin} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Water Rate (₱/m³)</Text>
                    <TextInput value={c_wRate} onChangeText={setC_wRate} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Water Min (m³)</Text>
                    <TextInput value={c_wMin} onChangeText={setC_wMin} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>LPG Rate (₱/kg)</Text>
                    <TextInput value={c_lRate} onChangeText={setC_lRate} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btnGhostAlt]} onPress={() => setCreateVisible(false)}>
                  <Text style={styles.btnGhostTextAlt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
                  <Text style={styles.btnText}>{submitting ? "Saving…" : "Create"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Edit Modal */}
        <Modal visible={editVisible} animationType="fade" transparent onRequestClose={() => setEditVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Edit Building</Text>
              <View style={styles.modalDivider} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Name</Text>
                  <TextInput value={editName} onChangeText={setEditName} placeholder="Building name" style={styles.input} placeholderTextColor="#9aa5b1" />
                </View>

                <Text style={styles.sectionTitle}>Base Rates</Text>
                <View style={styles.grid2}>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Electric Rate (₱/kWh)</Text>
                    <TextInput value={e_eRate} onChangeText={setE_eRate} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Electric Min (kWh)</Text>
                    <TextInput value={e_eMin} onChangeText={setE_eMin} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Water Rate (₱/m³)</Text>
                    <TextInput value={e_wRate} onChangeText={setE_wRate} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>Water Min (m³)</Text>
                    <TextInput value={e_wMin} onChangeText={setE_wMin} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>LPG Rate (₱/kg)</Text>
                    <TextInput value={e_lRate} onChangeText={setE_lRate} keyboardType="numeric" style={styles.input} placeholderTextColor="#9aa5b1" />
                  </View>
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btnGhostAlt]} onPress={() => setEditVisible(false)}>
                  <Text style={styles.btnGhostTextAlt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>
                  <Text style={styles.btnText}>{submitting ? "Saving…" : "Save"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </View>
  );
}

/** Styles — clean, light, mobile-friendly */
const W = Dimensions.get("window").width;
const styles = StyleSheet.create({
  // NEW: page + grid are flex so the list can occupy full height and scroll
  page: {
    flex: 1,
    minHeight: 0,
  },
  grid: {
    flex: 1,
    padding: 14,
    gap: 14,
    minHeight: 0,
  },

  card: {
    flex: 1,          // let FlatList have a scrollable container
    minHeight: 0,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    ...(Platform.select({
      web: { boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)" } as any,
      default: { elevation: 2 },
    }) as any),
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },
  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },

  filtersBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  search: {
    flex: 1,
    height: 40,
    color: "#0f172a",
  },
  btnGhost: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  btnGhostText: { color: "#394e6a", fontWeight: "700" },

  loader: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },

  row: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",      // center vertically on wide screens
  },
  rowMobile: {
    flexDirection: "column",   // stack on mobile
    alignItems: "stretch",
  },
  rowMain: {
    flex: 1,
    paddingRight: 10,
  },
  // Desktop/tablet: actions on the right, centered vertically
  rowActions: {
    width: 200,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  // Mobile: actions below details
  rowActionsMobile: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    justifyContent: "flex-start",
    alignItems: "center",
  },

  rowTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontWeight: "600" },
  rowMeta: { color: "#334155", marginTop: 6 },
  rowMetaSmall: { color: "#94a3b8", marginTop: 2, fontSize: 12 },

  // labeled action buttons
  actionBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionEdit: { backgroundColor: "#e2e8f0" },
  actionDelete: { backgroundColor: "#ef4444" },
  actionText: { fontWeight: "700" },
  actionEditText: { color: "#1f2937" },
  actionDeleteText: { color: "#fff" },

  emptyPad: { paddingVertical: 30 },
  empty: { alignItems: "center", gap: 6 },
  emptyTitle: { fontWeight: "800", color: "#0f172a" },
  emptyText: { color: "#94a3b8" },

  // Modal shell
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.36)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 720,
    padding: 14,
    ...(Platform.select({
      web: { boxShadow: "0 14px 44px rgba(15, 23, 42, 0.16)" } as any,
      default: { elevation: 3 },
    }) as any),
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  modalDivider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 10 },
  modalActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  btnGhostAlt: {
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  btnGhostTextAlt: { color: "#334155", fontWeight: "700" },

  inputRow: { marginBottom: 10 },
  inputLabel: { color: "#334155", fontWeight: "700", marginBottom: 6 },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    height: 40,
    paddingHorizontal: 10,
    color: "#0f172a",
  },
  sectionTitle: { marginTop: 10, marginBottom: 6, fontWeight: "800", color: "#0f172a" },

  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  // Filter modal (chips)
  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.36)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  promptCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 560,
    padding: 14,
    ...(Platform.select({
      web: { boxShadow: "0 14px 44px rgba(15, 23, 42, 0.16)" } as any,
      default: { elevation: 3 },
    }) as any),
  },
  dropdownLabel: { fontWeight: "800", color: "#0f172a", marginBottom: 8 },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: "#e0ecff", borderColor: "#93c5fd" },
  chipIdle: {},
  chipText: { fontWeight: "700" },
  chipTextActive: { color: "#1d4ed8" },
  chipTextIdle: { color: "#334155" },
});