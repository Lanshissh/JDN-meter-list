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
} from "react-native";
import axios from "axios";
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";

/** Types */
type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  bill_start: string;
  tenant_status: "active" | "inactive";
  last_updated: string;
  updated_by: string;
};

type Building = {
  building_id: string;
  building_name: string;
};

/** Helpers */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const dateOf = (t: Tenant) => Date.parse(t.last_updated || t.bill_start || "") || 0;

function today() { return new Date().toISOString().slice(0, 10); }

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (!isNaN(d.getTime()))
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return iso || "";
}

function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const base64 = (part || "").replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padLen);
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let str = "";
    for (let i = 0; i < padded.length; i += 4) {
      const c1 = chars.indexOf(padded[i]);
      const c2 = chars.indexOf(padded[i + 1]);
      const c3 = chars.indexOf(padded[i + 2]);
      const c4 = chars.indexOf(padded[i + 3]);
      const n = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);
      const b1 = (n >> 16) & 255, b2 = (n >> 8) & 255, b3 = n & 255;
      if (c3 === 64) str += String.fromCharCode(b1);
      else if (c4 === 64) str += String.fromCharCode(b1, b2);
      else str += String.fromCharCode(b1, b2, b3);
    }
    const json = decodeURIComponent(
      str.split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Alerts */
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

/** Component */
export default function TenantsPanel({ token }: { token: string | null }) {
  const { token: ctxToken } = useAuth();
  const mergedToken = token || ctxToken || null;
  const jwt = useMemo(() => decodeJwtPayload(mergedToken), [mergedToken]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${mergedToken ?? ""}` }), [mergedToken]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  // Filters & state
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // Create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [sn, setSn] = useState("");
  const [name, setName] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [billStart, setBillStart] = useState(today());
  const [createStatus, setCreateStatus] = useState<"active" | "inactive">("active");

  // Edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Tenant | null>(null);
  const [editSn, setEditSn] = useState("");
  const [editName, setEditName] = useState("");
  const [editBuildingId, setEditBuildingId] = useState("");
  const [editBillStart, setEditBillStart] = useState(today());
  const [editStatus, setEditStatus] = useState<"active" | "inactive">("active");

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [mergedToken, statusFilter]);

  const loadAll = async () => {
    if (!mergedToken) { setBusy(false); notify("Not logged in", "Please log in to view tenants."); return; }
    try {
      setBusy(true);
      const params: any = {}; if (statusFilter) params.status = statusFilter;
      const tRes = await api.get<Tenant[]>("/tenants", { params });
      setTenants(tRes.data || []);

      let bData: Building[] = [];
      if (isAdmin) { const bRes = await api.get<Building[]>("/buildings"); bData = bRes.data || []; setBuildings(bData); }
      else { setBuildings([]); }

      setBuildingId((prev) => { if (prev) return prev; if (!isAdmin && userBuildingId) return userBuildingId; return bData?.[0]?.building_id ?? ""; });
    } catch (err: any) { notify("Load failed", errorText(err, "Connection error.")); }
    finally { setBusy(false); }
  };

  /** Building options */
  const createBuildingOptions = useMemo(() => {
    if (isAdmin) return buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }));
    const only = userBuildingId ? [{ label: userBuildingId, value: userBuildingId }] : [];
    return only;
  }, [isAdmin, buildings, userBuildingId]);

  const filterBuildingOptions = useMemo(() => (
    [ { label: "All Buildings", value: "" }, ...(isAdmin ? buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id })) : userBuildingId ? [{ label: userBuildingId, value: userBuildingId }] : []) ]
  ), [isAdmin, buildings, userBuildingId]);

  /** Derived lists */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tenants;
    if (buildingFilter) list = list.filter((t) => t.building_id === buildingFilter);
    if (statusFilter) list = list.filter((t) => t.tenant_status === statusFilter);
    if (!q) return list;
    return list.filter((t) => (
      t.tenant_id.toLowerCase().includes(q) ||
      t.tenant_sn.toLowerCase().includes(q) ||
      t.tenant_name.toLowerCase().includes(q) ||
      t.building_id.toLowerCase().includes(q) ||
      t.bill_start.toLowerCase().includes(q) ||
      t.tenant_status.toLowerCase().includes(q)
    ));
  }, [tenants, query, buildingFilter, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "newest": return arr.sort((a, b) => dateOf(b) - dateOf(a));
      case "oldest": return arr.sort((a, b) => dateOf(a) - dateOf(b));
      case "idAsc": return arr.sort((a, b) => cmp(a.tenant_id, b.tenant_id));
      case "idDesc": return arr.sort((a, b) => cmp(b.tenant_id, a.tenant_id));
      default: return arr;
    }
  }, [filtered, sortMode]);

  /** Create */
  const onCreate = async () => {
    const finalBuildingId = isAdmin ? buildingId : userBuildingId || buildingId;
    if (!sn || !name || !finalBuildingId || !billStart) { notify("Missing info", "Please fill in all fields."); return; }
    try {
      setSubmitting(true);
      const res = await api.post("/tenants", { tenant_sn: sn, tenant_name: name, building_id: finalBuildingId, bill_start: billStart, tenant_status: createStatus });
      const assignedId: string = res?.data?.tenantId ?? res?.data?.tenant_id ?? res?.data?.id ?? "";
      setSn(""); setName(""); setBillStart(today()); setCreateStatus("active"); setCreateVisible(false);
      await loadAll();
      notify("Success", assignedId ? `Tenant created.\nID assigned: ${assignedId}` : "Tenant created.");
    } catch (err: any) { notify("Create failed", errorText(err)); }
    finally { setSubmitting(false); }
  };

  /** Edit */
  const openEdit = (row: Tenant) => { setEditRow(row); setEditSn(row.tenant_sn); setEditName(row.tenant_name); setEditBuildingId(row.building_id); setEditBillStart(row.bill_start); setEditStatus(row.tenant_status); setEditVisible(true); };

  const onUpdate = async () => {
    if (!editRow) return;
    try {
      setSubmitting(true);
      const res = await api.put(`/tenants/${encodeURIComponent(editRow.tenant_id)}`, { tenant_sn: editSn, tenant_name: editName, building_id: editBuildingId, bill_start: editBillStart, tenant_status: editStatus });
      setEditVisible(false);
      await loadAll();
      const freedInfo = typeof res?.data?.stalls_freed === "number" && res.data.stalls_freed > 0 ? `\nFreed stalls: ${res.data.stalls_freed}` : "";
      notify("Updated", `Tenant updated successfully.${freedInfo}`);
    } catch (err: any) { notify("Update failed", errorText(err)); }
    finally { setSubmitting(false); }
  };

  /** Delete */
  const onDelete = async (t: Tenant) => {
    const ok = await confirm("Delete tenant", `Are you sure you want to delete ${t.tenant_name} (${t.tenant_id})?`);
    if (!ok) return;
    try { setSubmitting(true); await api.delete(`/tenants/${encodeURIComponent(t.tenant_id)}`); await loadAll(); notify("Deleted", "Tenant removed."); }
    catch (err: any) { notify("Delete failed", errorText(err)); }
    finally { setSubmitting(false); }
  };

  /** Small UI helpers */
  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
    </TouchableOpacity>
  );

  const Row = ({ item }: { item: Tenant }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.tenant_name} • {item.tenant_id}</Text>
        <Text style={styles.rowSub}>{item.tenant_sn} • {item.building_id} • Bill start: {item.bill_start}</Text>
        <Text style={styles.rowSub}>Status: <Text style={{ fontWeight: "700", color: item.tenant_status === "active" ? "#0b8f3a" : "#b00020" }}>{item.tenant_status.toUpperCase()}</Text></Text>
        <Text style={styles.rowSub}>Updated {formatDateTime(item.last_updated)} by {item.updated_by}</Text>
      </View>
      <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}><Text style={styles.linkText}>Update</Text></TouchableOpacity>
      <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => onDelete(item)}><Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text></TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.grid}>
      {/* Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Manage Tenants</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}><Text style={styles.btnText}>+ Create Tenant</Text></TouchableOpacity>
        </View>

        {/* Filters row */}
        <View style={styles.filtersBar}>
          {/* Search */}
          <View style={[styles.searchWrap, Platform.OS === "web" && { flex: 1.4 }]}>
            <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
            <TextInput style={styles.search} placeholder="Search by ID, SN, name, building, date, status…" placeholderTextColor="#9aa5b1" value={query} onChangeText={setQuery} />
          </View>

          {/* Building filter chips */}
          <View style={[styles.filterCol, { flex: 1 }]}>
            <Text style={styles.dropdownLabel}>Filter by Building</Text>
            <View style={styles.chipsRow}>
              {filterBuildingOptions.map((opt) => (
                <Chip key={opt.value || "all"} label={opt.label} active={buildingFilter === opt.value} onPress={() => setBuildingFilter(opt.value)} />
              ))}
            </View>
          </View>

          {/* Status chips */}
          <View style={[styles.filterCol, { flex: 1 }]}>
            <Text style={styles.dropdownLabel}>Status</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "All", val: "" },
                { label: "Active", val: "active" },
                { label: "Inactive", val: "inactive" },
              ].map(({ label, val }) => (
                <Chip key={label} label={label} active={(statusFilter as string) === val} onPress={() => setStatusFilter(val as any)} />
              ))}
            </View>
          </View>

          {/* Sort chips */}
          <View style={[styles.filterCol, { flex: 1 }]}>
            <Text style={styles.dropdownLabel}>Sort</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "ID ↑", val: "idAsc" },
                { label: "ID ↓", val: "idDesc" },
              ].map(({ label, val }) => (
                <Chip key={val} label={label} active={sortMode === (val as any)} onPress={() => setSortMode(val as any)} />
              ))}
            </View>
          </View>

        </View>

        {/* List */}
        {busy ? (
          <View style={styles.loader}><ActivityIndicator /></View>
        ) : (
          <FlatList data={sorted} keyExtractor={(item) => item.tenant_id} ListEmptyComponent={<Text style={styles.empty}>No tenants found.</Text>} renderItem={({ item }) => <Row item={item} />} />
        )}
      </View>

      {/* CREATE MODAL */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Tenant</Text>

            <Text style={styles.dropdownLabel}>Tenant SN</Text>
            <TextInput style={styles.input} placeholder="Tenant SN" value={sn} onChangeText={setSn} autoCapitalize="characters" />

            <Text style={styles.dropdownLabel}>Tenant Name</Text>
            <TextInput style={styles.input} placeholder="Tenant Name" value={name} onChangeText={setName} />

            {isAdmin ? (
              <Dropdown label="Building" value={buildingId} onChange={setBuildingId} options={createBuildingOptions} />
            ) : (
              <ReadOnlyField label="Building" value={userBuildingId || "(none)"} />
            )}

            <DatePickerField label="Bill start (YYYY-MM-DD)" value={billStart} onChange={setBillStart} />

            <Dropdown label="Status" value={createStatus} onChange={(v) => setCreateStatus(v as any)} options={[{ label: "Active", value: "active" }, { label: "Inactive", value: "inactive" }]} />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btnGhost]} onPress={() => setCreateVisible(false)}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Tenant</Text>}</TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT MODAL */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Tenant</Text>

            <Text style={styles.dropdownLabel}>Tenant SN</Text>
            <TextInput style={styles.input} value={editSn} onChangeText={setEditSn} placeholder="Tenant SN" />

            <Text style={styles.dropdownLabel}>Tenant Name</Text>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} placeholder="Tenant Name" />

            <Dropdown label="Building" value={editBuildingId} onChange={setEditBuildingId} options={buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }))} disabled={!isAdmin} />

            <DatePickerField label="Bill start" value={editBillStart} onChange={setEditBillStart} />

            <Dropdown label="Status" value={editStatus} onChange={(v) => setEditStatus(v as any)} options={[{ label: "Active", value: "active" }, { label: "Inactive (frees stalls)", value: "inactive" }]} />

            <View style={{ marginTop: 6 }}><Text style={[styles.rowSub, { fontStyle: "italic" }]}>Changing to <Text style={{ fontWeight: "700" }}>Inactive</Text> will free all stalls attached to this tenant.</Text></View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btnGhost]} onPress={() => setEditVisible(false)}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}</TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function DatePickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TextInput style={styles.input} placeholder="YYYY-MM-DD" value={value} onChangeText={onChange} autoCapitalize="characters" />
    </View>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={[styles.input, { justifyContent: "center" }]}>
        <Text style={{ color: "#0b2239", fontWeight: "600" }}>{value}</Text>
      </View>
    </View>
  );
}

function Dropdown({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; disabled?: boolean; }) {
  return (
    <View style={{ marginTop: 8, opacity: disabled ? 0.6 : 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.pickerWrapper}>
        <Picker enabled={!disabled} selectedValue={value} onValueChange={(v) => onChange(String(v))} style={styles.picker}>
          {options.length === 0 ? <Picker.Item label="No options" value="" /> : null}
          {options.map((opt) => (<Picker.Item key={opt.value} label={opt.label} value={opt.value} />))}
        </Picker>
      </View>
    </View>
  );
}

// ---------------- Styles (aligned across admin panels) ----------------
const styles = StyleSheet.create({
  grid: { flex: 1, padding: 12, gap: 12 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 12, ...(Platform.select({ web: { boxShadow: "0 8px 24px rgba(2,10,50,0.06)" as any }, default: { elevation: 1 } }) as any) },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#102a43" },

  // Filters
  filtersBar: { flexDirection: Platform.OS === "web" ? "row" : "column", gap: 12, marginBottom: 8, alignItems: "center", flexWrap: "wrap" },
  filterCol: { flex: 1 },

  // Search
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0" },
  search: { flex: 1, fontSize: 14, color: "#0b1f33" },

  // Buttons
  btn: { backgroundColor: "#0f62fe", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: { backgroundColor: "#eef2ff", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  btnGhostText: { color: "#3b5bdb", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },

  // Chips
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  chipIdle: { backgroundColor: "#f8fafc", borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#0f62fe", borderColor: "#0f62fe" },
  chipText: { fontSize: 12, fontWeight: "700" },
  chipTextIdle: { color: "#475569" },
  chipTextActive: { color: "#fff" },

  // List row
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#edf2f7" },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#102a43" },
  rowSub: { fontSize: 12, color: "#627d98", marginTop: 2 },
  link: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: "#f1f5f9" },
  linkText: { color: "#0b1f33", fontWeight: "700" },

  // Modal
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center", padding: 12 },
  modalCard: { backgroundColor: "#fff", borderRadius: 16, padding: 14, width: "100%", maxWidth: 560, ...(Platform.select({ web: { boxShadow: "0 12px 30px rgba(16,42,67,0.25)" as any }, default: { elevation: 4 } }) as any) },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#0b1f33", marginBottom: 4 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 },

  // Inputs
  dropdownLabel: { color: "#486581", fontSize: 12, marginTop: 8 },
  pickerWrapper: { backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0", overflow: "hidden" },
  picker: { height: 44 },
  input: { backgroundColor: "#f8fafc", borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, color: "#0b1f33", fontSize: 14, marginTop: 4 },

  // Misc
  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 12 },
}); 