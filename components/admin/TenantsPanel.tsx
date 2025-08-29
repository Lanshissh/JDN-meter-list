// components/admin/TenantsPanel.tsx
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
import { useAuth } from "../../contexts/AuthContext";

/** Types */
type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  bill_start: string; // YYYY-MM-DD
  last_updated: string; // ISO
  updated_by: string;
};

type Building = {
  building_id: string;
  building_name: string;
};

/** Natural compare helper (so ID 2 < 10) */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

/** Pick a sortable date (prefer last_updated, fallback to bill_start) */
const dateOf = (t: Tenant) => Date.parse(t.last_updated || t.bill_start || "") || 0;

/** Tiny JWT payload decoder (no external deps) */
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
    const json = decodeURIComponent(str.split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Panel */
export default function TenantsPanel({ token }: { token: string | null }) {
  const { token: ctxToken } = useAuth();
  const mergedToken = token || ctxToken || null;
  const jwt = useMemo(() => decodeJwtPayload(mergedToken), [mergedToken]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${mergedToken ?? ""}` }), [mergedToken]);
  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: authHeader,
        timeout: 15000,
      }),
    [authHeader]
  );

  const [buildingFilter, setBuildingFilter] = useState<string>("");

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  // sort mode chips
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // Create form (🔒 building locked for non-admins)
  const [sn, setSn] = useState("");
  const [name, setName] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [billStart, setBillStart] = useState(today());

  // Edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Tenant | null>(null);
  const [editSn, setEditSn] = useState("");
  const [editName, setEditName] = useState("");
  const [editBuildingId, setEditBuildingId] = useState("");
  const [editBillStart, setEditBillStart] = useState(today());

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedToken]);

  const loadAll = async () => {
    if (!mergedToken) {
      setBusy(false);
      Alert.alert("Not logged in", "Please log in to view tenants.");
      return;
    }
    try {
      setBusy(true);
      const [tRes, bRes] = await Promise.all([api.get<Tenant[]>("/tenants"), api.get<Building[]>("/buildings")]);
      setTenants(tRes.data || []);
      setBuildings(bRes.data || []);

      // Default building for create form:
      setBuildingId((prev) => {
        if (prev) return prev;
        if (!isAdmin && userBuildingId) return userBuildingId;
        return bRes.data?.[0]?.building_id ?? "";
      });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || "Connection error.";
      Alert.alert("Load failed", msg);
    } finally {
      setBusy(false);
    }
  };

  /** Filter then search */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tenants;

    if (buildingFilter) list = list.filter((t) => t.building_id === buildingFilter);

    if (!q) return list;
    return list.filter(
      (t) =>
        t.tenant_id.toLowerCase().includes(q) ||
        t.tenant_sn.toLowerCase().includes(q) ||
        t.tenant_name.toLowerCase().includes(q) ||
        t.building_id.toLowerCase().includes(q) ||
        t.bill_start.toLowerCase().includes(q)
    );
  }, [tenants, query, buildingFilter]);

  /** Sort (chips) */
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "newest":
        return arr.sort((a, b) => dateOf(b) - dateOf(a));
      case "oldest":
        return arr.sort((a, b) => dateOf(a) - dateOf(b));
      case "idAsc":
        return arr.sort((a, b) => cmp(a.tenant_id, b.tenant_id));
      case "idDesc":
        return arr.sort((a, b) => cmp(b.tenant_id, a.tenant_id));
      default:
        return arr;
    }
  }, [filtered, sortMode]);

  /** Create */
  const onCreate = async () => {
    const finalBuildingId = isAdmin ? buildingId : (userBuildingId || buildingId);
    if (!sn || !name || !finalBuildingId || !billStart) {
      Alert.alert("Missing info", "Please fill in all fields.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.post("/tenants", {
        tenant_sn: sn,
        tenant_name: name,
        building_id: finalBuildingId, // 🔒 forces operator’s building
        bill_start: billStart,
      });
      const assignedId: string =
        res?.data?.tenantId ?? res?.data?.tenant_id ?? res?.data?.id ?? "";

      setSn("");
      setName("");
      // keep building selection as-is; reset date for convenience
      setBillStart(today());
      await loadAll();

      Alert.alert("Success", assignedId ? `Tenant created.\nID assigned: ${assignedId}` : "Tenant created.");
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Server error.";
      Alert.alert("Create failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Edit */
  const openEdit = (row: Tenant) => {
    setEditRow(row);
    setEditSn(row.tenant_sn);
    setEditName(row.tenant_name);
    setEditBuildingId(row.building_id);
    setEditBillStart(row.bill_start);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editRow) return;
    try {
      setSubmitting(true);
      await api.put(`/tenants/${encodeURIComponent(editRow.tenant_id)}`, {
        tenant_sn: editSn,
        tenant_name: editName,
        building_id: editBuildingId, // server blocks operators from moving buildings; UI also locks it
        bill_start: editBillStart,
      });
      setEditVisible(false);
      await loadAll();
      Alert.alert("Updated", "Tenant updated successfully.");
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Server error.";
      Alert.alert("Update failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Delete */
  const confirmDelete = (t: Tenant) =>
    Platform.OS === "web"
      ? Promise.resolve(window.confirm(`Delete tenant ${t.tenant_name} (${t.tenant_id})?`))
      : new Promise((resolve) => {
          Alert.alert("Delete tenant", `Are you sure you want to delete ${t.tenant_name}?`, [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Delete", style: "destructive", onPress: () => resolve(true) },
          ]);
        });

  const onDelete = async (t: Tenant) => {
    const ok = await confirmDelete(t);
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(`/tenants/${encodeURIComponent(t.tenant_id)}`);
      await loadAll();
      if (Platform.OS !== "web") Alert.alert("Deleted", "Tenant removed.");
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Server error.";
      Alert.alert("Delete failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Building options for CREATE (lock to operator’s building) */
  const createBuildingOptions = useMemo(() => {
    if (isAdmin) {
      return buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }));
    }
    // Non-admin: show only their assigned building (fallback if not in list yet)
    const inList = buildings.find((b) => b.building_id === userBuildingId);
    const only = inList
      ? [{ label: `${inList.building_name} (${inList.building_id})`, value: inList.building_id }]
      : userBuildingId
      ? [{ label: userBuildingId, value: userBuildingId }]
      : [];
    return only;
  }, [isAdmin, buildings, userBuildingId]);

  /** Render */
  return (
    <View style={styles.grid}>
      {/* Create Tenant */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create Tenant</Text>
        <View style={styles.rowWrap}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Tenant SN"
            value={sn}
            onChangeText={setSn}
            autoCapitalize="characters"
          />
          <TextInput style={[styles.input, { flex: 2 }]} placeholder="Tenant Name" value={name} onChangeText={setName} />
        </View>

        <View style={styles.rowWrap}>
          <Dropdown
            label="Building"
            value={buildingId}
            onChange={setBuildingId}
            options={createBuildingOptions}
            disabled={!isAdmin} // 🔒 lock for non-admins
          />
          <DatePickerField label="Bill start (YYYY-MM-DD)" value={billStart} onChange={setBillStart} />
        </View>

        <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Tenant</Text>}
        </TouchableOpacity>
      </View>

      {/* Filters */}
      <View style={styles.rowWrap}>
        <Dropdown
          label="Filter by Building"
          value={buildingFilter}
          onChange={setBuildingFilter}
          options={[
            { label: "All Buildings", value: "" },
            ...buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id })),
          ]}
        />
        {!!buildingFilter && (
          <TouchableOpacity style={[styles.link, { height: 50, justifyContent: "center" }]} onPress={() => setBuildingFilter("")}>
            <Text style={styles.linkText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Manage Tenants */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Manage Tenants</Text>
        <TextInput
          style={styles.search}
          placeholder="Search by ID, SN, name, building, date…"
          value={query}
          onChangeText={setQuery}
        />

        {/* Sort chips */}
        <View style={styles.chipsRow}>
          <Chip label="Newest" active={sortMode === "newest"} onPress={() => setSortMode("newest")} />
          <Chip label="Oldest" active={sortMode === "oldest"} onPress={() => setSortMode("oldest")} />
          <Chip label="ID ↑" active={sortMode === "idAsc"} onPress={() => setSortMode("idAsc")} />
          <Chip label="ID ↓" active={sortMode === "idDesc"} onPress={() => setSortMode("idDesc")} />
        </View>

        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.tenant_id}
            // ✅ prevent nested scroll on mobile; keep virtualization on web
            scrollEnabled={Platform.OS === "web"}
            nestedScrollEnabled={false}
            ListEmptyComponent={<Text style={styles.empty}>No tenants found.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.tenant_name}</Text>
                  <Text style={styles.rowSub}>
                    {item.tenant_id} • SN: {item.tenant_sn} • {item.building_id}
                  </Text>
                  <Text style={styles.rowSub}>Bill start: {item.bill_start}</Text>
                </View>
                <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
                  <Text style={styles.linkText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => onDelete(item)}>
                  <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit {editRow?.tenant_id}</Text>

            <LabeledInput
              label="Tenant SN"
              value={editSn}
              onChangeText={setEditSn}
              placeholder="e.g., TNT-000123"
              autoCapitalize="characters"
            />

            <LabeledInput label="Tenant Name" value={editName} onChangeText={setEditName} placeholder="e.g., Sample Store" />

            <Dropdown
              label="Building"
              value={editBuildingId}
              onChange={setEditBuildingId}
              options={buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }))}
              disabled={!isAdmin} // 🔒 operators cannot move tenant to another building
            />

            <DatePickerField label="Bill start (YYYY-MM-DD)" value={editBillStart} onChange={setEditBillStart} />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                <Text style={[styles.btnText, { color: "#102a43" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={onUpdate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Tiny chip component */
function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Shared UI bits **/
function Dropdown({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  disabled?: boolean;
}) {
  const onValueChange = disabled ? () => {} : (val: any) => onChange(String(val));
  return (
    <View style={{ marginTop: 8, flex: 1, opacity: disabled ? 0.6 : 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.pickerWrapper} pointerEvents={disabled ? "none" : "auto"}>
        <Picker selectedValue={value} onValueChange={onValueChange} style={styles.picker} enabled={Platform.OS === "android" ? !disabled : true}>
          {options.map((opt) => (
            <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

/** Simple date utilities + picker (local, no external deps) **/
function today() {
  return new Date().toISOString().slice(0, 10);
}
function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function parseYMD(ymd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function DatePickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={{ flex: 1, marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TouchableOpacity style={[styles.input, styles.dateButton]} onPress={() => setVisible(true)}>
        <Text style={styles.dateButtonText}>{value || today()}</Text>
      </TouchableOpacity>
      <DatePickerModal
        visible={visible}
        initialDate={value || today()}
        onClose={() => setVisible(false)}
        onConfirm={(v) => {
          onChange(v);
          setVisible(false);
        }}
      />
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={{ width: "100%", marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TextInput style={[styles.input, { width: "100%" }]} value={value} onChangeText={onChangeText} placeholder={placeholder} autoCapitalize={autoCapitalize} />
    </View>
  );
}

function DatePickerModal({
  visible,
  initialDate,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  initialDate: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const now = new Date();
  const init = parseYMD(initialDate);
  const [y, setY] = useState(init.y);
  const [m, setM] = useState(init.m);
  const [d, setD] = useState(init.d);

  useEffect(() => {
    const max = daysInMonth(y, m);
    if (d > max) setD(max);
  }, [y, m]); // eslint-disable-line react-hooks/exhaustive-deps

  const years = useMemo(() => {
    const cy = now.getFullYear();
    const arr: number[] = [];
    for (let i = cy - 20; i <= cy + 5; i++) arr.push(i);
    return arr;
  }, []);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days = useMemo(() => Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1), [y, m]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.dateModalCard}>
          <Text style={styles.modalTitle}>Select date</Text>
          <View style={styles.datePickersRow}>
            <View style={styles.datePickerCol}>
              <Text style={styles.dropdownLabel}>Year</Text>
              <View style={styles.pickerWrapper}>
                <Picker selectedValue={y} onValueChange={(val) => setY(Number(val))} style={styles.picker}>
                  {years.map((yy) => (
                    <Picker.Item key={yy} label={String(yy)} value={yy} />
                  ))}
                </Picker>
              </View>
            </View>
            <View style={styles.datePickerCol}>
              <Text style={styles.dropdownLabel}>Month</Text>
              <View style={styles.pickerWrapper}>
                <Picker selectedValue={m} onValueChange={(val) => setM(Number(val))} style={styles.picker}>
                  {months.map((mm) => (
                    <Picker.Item key={mm} label={pad(mm)} value={mm} />
                  ))}
                </Picker>
              </View>
            </View>
            <View style={styles.datePickerCol}>
              <Text style={styles.dropdownLabel}>Day</Text>
              <View style={styles.pickerWrapper}>
                <Picker selectedValue={d} onValueChange={(val) => setD(Number(val))} style={styles.picker}>
                  {days.map((dd) => (
                    <Picker.Item key={dd} label={pad(dd)} value={dd} />
                  ))}
                </Picker>
              </View>
            </View>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
              <Text style={[styles.btnText, { color: "#102a43" }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={() => onConfirm(`${y}-${pad(m)}-${pad(d)}`)}>
              <Text style={styles.btnText}>Set date</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Styles — mirrors your existing admin panels */
const styles = StyleSheet.create({
  grid: { gap: 16 },
  card: {
    backgroundColor: "#fff",
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
  rowWrap: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: "#102a43",
    marginTop: 6,
    minHeight: 50,
  },

  dateButton: { justifyContent: "center" },
  dateButtonText: { color: "#102a43" },

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

  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },

  chipsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
  },
  chipActive: { backgroundColor: "#1f4bd8", borderColor: "#1f4bd8" },
  chipText: { color: "#102a43", fontWeight: "700" },
  chipTextActive: { color: "#fff" },

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
  modalTitle: { fontWeight: "800", fontSize: 18, color: "#102a43", marginBottom: 10 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },

  dropdownLabel: { color: "#334e68ff", fontWeight: "600", marginBottom: 6, marginTop: 6 },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    backgroundColor: "#fff",
    height: 50,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  picker: { width: "100%", height: 50 },

  dateModalCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "100%",
    maxWidth: 480,
  },
  datePickersRow: { flexDirection: "row", gap: 12 },
  datePickerCol: { flex: 1 },
});