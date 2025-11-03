// components/admin/AccountsPanel.tsx
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

/** ===== Types (match updated backend) =====
 * Backend now uses arrays: user_roles: string[], building_ids: string[], utility_role: string[]
 * See routes/users.js for details. */
type Role = "admin" | "operator" | "biller" | "reader";
type Util = "electric" | "water" | "lpg";

type User = {
  user_id: string;
  user_fullname: string;
  user_roles: Role[];
  building_ids: string[];
  utility_role: Util[];
};

type Building = {
  building_id: string;
  building_name: string;
};

const ALL_ROLES: Role[] = ["admin", "operator", "biller", "reader"];
const ALL_UTILS: Util[] = ["electric", "water", "lpg"];

const { width: W } = Dimensions.get("window");

/* ---------- helpers ---------- */
const notify = (title: string, message?: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
};
const errorText = (err: any, fallback = "Server error.") => {
  const d = err?.response?.data;
  if (typeof d === "string") return d;
  if (d?.error) return String(d.error);
  if (d?.message) return String(d.message);
  if (err?.message) return String(err.message);
  try { return JSON.stringify(d ?? err); } catch { return fallback; }
};
const toggleIn = <T,>(v: T, list: T[], set: (x: T[]) => void) =>
  list.includes(v) ? set(list.filter((x) => x !== v)) : set([...list, v]);

/** Tiny chip */
const Chip = ({
  label,
  active,
  onPress,
  style,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  style?: any;
}) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle, style]}>
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
  </TouchableOpacity>
);

export default function AccountsPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");

  // Create form
  const [createVisible, setCreateVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [c_fullname, setC_fullname] = useState("");
  const [c_password, setC_password] = useState("");
  const [c_roles, setC_roles] = useState<Role[]>(["operator"]);
  const [c_buildings, setC_buildings] = useState<string[]>([]);
  const [c_utils, setC_utils] = useState<Util[]>([]);

  // Edit form
  const [editVisible, setEditVisible] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [e_fullname, setE_fullname] = useState("");
  const [e_password, setE_password] = useState("");
  const [e_roles, setE_roles] = useState<Role[]>([]);
  const [e_buildings, setE_buildings] = useState<string[]>([]);
  const [e_utils, setE_utils] = useState<Util[]>([]);

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  /* ---------- load ---------- */
  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in as admin to manage accounts.");
      return;
    }
    try {
      setBusy(true);
      // /users is admin-only; /buildings is also admin-only (used for selecting building_ids)
      const [uRes, bRes] = await Promise.all([api.get<User[]>("/users"), api.get<Building[]>("/buildings")]);
      setUsers((uRes.data || []).map((u: any) => ({
        user_id: String(u.user_id),
        user_fullname: String(u.user_fullname ?? ""),
        user_roles: Array.isArray(u.user_roles) ? (u.user_roles as Role[]) : [],
        building_ids: Array.isArray(u.building_ids) ? (u.building_ids as string[]) : [],
        utility_role: Array.isArray(u.utility_role) ? (u.utility_role as Util[]) : [],
      })));
      setBuildings(bRes.data || []);
    } catch (err) {
      notify("Load failed", errorText(err, "Unable to load users."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [token]);

  /* ---------- derived ---------- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      const s = `${u.user_id} ${u.user_fullname} ${u.user_roles.join(",")} ${u.building_ids.join(",")} ${(u.utility_role||[]).join(",")}`.toLowerCase();
      const textOk = q ? s.includes(q) : true;
      const roleOk = roleFilter ? u.user_roles.includes(roleFilter) : true;
      const bldgOk = buildingFilter ? u.building_ids.includes(buildingFilter) : true;
      return textOk && roleOk && bldgOk;
    });
  }, [users, query, roleFilter, buildingFilter]);

  /* ---------- create ---------- */
  const resetCreate = () => {
    setC_fullname(""); setC_password("");
    setC_roles(["operator"]);
    setC_buildings([]);
    setC_utils([]);
  };

  const onCreate = async () => {
    if (!c_fullname || !c_password) {
      notify("Missing fields", "Full name and password are required.");
      return;
    }
    if (c_roles.length === 0) {
      notify("Missing roles", "Select at least one role.");
      return;
    }
    try {
      setSubmitting(true);
      await api.post("/users", {
        user_fullname: c_fullname,
        user_password: c_password,
        user_roles: c_roles,
        building_ids: c_buildings,
        utility_role: c_utils,
      });
      setCreateVisible(false);
      resetCreate();
      await loadAll();
      notify("Success", "Account created.");
    } catch (err) {
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- edit ---------- */
  const openEdit = (u: User) => {
    setEditUser(u);
    setE_fullname(u.user_fullname);
    setE_password("");
    setE_roles(u.user_roles || []);
    setE_buildings(u.building_ids || []);
    setE_utils(u.utility_role || []);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editUser) return;
    if (!e_fullname) {
      notify("Missing fields", "Full name is required.");
      return;
    }
    if (e_roles.length === 0) {
      notify("Missing roles", "Select at least one role.");
      return;
    }
    try {
      setSubmitting(true);
      const payload: any = {
        user_fullname: e_fullname,
        user_roles: e_roles,
        building_ids: e_buildings,
        utility_role: e_utils,
      };
      if (e_password) payload.user_password = e_password;
      await api.put(`/users/${encodeURIComponent(editUser.user_id)}`, payload);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Account updated.");
    } catch (err) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- UI ---------- */
  const Header = () => (
    <View style={styles.headerRow}>
      <Text style={styles.title}>Manage Accounts</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={() => setCreateVisible(true)}>
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={styles.primaryBtnText}>Create User</Text>
      </TouchableOpacity>
    </View>
  );

  const Toolbar = () => (
    <View style={styles.toolbar}>
      <View style={[styles.searchWrap, { flex: 1 }]}>
        <Ionicons name="search-outline" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search users…"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
        />
      </View>

      <View style={styles.toolbarChips}>
        <View style={styles.filtersGroup}>
          <Text style={styles.filterLabel}>Role:</Text>
          <Chip label="All" active={roleFilter === ""} onPress={() => setRoleFilter("")} />
          {ALL_ROLES.map((r) => (
            <Chip key={r} label={r} active={roleFilter === r} onPress={() => setRoleFilter(r)} />
          ))}
        </View>

        <View style={styles.filtersGroup}>
          <Text style={styles.filterLabel}>Building:</Text>
          <Chip label="All" active={buildingFilter === ""} onPress={() => setBuildingFilter("")} />
          {buildings.slice(0, 6).map((b) => (
            <Chip
              key={b.building_id}
              label={b.building_name || b.building_id}
              active={buildingFilter === b.building_id}
              onPress={() => setBuildingFilter(b.building_id)}
            />
          ))}
        </View>
      </View>
    </View>
  );

  const Row = ({ item }: { item: User }) => (
    <TouchableOpacity style={styles.row} onPress={() => openEdit(item)}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{item.user_fullname}</Text>
        <Text style={styles.rowMeta}>
          {item.user_id} • Roles: {item.user_roles.join(", ") || "—"}
        </Text>
        <Text style={styles.rowMeta}>
          Buildings: {item.building_ids.join(", ") || "—"} • Utilities: {item.utility_role.join(", ") || "—"}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#475569" />
    </TouchableOpacity>
  );

  const CreateModal = () => (
    <Modal visible={createVisible} onRequestClose={() => setCreateVisible(false)} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.modalCard}>
          <Text style={styles.modalTitle}>Create User</Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.label}>Full name</Text>
            <TextInput value={c_fullname} onChangeText={setC_fullname} style={styles.input} />

            <Text style={styles.label}>Password</Text>
            <TextInput value={c_password} onChangeText={setC_password} secureTextEntry style={styles.input} />

            <Text style={styles.label}>Roles</Text>
            <View style={styles.multiRow}>
              {ALL_ROLES.map((r) => (
                <Chip key={r} label={r} active={c_roles.includes(r)} onPress={() => toggleIn(r, c_roles, setC_roles)} />
              ))}
            </View>

            <Text style={styles.label}>Buildings</Text>
            <View style={styles.multiRow}>
              {buildings.map((b) => (
                <Chip
                  key={b.building_id}
                  label={b.building_name || b.building_id}
                  active={c_buildings.includes(b.building_id)}
                  onPress={() => toggleIn(b.building_id, c_buildings, setC_buildings)}
                />
              ))}
            </View>

            <Text style={styles.label}>Utility roles</Text>
            <View style={styles.multiRow}>
              {ALL_UTILS.map((u) => (
                <Chip key={u} label={u} active={c_utils.includes(u)} onPress={() => toggleIn(u, c_utils, setC_utils)} />
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setCreateVisible(false)}>
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} disabled={submitting} onPress={onCreate}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  const EditModal = () => (
    <Modal visible={editVisible} onRequestClose={() => setEditVisible(false)} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.modalCard}>
          <Text style={styles.modalTitle}>Edit User</Text>
          <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.label}>User ID</Text>
            <View style={[styles.input, { backgroundColor: "#f1f5f9" }]}>
              <Text selectable style={{ color: "#475569" }}>{editUser?.user_id}</Text>
            </View>

            <Text style={styles.label}>Full name</Text>
            <TextInput value={e_fullname} onChangeText={setE_fullname} style={styles.input} />

            <Text style={styles.label}>New password (optional)</Text>
            <TextInput value={e_password} onChangeText={setE_password} secureTextEntry style={styles.input} placeholder="Leave blank to keep current" />

            <Text style={styles.label}>Roles</Text>
            <View style={styles.multiRow}>
              {ALL_ROLES.map((r) => (
                <Chip key={r} label={r} active={e_roles.includes(r)} onPress={() => toggleIn(r, e_roles, setE_roles)} />
              ))}
            </View>

            <Text style={styles.label}>Buildings</Text>
            <View style={styles.multiRow}>
              {buildings.map((b) => (
                <Chip
                  key={b.building_id}
                  label={b.building_name || b.building_id}
                  active={e_buildings.includes(b.building_id)}
                  onPress={() => toggleIn(b.building_id, e_buildings, setE_buildings)}
                />
              ))}
            </View>

            <Text style={styles.label}>Utility roles</Text>
            <View style={styles.multiRow}>
              {ALL_UTILS.map((u) => (
                <Chip key={u} label={u} active={e_utils.includes(u)} onPress={() => toggleIn(u, e_utils, setE_utils)} />
              ))}
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => setEditVisible(false)}>
              <Text style={styles.ghostBtnText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} disabled={submitting} onPress={onUpdate}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Header />
        <Toolbar />

        {busy ? (
          <View style={styles.loadingWrap}><ActivityIndicator size="large" /></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(u) => u.user_id}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={Row}
            contentContainerStyle={{ paddingBottom: 12 }}
          />
        )}
      </View>

      <CreateModal />
      <EditModal />
    </View>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  page: { flex: 1, padding: 16 },
  card: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
  },
  headerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12,
  },
  title: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  primaryBtn: {
    backgroundColor: "#1e3a8a", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6,
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  toolbar: { marginBottom: 10 },
  searchWrap: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#f1f5f9", borderRadius: 10,
    paddingHorizontal: 10, height: 40,
  },
  searchInput: { flex: 1, color: "#0f172a" },
  toolbarChips: { marginTop: 10, gap: 10 },
  filtersGroup: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  filterLabel: { fontWeight: "600", color: "#334155", marginRight: 4 },
  sep: { height: 1, backgroundColor: "#e2e8f0" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  rowName: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  rowMeta: { color: "#475569", marginTop: 2, fontSize: 12 },
  loadingWrap: { paddingVertical: 32, alignItems: "center", justifyContent: "center" },

  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: "#cbd5e1" },
  chipActive: { backgroundColor: "#1e3a8a", borderColor: "#1e3a8a" },
  chipIdle: { backgroundColor: "#f8fafc" },
  chipText: { fontSize: 12 },
  chipTextActive: { color: "#fff", fontWeight: "600" },
  chipTextIdle: { color: "#334155" },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(15,23,42,0.35)", alignItems: "center", justifyContent: "center", padding: 16,
  },
  modalCard: {
    width: Math.min(W - 24, 760), maxHeight: Math.min(680, Math.round(0.9 * Dimensions.get("window").height)),
    backgroundColor: "#fff", borderRadius: 16, padding: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a", marginBottom: 10 },
  label: { marginTop: 10, marginBottom: 6, fontWeight: "600", color: "#0f172a" },
  input: {
    backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: "#e2e8f0", color: "#0f172a",
  },
  multiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  ghostBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  ghostBtnText: { color: "#1e293b", fontWeight: "600" },
});