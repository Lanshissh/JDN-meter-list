// components/admin/StallsPanel.tsx
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
  Dimensions,
} from "react-native";
import axios from "axios";
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

/** Types */
type Stall = {
  stall_id: string;
  stall_sn: string;
  tenant_id: string | null;
  building_id: string;
  stall_status: "occupied" | "available" | "under maintenance";
  last_updated?: string;
  updated_by?: string;
};

type Building = {
  building_id: string;
  building_name: string;
};

type Tenant = {
  tenant_id: string;
  tenant_name: string;
  building_id: string;
};

/** Helpers (match BuildingPanel style + behavior) */
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
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
const dateOf = (s?: string) => (s ? Date.parse(s) || 0 : 0);

/** Chip */
const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
  </TouchableOpacity>
);

export default function StallsPanel({ token }: { token: string | null }) {
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [stalls, setStalls] = useState<Stall[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  // search + filters + sort
  const [query, setQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"" | Stall["stall_status"]>("");
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Mobile “Select Building” picker modal
  const [buildingPickerVisible, setBuildingPickerVisible] = useState(false);

  // create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [c_stallSn, setC_stallSn] = useState("");
  const [c_buildingId, setC_buildingId] = useState("");
  const [c_status] = useState<Stall["stall_status"]>("available");
  const [c_tenantId, setC_tenantId] = useState("");

  // edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editStall, setEditStall] = useState<Stall | null>(null);

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  const loadAll = async () => {
    if (!token) { setBusy(false); notify("Not logged in", "Please log in to manage stalls."); return; }
    try {
      setBusy(true);
      const [stRes, bRes, tRes] = await Promise.all([
        api.get<Stall[]>("/stalls"),
        api.get<Building[]>("/buildings"),
        api.get<Tenant[]>("/tenants"),
      ]);
      setStalls(stRes.data || []);
      setBuildings(bRes.data || []);
      setTenants(tRes.data || []);
      if (!c_buildingId && (bRes.data?.length ?? 0) > 0) setC_buildingId(bRes.data[0].building_id);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally { setBusy(false); }
  };
  useEffect(() => { loadAll(); }, [token]);

  /** Derived list */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = stalls;
    if (buildingFilter) list = list.filter((s) => s.building_id === buildingFilter);
    if (statusFilter) list = list.filter((s) => s.stall_status === statusFilter);
    if (q) {
      list = list.filter((s) =>
        [s.stall_id, s.stall_sn, s.building_id, s.tenant_id, s.stall_status]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [stalls, query, buildingFilter, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "oldest": arr.sort((a, b) => dateOf(a.last_updated) - dateOf(b.last_updated)); break;
      case "idAsc": arr.sort((a, b) => cmp(a.stall_id, b.stall_id)); break;
      case "idDesc": arr.sort((a, b) => cmp(b.stall_id, a.stall_id)); break;
      case "newest":
      default: arr.sort((a, b) => dateOf(b.last_updated) - dateOf(a.last_updated)); break;
    }
    return arr;
  }, [filtered, sortMode]);

  /** CRUD (unchanged) */
  const onCreate = async () => {
    const stall_sn = c_stallSn.trim();
    if (!stall_sn || !c_buildingId) { notify("Missing info", "Please enter Stall SN and select a Building."); return; }
    try {
      setSubmitting(true);
      await api.post("/stalls", {
        stall_sn,
        building_id: c_buildingId,
        stall_status: c_status,
        tenant_id: null,
      });
      setCreateVisible(false);
      setC_stallSn("");
      setC_tenantId("");
      await loadAll();
      notify("Success", "Stall created.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const openEdit = (s: Stall) => {
    setEditStall({ ...s });
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editStall) return;
    try {
      setSubmitting(true);
      await api.put(`/stalls/${encodeURIComponent(editStall.stall_id)}`, {
        stall_sn: editStall.stall_sn,
        building_id: editStall.building_id,
        stall_status: editStall.stall_status,
        tenant_id: editStall.stall_status === "available" ? null : editStall.tenant_id || null,
      });
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Stall updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const onDelete = async (s: Stall) => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const ok = window.confirm(`Delete ${s.stall_sn} (${s.stall_id})?`);
      if (!ok) return;
    }
    try {
      setSubmitting(true);
      await api.delete(`/stalls/${encodeURIComponent(s.stall_id)}`);
      await loadAll();
      notify("Deleted", "Stall deleted.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  /** UI — FlatList is the ONLY vertical scroller (no nested ScrollView around it) */
  return (
    <View style={styles.page}>
      <View style={styles.grid}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Manage Stalls</Text>
            <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
              <Text style={styles.btnText}>+ Create Stall</Text>
            </TouchableOpacity>
          </View>

          {/* Toolbar: Search + Filters beside each other (wraps on small widths) */}
          <View style={styles.filtersBar}>
            <View style={[styles.searchWrap, { flex: 1 }]}>
              <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by ID, SN, tenant, building, status…"
                placeholderTextColor="#9aa5b1"
                style={styles.search}
              />
            </View>

            <TouchableOpacity style={styles.btnGhost} onPress={() => setFiltersVisible(true)}>
              <Ionicons name="options-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
              <Text style={styles.btnGhostText}>Filters</Text>
            </TouchableOpacity>
          </View>

          {/* Building filter — mobile friendly (horizontal ScrollView is OK; different orientation) */}
          <View style={{ marginTop: 6, marginBottom: 15 }}>
            <View style={styles.buildingHeaderRow}>
              <Text style={styles.dropdownLabel}>Building</Text>
            </View>

            {isMobile ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRowHorizontal}
              >
                <Chip label="All" active={buildingFilter === ""} onPress={() => setBuildingFilter("")} />
                {buildings.map((b) => (
                  <Chip
                    key={b.building_id}
                    label={b.building_name || b.building_id}
                    active={buildingFilter === b.building_id}
                    onPress={() => setBuildingFilter(b.building_id)}
                  />
                ))}
              </ScrollView>
            ) : (
              <View style={styles.chipsRow}>
                <Chip label="All" active={buildingFilter === ""} onPress={() => setBuildingFilter("")} />
                {buildings.map((b) => (
                  <Chip
                    key={b.building_id}
                    label={b.building_name || b.building_id}
                    active={buildingFilter === b.building_id}
                    onPress={() => setBuildingFilter(b.building_id)}
                  />
                ))}
              </View>
            )}
          </View>

          {/* List (fills remaining height; the page scrolls via this FlatList) */}
          {busy ? (
            <View style={styles.loader}><ActivityIndicator /></View>
          ) : (
            <FlatList
              data={sorted}
              keyExtractor={(s) => s.stall_id}
              style={{ flex: 1 }}
              contentContainerStyle={sorted.length === 0 ? styles.emptyPad : { paddingBottom: 24 }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="albums-outline" size={42} color="#cbd5e1" />
                  <Text style={styles.emptyTitle}>No stalls</Text>
                  <Text style={styles.emptyText}>Try adjusting your search or create a new one.</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={[styles.row, isMobile && styles.rowMobile]}>
                  {/* Main details */}
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>
                      {item.stall_sn} <Text style={styles.rowSub}>({item.stall_id})</Text>
                    </Text>
                    <Text style={styles.rowMeta}>
                      Building: {item.building_id} • Status: {item.stall_status}
                      {item.tenant_id ? ` • Tenant: ${item.tenant_id}` : ""}
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

        {/* Filters Modal (Status + Sort only; building chips live below search) */}
        <Modal visible={filtersVisible} transparent animationType="fade" onRequestClose={() => setFiltersVisible(false)}>
          <View style={styles.promptOverlay}>
            <View style={styles.promptCard}>
              <Text style={styles.modalTitle}>Filters & Sort</Text>
              <View style={styles.modalDivider} />

              <Text style={styles.dropdownLabel}>Status</Text>
              <View style={styles.chipsRow}>
                {[
                  { label: "All", value: "" },
                  { label: "Available", value: "available" },
                  { label: "Occupied", value: "occupied" },
                  { label: "Under Maintenance", value: "under maintenance" },
                ].map((opt) => (
                  <Chip
                    key={opt.value || "all"}
                    label={opt.label}
                    active={statusFilter === (opt.value as any)}
                    onPress={() => setStatusFilter(opt.value as any)}
                  />
                ))}
              </View>

              <Text style={[styles.dropdownLabel, { marginTop: 10 }]}>Sort by</Text>
              <View style={styles.chipsRow}>
                <Chip label="Newest" active={sortMode === "newest"} onPress={() => setSortMode("newest")} />
                <Chip label="Oldest" active={sortMode === "oldest"} onPress={() => setSortMode("oldest")} />
                <Chip label="ID ↑" active={sortMode === "idAsc"} onPress={() => setSortMode("idAsc")} />
                <Chip label="ID ↓" active={sortMode === "idDesc"} onPress={() => setSortMode("idDesc")} />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn]} onPress={() => setFiltersVisible(false)}>
                  <Text style={styles.btnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Mobile Building Picker (for long lists) */}
        <Modal
          visible={buildingPickerVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setBuildingPickerVisible(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Select Building</Text>
              <View style={styles.modalDivider} />
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={buildingFilter}
                  onValueChange={(v) => setBuildingFilter(String(v))}
                  style={styles.picker}
                >
                  <Picker.Item label="All" value="" />
                  {buildings.map((b) => (
                    <Picker.Item key={b.building_id} label={b.building_name || b.building_id} value={b.building_id} />
                  ))}
                </Picker>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btnGhostAlt]} onPress={() => setBuildingPickerVisible(false)}>
                  <Text style={styles.btnGhostTextAlt}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={() => setBuildingPickerVisible(false)}>
                  <Text style={styles.btnText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Create Modal */}
        <Modal visible={createVisible} animationType="fade" transparent onRequestClose={() => setCreateVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Create Stall</Text>
              <View style={styles.modalDivider} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Building</Text>
                  <View style={styles.pickerWrapper}>
                    <Picker selectedValue={c_buildingId} onValueChange={(v) => setC_buildingId(String(v))} style={styles.picker}>
                      {buildings.map((b) => (
                        <Picker.Item key={b.building_id} label={b.building_name || b.building_id} value={b.building_id} />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={styles.inputRow}>
                  <Text style={styles.inputLabel}>Stall SN</Text>
                  <TextInput
                    value={c_stallSn}
                    onChangeText={setC_stallSn}
                    placeholder="e.g. STALL-A12"
                    placeholderTextColor="#9aa5b1"
                    style={styles.input}
                  />
                </View>

                <Text style={styles.sectionTitle}>Status</Text>
                <View style={styles.chipsRow}>
                  <View style={[styles.chip, styles.chipActive]}>
                    <Text style={[styles.chipText, styles.chipTextActive]}>AVAILABLE</Text>
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
              <Text style={styles.modalTitle}>Edit Stall</Text>
              <View style={styles.modalDivider} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
                {editStall && (
                  <>
                    <View style={styles.inputRow}>
                      <Text style={styles.inputLabel}>Building</Text>
                      <View style={styles.pickerWrapper}>
                        <Picker
                          selectedValue={editStall.building_id}
                          onValueChange={(v) => setEditStall((s) => (s ? { ...s, building_id: String(v) } : s))}
                          style={styles.picker}
                        >
                          {buildings.map((b) => (
                            <Picker.Item key={b.building_id} label={b.building_name || b.building_id} value={b.building_id} />
                          ))}
                        </Picker>
                      </View>
                    </View>

                    <View style={styles.inputRow}>
                      <Text style={styles.inputLabel}>Stall SN</Text>
                      <TextInput
                        value={editStall.stall_sn}
                        onChangeText={(v) => setEditStall((s) => (s ? { ...s, stall_sn: v } : s))}
                        placeholder="e.g. STALL-A12"
                        placeholderTextColor="#9aa5b1"
                        style={styles.input}
                      />
                    </View>

                    <View style={styles.inputRow}>
                      <Text style={styles.inputLabel}>Status</Text>
                      <View style={styles.pickerWrapper}>
                        <Picker
                          selectedValue={editStall.stall_status}
                          onValueChange={(v) => setEditStall((s) => (s ? { ...s, stall_status: String(v) as any } : s))}
                          style={styles.picker}
                        >
                          <Picker.Item label="Available" value="available" />
                          <Picker.Item label="Occupied" value="occupied" />
                          <Picker.Item label="Under Maintenance" value="under maintenance" />
                        </Picker>
                      </View>
                    </View>

                    {editStall.stall_status !== "available" && (
                      <View style={styles.inputRow}>
                        <Text style={styles.inputLabel}>Tenant</Text>
                        <View style={styles.pickerWrapper}>
                          <Picker
                            selectedValue={editStall.tenant_id || ""}
                            onValueChange={(v) => setEditStall((s) => (s ? { ...s, tenant_id: String(v) } : s))}
                            style={styles.picker}
                          >
                            <Picker.Item label="-- select tenant --" value="" />
                            {tenants
                              .filter((t) => t.building_id === editStall.building_id)
                              .map((t) => (
                                <Picker.Item key={t.tenant_id} label={`${t.tenant_name} (${t.tenant_id})`} value={t.tenant_id} />
                              ))}
                          </Picker>
                        </View>
                      </View>
                    )}
                  </>
                )}
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

/** Styles — unified with BuildingPanel and optimized for mobile filter UX */
const W = Dimensions.get("window").width;
const styles = StyleSheet.create({
  // NEW: make the page + grid + card flex containers so FlatList can occupy and scroll
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
    flex: 1,
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

  // Toolbar
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

  // Row (responsive like BuildingPanel)
  row: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
  },
  rowMobile: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  rowMain: {
    flex: 1,
    paddingRight: 10,
  },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontWeight: "600" },
  rowMeta: { color: "#334155", marginTop: 6 },
  rowMetaSmall: { color: "#94a3b8", marginTop: 2, fontSize: 12 },

  // Actions
  rowActions: {
    width: 200,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  rowActionsMobile: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    justifyContent: "flex-start",
    alignItems: "center",
  },
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

  // Empty state
  emptyPad: { paddingVertical: 30 },
  empty: { alignItems: "center", gap: 6 },
  emptyTitle: { fontWeight: "800", color: "#0f172a" },
  emptyText: { color: "#94a3b8" },

  // Building filter header row (label + mobile "Select" button)
  buildingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  quickSelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e0ecff",
    borderColor: "#93c5fd",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  quickSelectText: { color: "#1d4ed8", fontWeight: "800", letterSpacing: 0.3, fontSize: 12 },

  // Chips (desktop/tablet wrap)
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  // Chips (mobile horizontal scroll)
  chipsRowHorizontal: {
    paddingRight: 4,
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

  // Modals
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

  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
  },
  picker: { height: 40 },

  // Filter modal shell
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
  dropdownLabel: { fontWeight: "800", color: "#0f172a", marginBottom: 8, textTransform: "none" },
});