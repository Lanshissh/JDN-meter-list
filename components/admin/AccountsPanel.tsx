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
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";

// ---------------- Types ----------------
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

// ---------------- Alert helpers ----------------
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

// ---------------- Component ----------------
export default function AccountsPanel({
  token,
  apiBase = `${BASE_API}`,
}: {
  token: string | null;
  apiBase?: string;
}) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // search + sort
  const [query, setQuery] = useState("");
  type SortMode = "newest" | "oldest" | "name" | "role" | "id";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // role filter
  type RoleFilter = "" | Role;
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("");

  // --- create form (modal) ---
  const [createVisible, setCreateVisible] = useState(false);
  const [fullname, setFullname] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<Role>("operator");
  const [buildingId, setBuildingId] = useState("");
  const [utilRoles, setUtilRoles] = useState<Util[]>([]);

  // --- edit form (modal) ---
  const [editVisible, setEditVisible] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editFullname, setEditFullname] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editLevel, setEditLevel] = useState<Role>("operator");
  const [editBuildingId, setEditBuildingId] = useState<string>("");
  const [editUtilRoles, setEditUtilRoles] = useState<Util[]>([]);

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token],
  );

  const api = useMemo(
    () =>
      axios.create({
        baseURL: apiBase,
        headers: authHeader,
        timeout: 15000,
      }),
    [apiBase, authHeader],
  );

  const parseUtils = (val: any): Util[] | null => {
    if (val == null) return null;
    if (Array.isArray(val)) {
      return val.map(String).map((v) => v.toLowerCase() as Util);
    }
    try {
      const arr = JSON.parse(String(val));
      return Array.isArray(arr)
        ? (arr.map(String).map((v) => v.toLowerCase()) as Util[])
        : null;
    } catch {
      return null;
    }
  };

  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in as admin to manage users.");
      return;
    }
    try {
      setBusy(true);
      const [usersRes, buildingsRes] = await Promise.all([
        api.get<User[]>("/users"),
        api.get<Building[]>("/buildings"),
      ]);

      const normalizedUsers = (usersRes.data || []).map((u: any) => ({
        ...u,
        utility_role: parseUtils(u.utility_role),
        building_id:
          u.building_id === undefined || u.building_id === null
            ? null
            : String(u.building_id),
        user_level: String(u.user_level).toLowerCase() as Role,
      }));

      setUsers(normalizedUsers);
      setBuildings(buildingsRes.data || []);

      if (!buildingId && buildingsRes.data?.length) {
        setBuildingId(buildingsRes.data[0].building_id);
      }
    } catch (err: any) {
      console.error("[ADMIN LOAD]", err?.response?.data || err?.message);
      notify(
        "Load failed",
        errorText(err, "Please check your connection and permissions."),
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---------- Derived lists ----------
  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users;

    if (roleFilter) list = list.filter((u) => u.user_level === roleFilter);

    if (!q) return list;
    return list.filter((u) => {
      const utils = (u.utility_role || []).join(",");
      return (
        u.user_id.toLowerCase().includes(q) ||
        u.user_fullname.toLowerCase().includes(q) ||
        u.user_level.toLowerCase().includes(q) ||
        (u.building_id ?? "").toLowerCase().includes(q) ||
        utils.includes(q)
      );
    });
  }, [users, query, roleFilter]);

  const sortedUsers = useMemo(() => {
    const arr = [...filteredUsers];
    switch (sortMode) {
      case "name":
        arr.sort((a, b) => a.user_fullname.localeCompare(b.user_fullname));
        break;
      case "role":
        arr.sort(
          (a, b) =>
            a.user_level.localeCompare(b.user_level) ||
            a.user_fullname.localeCompare(b.user_fullname),
        );
        break;
      case "id":
        arr.sort((a, b) => a.user_id.localeCompare(b.user_id));
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
  }, [filteredUsers, sortMode]);

  // ---------- Actions ----------
  const roleNeedsBuilding = (r: Role) => r !== "admin";
  const roleUsesUtilities = (r: Role) => r === "biller";

  const onCreate = async () => {
    if (!fullname || !password) {
      notify("Missing info", "Please fill in full name and password.");
      return;
    }
    if (roleNeedsBuilding(level) && !buildingId) {
      notify("Missing building", "Select a building for non-admin users.");
      return;
    }
    try {
      setSubmitting(true);
      const payload: any = {
        user_password: password,
        user_fullname: fullname,
        user_level: level,
      };
      if (roleNeedsBuilding(level)) payload.building_id = buildingId;
      if (roleUsesUtilities(level)) payload.utility_role = utilRoles;

      await api.post("/users", payload);

      // reset + close modal
      setFullname("");
      setPassword("");
      setLevel("operator");
      setUtilRoles([]);
      setCreateVisible(false);
      await loadAll();

      notify("Success", "User created.");
    } catch (err: any) {
      console.error("[CREATE USER]", err?.response?.data || err?.message);
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setEditFullname(u.user_fullname);
    setEditLevel(u.user_level);
    setEditBuildingId(u.building_id ?? "");
    setEditPassword("");
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
      const payload: any = {
        user_fullname: editFullname,
        user_level: editLevel,
      };

      if (editLevel === "admin") {
        payload.building_id = editBuildingId || null;
      } else {
        payload.building_id = editBuildingId;
      }

      if (roleUsesUtilities(editLevel)) {
        payload.utility_role = editUtilRoles;
      } else {
        payload.utility_role = null;
      }

      if (editPassword) payload.user_password = editPassword;

      await api.put(`/users/${encodeURIComponent(editUser.user_id)}`, payload);
      setEditVisible(false);
      await loadAll();

      notify("Updated", "User updated successfully.");
    } catch (err: any) {
      console.error("[UPDATE USER]", err?.response?.data || err?.message);
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (u: User) => {
    const ok = await confirm(
      "Delete user",
      `Are you sure you want to delete ${u.user_fullname} (${u.user_id})?`,
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/users/${encodeURIComponent(u.user_id)}`);
      await loadAll();
      notify("Deleted", "User removed.");
    } catch (err: any) {
      console.error("[DELETE USER]", err?.response?.data || err?.message);
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- UI helpers ----------
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

  const UtilChip = ({
    util,
    selected,
    onToggle,
  }: {
    util: Util;
    selected: boolean;
    onToggle: () => void;
  }) => (
    <TouchableOpacity
      onPress={onToggle}
      style={[styles.chip, selected ? styles.chipActive : styles.chipIdle]}
    >
      <Text
        style={[
          styles.chipText,
          selected ? styles.chipTextActive : styles.chipTextIdle,
        ]}
      >
        {util.toUpperCase()}
      </Text>
    </TouchableOpacity>
  );

  const Dropdown = ({
    label,
    value,
    onChange,
    options,
    disabled,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { label: string; value: string }[];
    disabled?: boolean;
  }) => (
    <View style={{ marginTop: 8, opacity: disabled ? 0.6 : 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.pickerWrapper}>
        <Picker
          enabled={!disabled}
          selectedValue={value}
          onValueChange={(itemValue) => onChange(String(itemValue))}
          style={styles.picker}
        >
          {options.map((opt) => (
            <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );

  const toggleArrayValue = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const Empty = ({ title, note }: { title: string; note?: string }) => (
    <View style={styles.emptyWrap}>
      <Ionicons name="people-outline" size={28} color="#94a3b8" />
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!note && <Text style={styles.emptyNote}>{note}</Text>}
    </View>
  );

  // ---------- Render ----------
  return (
    <View style={styles.grid}>
      {/* CARD: Manage Accounts */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Manage Accounts</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setCreateVisible(true)}
            >
              <Text style={styles.btnText}>+ Create Account</Text>
            </TouchableOpacity>
          </View>
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
            value={query}
            onChangeText={setQuery}
            placeholder="Search by ID, name, role, building, utility…"
            placeholderTextColor="#9aa5b1"
          />
        </View>

        {/* Filters (moved below search) */}
        <View style={styles.filtersRow}>
          {/* Role filter */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Role</Text>
            <View style={styles.chipsRow}>
              {["", "admin", "operator", "biller"].map((role) => (
                <Chip
                  key={role || "all"}
                  label={role ? role.toUpperCase() : "All"}
                  active={roleFilter === role}
                  onPress={() => setRoleFilter(role as any)}
                />
              ))}
            </View>
          </View>

          {/* Sort filter */}
          <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>Sort by</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "Name", val: "name" },
                { label: "Role", val: "role" },
                { label: "ID", val: "id" },
              ].map(({ label, val }) => (
                <Chip
                  key={val}
                  label={label}
                  active={sortMode === val}
                  onPress={() => setSortMode(val as any)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* List */}
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sortedUsers}
            keyExtractor={(item) => item.user_id}
            style={{ marginTop: 4 }}
            ListEmptyComponent={
              <Empty
                title="No users found"
                note="Try adjusting filters or create a new account."
              />
            }
            renderItem={({ item }) => {
              const meta = [
                item.user_level?.toUpperCase(),
                item.building_id || "—",
                item.utility_role?.length
                  ? `UTIL: ${item.utility_role.join("/").toUpperCase()}`
                  : undefined,
              ]
                .filter(Boolean)
                .join("  •  ");
              return (
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.user_fullname}</Text>
                    <Text style={styles.rowSub}>
                      {item.user_id}
                      {meta ? `  •  ${meta}` : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.link}
                    onPress={() => openEdit(item)}
                  >
                    <Text style={styles.linkText}>Update</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.link, { marginLeft: 8 }]}
                    onPress={() => onDelete(item)}
                  >
                    <Text style={[styles.linkText, { color: "#e53935" }]}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            }}
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
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              <Text style={styles.modalTitle}>Create Account</Text>

              <Text style={styles.dropdownLabel}>Full name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Juan Dela Cruz"
                value={fullname}
                onChangeText={setFullname}
              />

              <Text style={styles.dropdownLabel}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Set a password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />

              <Text style={styles.dropdownLabel}>Role</Text>
              <View style={styles.chipsRow}>
                {(["admin", "operator", "biller"] as Role[]).map((r) => (
                  <Chip
                    key={r}
                    label={r.toUpperCase()}
                    active={level === r}
                    onPress={() => setLevel(r)}
                  />
                ))}
              </View>

              {/* Building (disabled for admin selection optional) */}
              <Dropdown
                label="Building"
                value={buildingId}
                onChange={setBuildingId}
                disabled={!roleNeedsBuilding(level)}
                options={buildings.map((b) => ({
                  label: `${b.building_name} (${b.building_id})`,
                  value: b.building_id,
                }))}
              />

              {/* Utility chips (only for biller) */}
              {level === "biller" && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Utility Access</Text>
                  <View style={styles.chipsRow}>
                    {UTIL_OPTIONS.map((u) => (
                      <UtilChip
                        key={u}
                        util={u}
                        selected={utilRoles.includes(u)}
                        onToggle={() =>
                          setUtilRoles((cur) => toggleArrayValue(cur, u))
                        }
                      />
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btnGhost]}
                onPress={() => setCreateVisible(false)}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                disabled={submitting}
                onPress={onCreate}
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

      {/* EDIT MODAL */}
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
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              <Text style={styles.modalTitle}>Update Account</Text>

              <Text style={styles.dropdownLabel}>Full name</Text>
              <TextInput
                style={styles.input}
                value={editFullname}
                onChangeText={setEditFullname}
              />

              <Text style={styles.dropdownLabel}>New password (optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="Leave blank to keep"
                value={editPassword}
                onChangeText={setEditPassword}
                secureTextEntry
              />

            <View style={[styles.filterCol, { flex: 1 }]}>
              <Text style={styles.dropdownLabel}>Role</Text>
              <View style={styles.chipsRow}>
                {(["admin", "operator", "biller"] as Role[]).map((r) => (
                  <Chip
                    key={r}
                    label={r.toUpperCase()}
                    active={editLevel === r}
                    onPress={() => setEditLevel(r)}
                  />
                ))}
              </View>
            </View>

              <Dropdown
                label="Building"
                value={editBuildingId}
                onChange={setEditBuildingId}
                disabled={!roleNeedsBuilding(editLevel)}
                options={buildings.map((b) => ({
                  label: `${b.building_name} (${b.building_id})`,
                  value: b.building_id,
                }))}
              />

              {editLevel === "biller" && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Utility Access</Text>
                  <View style={styles.chipsRow}>
                    {UTIL_OPTIONS.map((u) => (
                      <UtilChip
                        key={u}
                        util={u}
                        selected={editUtilRoles.includes(u)}
                        onToggle={() =>
                          setEditUtilRoles((cur) => toggleArrayValue(cur, u))
                        }
                      />
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btnGhost]}
                onPress={() => setEditVisible(false)}
              >
                <Text style={styles.btnGhostText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                disabled={submitting}
                onPress={onUpdate}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ---------------- Styles ----------------
const styles = StyleSheet.create({
  grid: {
    flex: 1,
    padding: 12,
    gap: 12,
  },
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
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43",
  },

  // Search
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
  search: {
    flex: 1,
    fontSize: 14,
    color: "#0b1f33",
  },

  // Buttons
  btn: {
    backgroundColor: "#0f62fe",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "#eef2ff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { color: "#3b5bdb", fontWeight: "700" },
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
  pickerWrapper: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  picker: { height: 44 },
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
  filtersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
    gap: 12,
  },
  filterGroup: {
    flex: 1,
    minWidth: 140,
  },
  filterLabel: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 4,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0", // light gray border
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 10,
  },
});