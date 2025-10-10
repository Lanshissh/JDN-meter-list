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

const { width } = Dimensions.get("window");

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

const notify = (title: string, message: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

const confirm = (title: string, message: string): Promise<boolean> => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return Promise.resolve(!!window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
};

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
  } catch {
    return null;
  }
};

/** Component */
export default function AccountsPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  // Building filter (shown below search)
  const [filterBuilding, setFilterBuilding] = useState<string>("");

  // NEW: “Other filters” modal state
  const [otherFiltersVisible, setOtherFiltersVisible] = useState(false);
  const [filterRole, setFilterRole] = useState<Role | "">(""); // empty = any
  const [filterUtils, setFilterUtils] = useState<Util[]>([]);   // multi-select

  // Create form
  const [createVisible, setCreateVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  const [editVisible, setEditVisible] = useState(false);

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token]
  );
  const api = useMemo(
    () => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }),
    [authHeader]
  );

  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in as admin to manage accounts.");
      return;
    }
    try {
      setBusy(true);
      const [uRes, bRes] = await Promise.all([
        api.get<User[]>("/users"),
        api.get<Building[]>("/buildings"),
      ]);

      setUsers(
        (uRes.data || []).map((u: any) => ({
          ...u,
          user_level: String(u.user_level).toLowerCase(),
          building_id: u.building_id == null ? null : String(u.building_id),
          utility_role: parseUtils(u.utility_role),
        }))
      );

      setBuildings(bRes.data || []);
      if (!buildingId && bRes.data?.length) setBuildingId(bRes.data[0].building_id);
    } catch (err: any) {
      console.error(err?.message || err);
      notify(
        "Load failed",
        err?.response?.data?.error || err?.message || "Unable to load accounts."
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Helpers
  const roleNeedsBuilding = (r: Role) => r !== "admin";
  const roleUsesUtilities = (r: Role) => r !== "admin";
  const toggleUtilLocal = (u: Util, list: Util[], setter: (v: Util[]) => void) =>
    list.includes(u) ? setter(list.filter((x) => x !== u)) : setter([...list, u]);

  // Apply text + building + other-filters
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      // text
      const s = `${u.user_id} ${u.user_fullname} ${u.user_level} ${u.building_id ?? ""}`.toLowerCase();
      const textOk = q ? s.includes(q) : true;

      // building
      const bldgOk = filterBuilding ? u.building_id === filterBuilding : true;

      // role (optional)
      const roleOk = filterRole ? u.user_level === filterRole : true;

      // utilities (if any selected, require overlap)
      const utilsOk =
        filterUtils.length === 0
          ? true
          : (u.utility_role || []).some((x) => filterUtils.includes(x as Util));

      return textOk && bldgOk && roleOk && utilsOk;
    });
  }, [users, query, filterBuilding, filterRole, filterUtils]);

  const resetCreate = () => {
    setFullname("");
    setPassword("");
    setLevel("operator");
    setBuildingId(buildings[0]?.building_id ?? "");
    setUtilRoles([]);
  };

  const onCreate = async () => {
    if (!fullname || !password || !level) {
      notify("Missing fields", "Full name, password, and role are required.");
      return;
    }
    if (roleNeedsBuilding(level) && !buildingId) {
      notify("Missing building", "Select a building for non-admin users.");
      return;
    }
    try {
      setSubmitting(true);
      const payload: any = {
        user_fullname: fullname,
        user_password: password,
        user_level: level,
      };
      payload.building_id = level === "admin" ? null : buildingId || null;
      payload.utility_role = roleUsesUtilities(level) ? utilRoles : null;
      await api.post("/users", payload);
      setCreateVisible(false);
      resetCreate();
      await loadAll();
      notify("Success", "Account created.");
    } catch (e: any) {
      notify("Create failed", e?.response?.data?.error || e?.message || "Unable to create.");
    } finally {
      setSubmitting(false);
    }
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
    if (roleNeedsBuilding(editLevel) && !editBuildingId) {
      notify("Missing building", "Select a building for non-admin users.");
      return;
    }
    try {
      setSubmitting(true);
      const payload: any = { user_fullname: editFullname, user_level: editLevel };
      if (editPassword) payload.user_password = editPassword;
      payload.building_id = editLevel === "admin" ? (editBuildingId || null) : editBuildingId;
      payload.utility_role = roleUsesUtilities(editLevel) ? editUtilRoles : null;

      await api.put(`/users/${encodeURIComponent(editUser.user_id)}`, payload);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Account updated.");
    } catch (e: any) {
      notify("Update failed", e?.response?.data?.error || e?.message || "Unable to update.");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (u: User) => {
    const ok = await confirm("Delete account", `Are you sure you want to delete ${u.user_fullname}?`);
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(`/users/${encodeURIComponent(u.user_id)}`);
      await loadAll();
      notify("Deleted", "Account removed.");
    } catch (e: any) {
      notify("Delete failed", e?.response?.data?.error || e?.message || "Unable to delete.");
    } finally {
      setSubmitting(false);
    }
  };

  // UI helpers (chips & dropdown)
  const RoleChip = ({ value, selected, onPress }: { value: Role; selected: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, selected && styles.chipActive]}>
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
        {value === "admin" ? "Admin" : value === "operator" ? "Operator" : "Biller"}
      </Text>
    </TouchableOpacity>
  );

  const UtilChip = ({ value, selected, onPress }: { value: Util; selected: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, selected && styles.chipActive]}>
      <Text style={[styles.chipText, selected && styles.chipTextActive]}>
        {value === "electric" ? "Electric" : value === "water" ? "Water" : "LPG"}
      </Text>
    </TouchableOpacity>
  );

  const BuildingDropdown = ({
    value,
    onChange,
    small,
  }: {
    value: string;
    onChange: (v: string) => void;
    small?: boolean;
  }) => (
    <View style={[styles.selectWrap, small && { height: 36 }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: "center" }}>
        <TouchableOpacity
          style={[styles.selectItem, value === "" && styles.selectItemActive]}
          onPress={() => onChange("")}
        >
          <Ionicons name="business-outline" size={14} color={value === "" ? "#082cac" : "#475569"} />
          <Text style={[styles.selectItemText, value === "" && styles.selectItemTextActive]}>All</Text>
        </TouchableOpacity>
        {buildings.map((b) => {
          const active = value === b.building_id;
          return (
            <TouchableOpacity
              key={b.building_id}
              style={[styles.selectItem, active && styles.selectItemActive]}
              onPress={() => onChange(b.building_id)}
            >
              <Ionicons name="business-outline" size={14} color={active ? "#082cac" : "#475569"} />
              <Text style={[styles.selectItemText, active && styles.selectItemTextActive]}>
                {b.building_name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  // Row renderer
  const renderItem = ({ item }: { item: User }) => {
    const b = buildings.find((bb) => bb.building_id === item.building_id);
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.user_fullname}</Text>
            <Text style={styles.cardSub}>
              {item.user_id} • <Text style={{ textTransform: "capitalize" }}>{item.user_level}</Text>
              {item.utility_role?.length ? ` • ${item.utility_role.join(", ")}` : ""}
              {item.building_id ? ` • ${b?.building_name || item.building_id}` : ""}
            </Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => openEdit(item)}>
              <Ionicons name="create-outline" size={16} color="#082cac" />
              <Text style={[styles.btnText, { color: "#082cac" }]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => onDelete(item)}>
              <Ionicons name="trash-outline" size={16} color="#fff" />
              <Text style={[styles.btnText, { color: "#fff" }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <Ionicons name="time-outline" size={14} color="#475569" />
            <Text style={styles.metaText}>Updated: {fmtDate(item.last_updated)}</Text>
          </View>
          {!!item.updated_by && (
            <View style={styles.metaPill}>
              <Ionicons name="person-outline" size={14} color="#475569" />
              <Text style={styles.metaText}>By {item.updated_by}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  // Empty state
  const Empty = () => (
    <View style={styles.emptyWrap}>
      <Ionicons name="people-circle-outline" size={40} color="#a3b0bf" />
      <Text style={styles.emptyTitle}>No accounts found</Text>
      <Text style={styles.emptySub}>Try adjusting your search or create a new account.</Text>
      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setCreateVisible(true)}>
        <Ionicons name="person-add-outline" size={16} color="#fff" />
        <Text style={[styles.btnText, { color: "#fff" }]}>New Account</Text>
      </TouchableOpacity>
    </View>
  );

  // Other Filters modal content
  const OtherFiltersModal = () => (
    <Modal
      visible={otherFiltersVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setOtherFiltersVisible(false)}
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setOtherFiltersVisible(false)}
        />
        <View style={styles.modalCard}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>Other filters</Text>
            <TouchableOpacity onPress={() => setOtherFiltersVisible(false)}>
              <Ionicons name="close" size={22} color="#334155" />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
            {/* Role filter */}
            <Text style={styles.fieldLabel}>Role</Text>
            <View style={styles.chipsRow}>
              <TouchableOpacity
                onPress={() => setFilterRole("")}
                style={[styles.chip, filterRole === "" && styles.chipActive]}
              >
                <Text style={[styles.chipText, filterRole === "" && styles.chipTextActive]}>Any</Text>
              </TouchableOpacity>
              {(["operator", "biller", "admin"] as Role[]).map((r) => (
                <RoleChip key={r} value={r} selected={filterRole === r} onPress={() => setFilterRole(r)} />
              ))}
            </View>

            {/* Utility filter */}
            <Text style={styles.fieldLabel}>Utilities</Text>
            <View style={styles.chipsRow}>
              {UTIL_OPTIONS.map((u) => (
                <UtilChip
                  key={u}
                  value={u}
                  selected={filterUtils.includes(u)}
                  onPress={() => toggleUtilLocal(u, filterUtils, setFilterUtils)}
                />
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => {
                setFilterRole("");
                setFilterUtils([]);
              }}
            >
              <Text style={[styles.btnText, { color: "#082cac" }]}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => setOtherFiltersVisible(false)}
            >
              <Text style={[styles.btnText, { color: "#fff" }]}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Header card */}
      <View style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.h1}>Accounts</Text>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setCreateVisible(true)}>
            <Ionicons name="person-add-outline" size={16} color="#fff" />
            <Text style={[styles.btnText, { color: "#fff" }]}>New</Text>
          </TouchableOpacity>
        </View>

        {/* Search + Other Filters button (side by side) */}
        <View style={styles.searchRow}>
          <View style={[styles.searchWrap, { flex: 1 }]}>
            <Ionicons name="search-outline" size={16} color="#64748b" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name, ID, role, or building…"
              placeholderTextColor="#94a3b8"
              style={styles.search}
            />
          </View>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost, styles.otherBtn]}
            onPress={() => setOtherFiltersVisible(true)}
          >
            <Ionicons name="options-outline" size={16} color="#082cac" />
            <Text style={[styles.btnText, { color: "#082cac" }]}>Other filters</Text>
          </TouchableOpacity>
        </View>

        {/* Building filter BELOW search */}
        <Text style={styles.filterLabel}>Filter by building</Text>
        <BuildingDropdown value={filterBuilding} onChange={setFilterBuilding} />
      </View>

      {/* List */}
      {busy ? (
        <View style={{ padding: 20, alignItems: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.user_id}
          contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
          renderItem={renderItem}
          ListEmptyComponent={<Empty />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}

      {/* Create Modal */}
      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => !submitting && setCreateVisible(false)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Create Account</Text>
              <TouchableOpacity onPress={() => !submitting && setCreateVisible(false)}>
                <Ionicons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={styles.fieldLabel}>Full name</Text>
              <TextInput
                value={fullname}
                onChangeText={setFullname}
                placeholder="Enter full name"
                placeholderTextColor="#94a3b8"
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Enter password"
                placeholderTextColor="#94a3b8"
                style={styles.input}
                secureTextEntry
              />

              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.chipsRow}>
                {(["operator", "biller", "admin"] as Role[]).map((r) => (
                  <RoleChip key={r} value={r} selected={r === level} onPress={() => setLevel(r)} />
                ))}
              </View>

              {roleNeedsBuilding(level) && (
                <>
                  <Text style={styles.fieldLabel}>Building</Text>
                  <BuildingDropdown value={buildingId} onChange={setBuildingId} small />
                </>
              )}

              {roleUsesUtilities(level) && (
                <>
                  <Text style={styles.fieldLabel}>Utility Roles</Text>
                  <View style={styles.chipsRow}>
                    {UTIL_OPTIONS.map((u) => (
                      <UtilChip
                        key={u}
                        value={u}
                        selected={utilRoles.includes(u)}
                        onPress={() => toggleUtilLocal(u, utilRoles, setUtilRoles)}
                      />
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} disabled={submitting} onPress={() => setCreateVisible(false)}>
                <Text style={[styles.btnText, { color: "#082cac" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} disabled={submitting} onPress={onCreate}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, { color: "#fff" }]}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => !submitting && setEditVisible(false)}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Edit Account</Text>
              <TouchableOpacity onPress={() => !submitting && setEditVisible(false)}>
                <Ionicons name="close" size={22} color="#334155" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 10 }}>
              <Text style={styles.fieldLabel}>Full name</Text>
              <TextInput
                value={editFullname}
                onChangeText={setEditFullname}
                placeholder="Enter full name"
                placeholderTextColor="#94a3b8"
                style={styles.input}
              />

              <Text style={styles.fieldLabel}>Password (leave blank to keep)</Text>
              <TextInput
                value={editPassword}
                onChangeText={setEditPassword}
                placeholder="Enter new password"
                placeholderTextColor="#94a3b8"
                style={styles.input}
                secureTextEntry
              />

              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.chipsRow}>
                {(["operator", "biller", "admin"] as Role[]).map((r) => (
                  <RoleChip key={r} value={r} selected={r === editLevel} onPress={() => setEditLevel(r)} />
                ))}
              </View>

              {roleNeedsBuilding(editLevel) && (
                <>
                  <Text style={styles.fieldLabel}>Building</Text>
                  <BuildingDropdown value={editBuildingId} onChange={setEditBuildingId} small />
                </>
              )}

              {roleUsesUtilities(editLevel) && (
                <>
                  <Text style={styles.fieldLabel}>Utility Roles</Text>
                  <View style={styles.chipsRow}>
                    {UTIL_OPTIONS.map((u) => (
                      <UtilChip
                        key={u}
                        value={u}
                        selected={editUtilRoles.includes(u)}
                        onPress={() => toggleUtilLocal(u, editUtilRoles, setEditUtilRoles)}
                      />
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} disabled={submitting} onPress={() => setEditVisible(false)}>
                <Text style={[styles.btnText, { color: "#082cac" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} disabled={submitting} onPress={onUpdate}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, { color: "#fff" }]}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Other Filters Modal */}
      <OtherFiltersModal />
    </View>
  );
}

/** Styles — light, clean, business-professional */
const styles = StyleSheet.create({
  grid: { gap: 12 },
  card: {
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
  cardSub: { marginTop: 2, color: "#64748b", fontSize: 12 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  metaPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#f8fafc",
    borderWidth: 1, borderColor: "#e2e8f0",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  metaText: { color: "#475569", fontSize: 12 },

  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  h1: { fontSize: 20, fontWeight: "900", color: "#0b2447" },

  // Search row with button
  searchRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },

  // Search input
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
  },
  search: { flex: 1, color: "#102a43", paddingVertical: 6 },

  // Other filters button (compact)
  otherBtn: {
    height: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },

  // Building filter label under search
  filterLabel: {
    marginTop: 8,
    marginBottom: 6,
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
  },

  btn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  btnText: { fontWeight: "800", fontSize: 13 },
  btnPrimary: { backgroundColor: "#082cac" },
  btnGhost: { backgroundColor: "#ffffff", borderWidth: 1, borderColor: "#dbe3ec" },
  btnDanger: { backgroundColor: "#dc2626" },

  /** Dropdown (pills) */
  selectWrap: {
    height: 40,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6eef6",
    borderRadius: 10,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  selectItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "transparent",
    marginRight: 6,
  },
  selectItemActive: { backgroundColor: "rgba(8,44,172,0.06)", borderColor: "rgba(8,44,172,0.25)" },
  selectItemText: { fontSize: 12, color: "#475569", fontWeight: "700" },
  selectItemTextActive: { color: "#082cac" },

  /** Chips */
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  chipActive: { backgroundColor: "rgba(8,44,172,0.06)", borderColor: "rgba(8,44,172,0.25)" },
  chipText: { fontSize: 12, color: "#334155", fontWeight: "700" },
  chipTextActive: { color: "#082cac" },

  /** Modal */
  modalWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.35)" },
  modalCard: {
    width: Math.min(520, width - 24),
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e7eef7",
    ...(Platform.select({
      web: { boxShadow: "0 18px 48px rgba(2,6,23,0.20)" as any },
      default: { elevation: 4 },
    }) as any),
  },
  modalHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  modalTitle: { fontSize: 16, fontWeight: "900", color: "#0b2447" },

  fieldLabel: { fontSize: 12, color: "#64748b", marginTop: 10, marginBottom: 6, fontWeight: "700" },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#0f172a",
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },

  /** Empty */
  emptyWrap: { alignItems: "center", paddingVertical: 30, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: "#0b2447" },
  emptySub: { color: "#64748b", marginBottom: 8 },
});