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
import { Picker } from "@react-native-picker/picker";
import { BASE_API } from "../../constants/api";

type Role = "admin" | "operator" | "biller" | "reader";
type Util = "electric" | "water" | "lpg";
const UTIL_OPTIONS: Util[] = ["electric", "water", "lpg"];

type User = {
  user_id: string;
  user_fullname: string;
  user_level: Role;
  building_id: string | null;
  utility_role?: Util[] | null;
};

type Building = {
  building_id: string;
  building_name: string;
  rate_id: string;
};

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
  const [query, setQuery] = useState("");

  // create form
  const [fullname, setFullname] = useState("");
  const [password, setPassword] = useState("");
  const [level, setLevel] = useState<Role>("operator");
  const [buildingId, setBuildingId] = useState("");
  const [utilRoles, setUtilRoles] = useState<Util[]>([]);

  // edit form
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
    // if backend serializes as JSON string for some reason
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
      Alert.alert("Not logged in", "Please log in as admin to manage users.");
      return;
    }
    try {
      setBusy(true);
      const [usersRes, buildingsRes] = await Promise.all([
        api.get<User[]>("/users"),
        api.get<Building[]>("/buildings"),
      ]);

      // normalize utility_role just in case
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
      Alert.alert(
        "Load failed",
        err?.response?.data?.error ??
          "Please check your connection and permissions.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [token]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const utils = (u.utility_role || []).join(",");
      return (
        u.user_id.toLowerCase().includes(q) ||
        u.user_fullname.toLowerCase().includes(q) ||
        u.user_level.toLowerCase().includes(q) ||
        (u.building_id ?? "").toLowerCase().includes(q) ||
        utils.includes(q)
      );
    });
  }, [users, query]);

  const roleNeedsBuilding = (r: Role) => r !== "admin";
  const roleUsesUtilities = (r: Role) => r === "biller" || r === "reader";

  const onCreate = async () => {
    if (!fullname || !password) {
      Alert.alert("Missing info", "Please fill in full name and password.");
      return;
    }
    if (roleNeedsBuilding(level) && !buildingId) {
      Alert.alert("Missing building", "Select a building for non-admin users.");
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

      // reset
      setFullname("");
      setPassword("");
      setLevel("operator");
      setUtilRoles([]);
      await loadAll();
      Alert.alert("Success", "User created.");
    } catch (err: any) {
      console.error("[CREATE USER]", err?.response?.data || err?.message);
      Alert.alert(
        "Create failed",
        err?.response?.data?.error ?? "Server error.",
      );
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
      Alert.alert("Missing building", "Select a building for non-admin users.");
      return;
    }
    try {
      setSubmitting(true);
      const payload: any = {
        user_fullname: editFullname,
        user_level: editLevel,
      };

      // building logic
      if (editLevel === "admin") {
        // let backend keep or null it only if provided; we’ll pass null if cleared in UI
        payload.building_id = editBuildingId || null;
      } else {
        payload.building_id = editBuildingId;
      }

      // utility role logic
      if (roleUsesUtilities(editLevel)) {
        payload.utility_role = editUtilRoles;
      } else {
        payload.utility_role = null;
      }

      if (editPassword) payload.user_password = editPassword;

      await api.put(`/users/${encodeURIComponent(editUser.user_id)}`, payload);
      setEditVisible(false);
      await loadAll();
      Alert.alert("Updated", "User updated successfully.");
    } catch (err: any) {
      console.error("[UPDATE USER]", err?.response?.data || err?.message);
      Alert.alert(
        "Update failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /** Cross-platform confirm helper */
  const confirmDelete = (title: string, message: string): Promise<boolean> => {
    if (Platform.OS === "web") {
      const ok = (globalThis as any).confirm
        ? (globalThis as any).confirm(`${title}\n\n${message}`)
        : true;
      return Promise.resolve(!!ok);
    }
    return new Promise((resolve) => {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Delete", style: "destructive", onPress: () => resolve(true) },
      ]);
    });
  };

  const onDelete = async (u: User) => {
    const ok = await confirmDelete(
      "Delete user",
      `Are you sure you want to delete ${u.user_fullname} (${u.user_id})?`,
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/users/${encodeURIComponent(u.user_id)}`);
      await loadAll();

      if (Platform.OS !== "web") {
        Alert.alert("Deleted", "User removed.");
      }
    } catch (err: any) {
      console.error("[DELETE USER]", err?.response?.data || err?.message);
      Alert.alert(
        "Delete failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /** UI helpers */
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
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { label: string; value: string }[];
  }) => (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.pickerWrapper}>
        <Picker
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

  return (
    <View style={styles.grid}>
      {/* CREATE ACCOUNT */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create Account</Text>

        <View style={styles.formRow}>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            value={fullname}
            onChangeText={setFullname}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        <Text style={styles.modalLabel}>Role</Text>
        <View style={styles.formRow}>
          <Chip
            label="Admin"
            active={level === "admin"}
            onPress={() => setLevel("admin")}
          />
          <Chip
            label="Operator"
            active={level === "operator"}
            onPress={() => setLevel("operator")}
          />
          <Chip
            label="Biller"
            active={level === "biller"}
            onPress={() => setLevel("biller")}
          />
          <Chip
            label="Reader"
            active={level === "reader"}
            onPress={() => setLevel("reader")}
          />
        </View>

        {roleNeedsBuilding(level) && (
          <Dropdown
            label="Building"
            value={buildingId}
            onChange={setBuildingId}
            options={buildings.map((b) => ({
              label: `${b.building_name} (${b.building_id})`,
              value: b.building_id,
            }))}
          />
        )}

        {roleUsesUtilities(level) && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.modalLabel}>Utility Role</Text>
            <View style={styles.formRow}>
              {UTIL_OPTIONS.map((u) => (
                <UtilChip
                  key={u}
                  util={u}
                  selected={utilRoles.includes(u)}
                  onToggle={() => setUtilRoles(toggleArrayValue(utilRoles, u))}
                />
              ))}
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[styles.btn, submitting && styles.btnDisabled]}
          onPress={onCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          New users are auto-assigned IDs like{" "}
          <Text style={{ fontWeight: "700" }}>USER-N</Text>.
        </Text>
      </View>

      {/* MANAGE ACCOUNTS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Manage Accounts</Text>

        <TextInput
          style={styles.search}
          placeholder="Search by ID, name, role, building, utility…"
          value={query}
          onChangeText={setQuery}
        />

        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={filteredUsers}
            keyExtractor={(item) => item.user_id}
            scrollEnabled={Platform.OS === "web"}
            nestedScrollEnabled={false}
            ListEmptyComponent={
              <Text style={styles.empty}>No users found.</Text>
            }
            renderItem={({ item }) => {
              const utils = (item.utility_role || [])
                .map((u) => u.toUpperCase())
                .join(", ");
              return (
                <View className="row" style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.user_fullname}</Text>
                    <Text style={styles.rowSub}>
                      {item.user_id} • {item.user_level.toUpperCase()} •{" "}
                      {item.building_id ?? "—"}
                      {utils ? ` • ${utils}` : ""}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.link}
                    onPress={() => openEdit(item)}
                  >
                    <Text style={styles.linkText}>Edit</Text>
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

      {/* EDIT MODAL */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit User</Text>
            <Text style={styles.modalLabel}>Full name</Text>
            <TextInput
              style={styles.input}
              value={editFullname}
              onChangeText={setEditFullname}
            />

            <Text style={styles.modalLabel}>New password (optional)</Text>
            <TextInput
              style={styles.input}
              value={editPassword}
              onChangeText={setEditPassword}
              secureTextEntry
            />

            <Text style={styles.modalLabel}>Role</Text>
            <View style={styles.formRow}>
              <Chip
                label="Admin"
                active={editLevel === "admin"}
                onPress={() => setEditLevel("admin")}
              />
              <Chip
                label="Operator"
                active={editLevel === "operator"}
                onPress={() => setEditLevel("operator")}
              />
              <Chip
                label="Biller"
                active={editLevel === "biller"}
                onPress={() => setEditLevel("biller")}
              />
              <Chip
                label="Reader"
                active={editLevel === "reader"}
                onPress={() => setEditLevel("reader")}
              />
            </View>

            {roleNeedsBuilding(editLevel) && (
              <Dropdown
                label="Building"
                value={editBuildingId}
                onChange={setEditBuildingId}
                options={buildings.map((b) => ({
                  label: `${b.building_name} (${b.building_id})`,
                  value: b.building_id,
                }))}
              />
            )}

            {roleUsesUtilities(editLevel) && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.modalLabel}>Utility Role</Text>
                <View style={styles.formRow}>
                  {UTIL_OPTIONS.map((u) => (
                    <UtilChip
                      key={u}
                      util={u}
                      selected={editUtilRoles.includes(u)}
                      onToggle={() =>
                        setEditUtilRoles(toggleArrayValue(editUtilRoles, u))
                      }
                    />
                  ))}
                </View>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setEditVisible(false)}
              >
                <Text style={[styles.btnText, { color: "#102a43" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={onUpdate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Save changes</Text>
                )}
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
    backgroundColor: "#ffffff",
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

  formRow: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginTop: 10 },
  input: {
    flexGrow: 1,
    minWidth: 160,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: "#102a43",
  },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: "#2f6fed", borderColor: "#2f6fed" },
  chipIdle: { backgroundColor: "#fff", borderColor: "#bcccdc" },
  chipText: { fontSize: 14, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  chipTextIdle: { color: "#334e68" },

  dropdownLabel: {
    color: "#334e68ff",
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 6,
  },
  btn: {
    marginTop: 12,
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.7 },
  btnGhost: { backgroundColor: "#e6efff" },
  btnText: { color: "#fff", fontWeight: "700" },

  hint: { marginTop: 8, color: "#486581" },

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
  modalLabel: {
    color: "#334e68",
    marginTop: 6,
    marginBottom: 6,
    fontWeight: "600",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },

  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  picker: { height: 55, width: "100%" },
});
