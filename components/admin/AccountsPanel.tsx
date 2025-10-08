
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
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

/** Types */
type Role = "admin" | "operator" | "biller";
type Util = "electric" | "water" | "lpg";
const UTIL_OPTIONS: Util[] = ["electric", "water", "lpg"];

type User = {
  user_id: string;
  user_fullname: string;
  user_level: Role;
  building_id: string | null;
  utility_role?: Util[] | null;
  last_updated?: string;
  updated_by?: string;
};

type Building = {
  building_id: string;
  building_name: string;
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

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
};

const parseUtils = (val: any): Util[] | null => {
  if (val == null) return null;
  if (Array.isArray(val)) return val as Util[];
  try {
    const arr = JSON.parse(String(val));
    return Array.isArray(arr) ? (arr as Util[]) : null;
  } catch { return null; }
};

/** Component */
export default function AccountsPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // search + filters
  const [query, setQuery] = useState("");
  type SortMode = "newest" | "oldest" | "name" | "role" | "id";
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  type RoleFilter = "" | Role;
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");

  // Modals
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);

  // Create form
  const [fullname, setFullname] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<Role>("operator");
  const [buildingId, setBuildingId] = useState<string>("");
  const [utilRoles, setUtilRoles] = useState<Util[]>([]);

  // Edit form
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editFullname, setEditFullname] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editLevel, setEditLevel] = useState<Role>("operator");
  const [editBuildingId, setEditBuildingId] = useState<string>("");
  const [editUtilRoles, setEditUtilRoles] = useState<Util[]>([]);

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  const loadAll = async () => {
    if (!token) { setBusy(false); notify("Not logged in", "Please log in as admin to manage accounts."); return; }
    try {
      setBusy(true);
      const [uRes, bRes] = await Promise.all([api.get<User[]>("/users"), api.get<Building[]>("/buildings")]);
      setUsers((uRes.data || []).map((u: any) => ({
        ...u,
        user_level: String(u.user_level).toLowerCase(),
        building_id: u.building_id == null ? null : String(u.building_id),
        utility_role: parseUtils(u.utility_role),
      })));
      setBuildings(bRes.data || []);
      if (!buildingId && bRes.data?.length) setBuildingId(bRes.data[0].building_id);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally { setBusy(false); }
  };

  useEffect(() => { loadAll(); }, [token]);

  /** Derived list with search + role + sort */
  const derived = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users;
    if (roleFilter) list = list.filter((u) => u.user_level === roleFilter);
    if (q) {
      list = list.filter((u) =>
        [u.user_id, u.user_fullname, u.user_level, u.building_id ?? "", (u.utility_role || []).join(",")]
          .map((s) => String(s).toLowerCase())
          .some((s) => s.includes(q))
      );
    }
    const arr = [...list];
    switch (sortMode) {
      case "name": arr.sort((a, b) => a.user_fullname.localeCompare(b.user_fullname)); break;
      case "role": arr.sort((a, b) => a.user_level.localeCompare(b.user_level) || a.user_fullname.localeCompare(b.user_fullname)); break;
      case "id": arr.sort((a, b) => a.user_id.localeCompare(b.user_id)); break;
      case "oldest": arr.sort((a, b) => (Date.parse(a.last_updated || "") || 0) - (Date.parse(b.last_updated || "") || 0)); break;
      case "newest":
      default: arr.sort((a, b) => (Date.parse(b.last_updated || "") || 0) - (Date.parse(a.last_updated || "") || 0)); break;
    }
    return arr;
  }, [users, query, roleFilter, sortMode]);

  /** Actions */
  const roleNeedsBuilding = (r: Role) => r !== "admin";
  const roleUsesUtilities = (r: Role) => r === "biller";

  const onCreate = async () => {
    if (!fullname || !password) { notify("Missing info", "Please enter full name and password."); return; }
    if (roleNeedsBuilding(level) && !buildingId) { notify("Missing building", "Select a building for non-admin users."); return; }
    try {
      setSubmitting(true);
      const payload: any = { user_fullname: fullname, user_password: password, user_level: level };
      if (roleNeedsBuilding(level)) payload.building_id = buildingId;
      if (roleUsesUtilities(level)) payload.utility_role = utilRoles;
      await api.post("/users", payload);
      setFullname(""); setPassword(""); setLevel("operator"); setUtilRoles([]); setCreateVisible(false);
      await loadAll();
      notify("Success", "User created.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditFullname(u.user_fullname);
    setEditPassword("");
    setEditLevel(u.user_level);
    setEditBuildingId(u.building_id ?? "");
    setEditUtilRoles(u.utility_role ?? []);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editUser) return;
    if (roleNeedsBuilding(editLevel) && !editBuildingId) { notify("Missing building", "Select a building for non-admin users."); return; }
    try {
      setSubmitting(true);
      const payload: any = { user_fullname: editFullname, user_level: editLevel };
      if (editPassword) payload.user_password = editPassword;
      payload.building_id = editLevel === "admin" ? (editBuildingId || null) : editBuildingId;
      payload.utility_role = roleUsesUtilities(editLevel) ? editUtilRoles : null;
      await api.put(`/users/${encodeURIComponent(editUser.user_id)}`, payload);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "User updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  const onDelete = async (u: User) => {
    const ok = await confirm("Delete user", `Delete ${u.user_fullname} (${u.user_id})?`);
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(`/users/${encodeURIComponent(u.user_id)}`);
      await loadAll();
      notify("Deleted", "User removed.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally { setSubmitting(false); }
  };

  /** Small UI bits copied to match BuildingPanel */
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
          <Text style={styles.cardTitle}>Manage Accounts</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
            <Text style={styles.btnText}>+ Create User</Text>
          </TouchableOpacity>
        </View>

        {/* Search bar + Filter button (filters moved into modal) */}
        <View style={styles.filtersBar}>
          <View style={[styles.searchWrap, { flex: 1 }]}>
            <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by ID, name, role, building…"
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
            data={derived}
            keyExtractor={(u) => u.user_id}
            style={{ flexGrow: 1, marginTop: 4 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            nestedScrollEnabled
            ListEmptyComponent={<Text style={styles.empty}>No users found.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.user_fullname} <Text style={styles.rowSub}>({item.user_id})</Text>
                  </Text>
                  <Text style={styles.rowMeta}>
                    {String(item.user_level).toUpperCase()}
                    {item.building_id ? ` • ${item.building_id}` : ""}
                    {item.utility_role && item.utility_role.length ? ` • utils: ${item.utility_role.join(", ").toUpperCase()}` : ""}
                    {item.last_updated ? ` • updated ${fmtDate(item.last_updated)}` : ""}
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
              <Text style={styles.modalTitle}>Create User</Text>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Full name</Text>
                <TextInput style={styles.input} value={fullname} onChangeText={setFullname} placeholder="e.g. Jane Dela Cruz" />
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Password</Text>
                <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry />
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Role</Text>
                <View style={styles.dropdownBox}>
                  <Picker selectedValue={level} onValueChange={(v) => setLevel(v)}>
                    <Picker.Item label="Operator" value="operator" />
                    <Picker.Item label="Biller" value="biller" />
                    <Picker.Item label="Admin" value="admin" />
                  </Picker>
                </View>
              </View>

              {level !== "admin" && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Building</Text>
                  <View style={styles.dropdownBox}>
                    <Picker selectedValue={buildingId} onValueChange={(v) => setBuildingId(v)}>
                      <Picker.Item label="Select building…" value="" />
                      {buildings.map((b) => (
                        <Picker.Item key={b.building_id} label={`${b.building_name} (${b.building_id})`} value={b.building_id} />
                      ))}
                    </Picker>
                  </View>
                </View>
              )}

              {level === "biller" && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Utilities</Text>
                  <View style={styles.chipsRow}>
                    {UTIL_OPTIONS.map((u) => {
                      const selected = utilRoles.includes(u);
                      return (
                        <TouchableOpacity key={u} onPress={() => setUtilRoles((old) => selected ? old.filter(x => x !== u) : [...old, u])} style={[styles.chip, selected ? styles.chipActive : styles.chipIdle]}>
                          <Text style={[styles.chipText, selected ? styles.chipTextActive : styles.chipTextIdle]}>{u.toUpperCase()}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

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
              <Text style={styles.modalTitle}>Update User</Text>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Full name</Text>
                <TextInput style={styles.input} value={editFullname} onChangeText={setEditFullname} placeholder="e.g. Juan Dela Cruz" />
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>New password (optional)</Text>
                <TextInput style={styles.input} value={editPassword} onChangeText={setEditPassword} placeholder="leave blank to keep" secureTextEntry />
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Role</Text>
                <View style={styles.dropdownBox}>
                  <Picker selectedValue={editLevel} onValueChange={(v) => setEditLevel(v)}>
                    <Picker.Item label="Operator" value="operator" />
                    <Picker.Item label="Biller" value="biller" />
                    <Picker.Item label="Admin" value="admin" />
                  </Picker>
                </View>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Building</Text>
                <View style={styles.dropdownBox}>
                  <Picker selectedValue={editBuildingId} enabled={editLevel !== "admin"} onValueChange={(v) => setEditBuildingId(v)}>
                    <Picker.Item label="Select building…" value="" />
                    {buildings.map((b) => (
                      <Picker.Item key={b.building_id} label={`${b.building_name} (${b.building_id})`} value={b.building_id} />
                    ))}
                  </Picker>
                </View>
              </View>

              {editLevel === "biller" && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Utilities</Text>
                  <View style={styles.chipsRow}>
                    {UTIL_OPTIONS.map((u) => {
                      const selected = editUtilRoles.includes(u);
                      return (
                        <TouchableOpacity key={u} onPress={() => setEditUtilRoles((old) => selected ? old.filter(x => x !== u) : [...old, u])} style={[styles.chip, selected ? styles.chipActive : styles.chipIdle]}>
                          <Text style={[styles.chipText, selected ? styles.chipTextActive : styles.chipTextIdle]}>{u.toUpperCase()}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

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

      {/* FILTERS modal (Role + Sort) */}
      <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.modalTitle}>Filters & Sort</Text>
            <View style={styles.modalDivider} />

            <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>Role</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "All", val: "" },
                { label: "Admin", val: "admin" },
                { label: "Operator", val: "operator" },
                { label: "Biller", val: "biller" },
              ].map(({ label, val }) => (
                <Chip key={label} label={label} active={roleFilter === (val as RoleFilter)} onPress={() => setRoleFilter(val as RoleFilter)} />
              ))}
            </View>

            <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Sort by</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "Name", val: "name" },
                { label: "Role", val: "role" },
                { label: "ID", val: "id" },
              ].map(({ label, val }) => (
                <Chip key={val} label={label} active={sortMode === (val as SortMode)} onPress={() => setSortMode(val as SortMode)} />
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => { setQuery(""); setRoleFilter(""); setSortMode("newest"); setFiltersVisible(false); }}
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

/** Styles cloned from BuildingPanel to match UI */
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
  dropdownLabel: { fontSize: 12, color: "#5d7285", marginTop: 6 },
  dropdownBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 6,
    height: 40,
    justifyContent: "center",
    marginTop: 6,
  },

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