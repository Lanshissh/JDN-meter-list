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

/** Types from your API */
type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  bill_start: string;   // YYYY-MM-DD
  last_updated: string; // ISO
  updated_by: string;
};

type Building = {
  building_id: string;
  building_name: string;
};

/** Helpers */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
const dateOf = (t: Tenant) => Date.parse(t.last_updated || t.bill_start || "") || 0;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

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
    const json = decodeURIComponent(
      str
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function TenantsPanel({
  token,
  readOnly = false,
}: {
  token: string | null;
  readOnly?: boolean;
}) {
  const { token: ctxToken } = useAuth();
  const mergedToken = token || ctxToken || null;

  const jwt = useMemo(() => decodeJwtPayload(mergedToken), [mergedToken]);
  const role = String(jwt?.user_level || "").toLowerCase();
  const isAdmin = role === "admin";
  const isOperator = role === "operator";
  const userBuildingId = String(jwt?.building_id || "");

  // 👉 Operator now has full CRUD; Biller/Reader are read-only
  const canCreate = isAdmin || isOperator;
  const canEdit = isAdmin || isOperator;
  const canDelete = isAdmin || isOperator;
  const READ_ONLY = readOnly || !(canCreate || canEdit || canDelete);

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${mergedToken ?? ""}` }), [mergedToken]);
  const api = useMemo(
    () => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }),
    [authHeader]
  );

  // Data state
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // Searching / filtering / sorting
  const [query, setQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // Create form
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

      // Always fetch tenants; only admins fetch buildings. Operators don't need building options (locked to own).
      const reqs: Promise<any>[] = [api.get<Tenant[]>("/tenants")];
      if (isAdmin) reqs.push(api.get<Building[]>("/buildings"));

      const [tRes, bRes] = (await Promise.all(reqs)) as [any, any?];

      setTenants(tRes?.data || []);

      if (isAdmin && bRes) {
        setBuildings(bRes.data || []);
        setBuildingId((prev) => prev || bRes.data?.[0]?.building_id || "");
      } else {
        // lock to operator's building (and other non-admins)
        setBuildingId((prev) => prev || userBuildingId || "");
      }
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
    if (!canCreate) return;

    // admin chooses building; operator is forced to own building
    const finalBuildingId = isAdmin ? buildingId : userBuildingId;

    if (!sn || !name || !finalBuildingId || !billStart) {
      Alert.alert("Missing info", "Please fill in all fields.");
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.post("/tenants", {
        tenant_sn: sn,
        tenant_name: name,
        building_id: finalBuildingId,
        bill_start: billStart,
      });
      const assignedId = res?.data?.tenantId;
      setSn("");
      setName("");
      setBillStart(today());
      await loadAll();

      Alert.alert("Success", assignedId ? `Tenant created.\nID: ${assignedId}` : "Tenant created.");
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? "Server error.";
      Alert.alert("Create failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Edit */
  const openEdit = (row: Tenant) => {
    if (!canEdit) return;
    setEditRow(row);
    setEditSn(row.tenant_sn);
    setEditName(row.tenant_name);
    setEditBuildingId(row.building_id);
    setEditBillStart(row.bill_start);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!canEdit || !editRow) return;
    try {
      setSubmitting(true);
      const finalBuildingId = isAdmin ? editBuildingId : userBuildingId; // operator locked to own building
      await api.put(`/tenants/${encodeURIComponent(editRow.tenant_id)}`, {
        tenant_sn: editSn,
        tenant_name: editName,
        building_id: finalBuildingId,
        bill_start: editBillStart,
      });
      setEditVisible(false);
      await loadAll();
      Alert.alert("Updated", "Tenant updated successfully.");
    } catch (err: any) {
      Alert.alert("Update failed", err?.response?.data?.error ?? "Server error.");
    } finally {
      setSubmitting(false);
    }
  };

  /** Delete */
  const onDelete = async (t: Tenant) => {
    if (!canDelete) return;
    const ok =
      Platform.OS === "web"
        ? window.confirm(`Delete tenant ${t.tenant_name} (${t.tenant_id})?`)
        : await new Promise<boolean>((resolve) =>
            Alert.alert("Delete tenant", `Delete ${t.tenant_name}?`, [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Delete", style: "destructive", onPress: () => resolve(true) },
            ])
          );
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(`/tenants/${encodeURIComponent(t.tenant_id)}`);
      await loadAll();
      if (Platform.OS !== "web") Alert.alert("Deleted", "Tenant removed.");
    } catch (err: any) {
      Alert.alert("Delete failed", err?.response?.data?.error ?? "Server error.");
    } finally {
      setSubmitting(false);
    }
  };

  /** Building dropdown options (admin only) */
  const buildingOptions = buildings.map((b) => ({
    label: `${b.building_name} (${b.building_id})`,
    value: b.building_id,
  }));

  if (busy) {
    return (
      <View style={{ padding: 16 }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {/* Scope hint */}
      {!isAdmin && (
        <Text style={{ color: "#6b7c93", marginLeft: 4 }}>
          Building scope:{" "}
          <Text style={{ color: "#0b2239", fontWeight: "700" }}>{userBuildingId || "(none)"}</Text>
        </Text>
      )}

      {/* Create Form */}
      {canCreate && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Create Tenant</Text>

          <View style={styles.rowWrap}>
            <LabeledInput
              label="Tenant SN"
              value={sn}
              onChangeText={setSn}
              placeholder="e.g., TNT-000123"
              autoCapitalize="characters"
            />
            <LabeledInput
              label="Tenant Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g., Sample Store"
            />
          </View>

          <View style={styles.rowWrap}>
            {isAdmin ? (
              <Dropdown
                label="Building"
                value={buildingId}
                onChange={setBuildingId}
                options={buildingOptions}
                placeholder="Select building..."
              />
            ) : (
              <LabeledReadOnly label="Building" value={userBuildingId || "(none)"} />
            )}
            <DatePickerField label="Bill start (YYYY-MM-DD)" value={billStart} onChange={setBillStart} />
          </View>

          <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Tenant</Text>}
          </TouchableOpacity>
        </View>
      )}

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
          placeholder="All Buildings"
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.dropdownLabel}>Search</Text>
          <TextInput
            style={styles.input}
            placeholder="Search by ID, SN, name, building, or date…"
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </View>

      {/* Sort chips */}
      <View style={styles.chipsRow}>
        {(["newest", "oldest", "idAsc", "idDesc"] as SortMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.chip, sortMode === m && styles.chipActive]}
            onPress={() => setSortMode(m)}
          >
            <Text style={[styles.chipText, sortMode === m && styles.chipTextActive]}>
              {m === "newest" && "Newest"}
              {m === "oldest" && "Oldest"}
              {m === "idAsc" && "ID ↑"}
              {m === "idDesc" && "ID ↓"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tenants</Text>
        <FlatList
          data={sorted}
          keyExtractor={(t) => t.tenant_id}
          renderItem={({ item }) => (
            <View style={styles.rowLine}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.tenant_name}</Text>
                <Text style={styles.rowMeta}>
                  {item.tenant_id} • {item.tenant_sn} • {item.building_id}
                </Text>
              </View>

              {(canEdit || canDelete) && (
                <View style={{ flexDirection: "row" }}>
                  {canEdit && (
                    <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
                      <Text style={styles.linkText}>Edit</Text>
                    </TouchableOpacity>
                  )}
                  {canDelete && (
                    <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => onDelete(item)}>
                      <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={<Text style={{ padding: 12, color: "#555" }}>No tenants found.</Text>}
        />
      </View>

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
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

            <LabeledInput
              label="Tenant Name"
              value={editName}
              onChangeText={setEditName}
              placeholder="e.g., Sample Store"
            />

            {isAdmin ? (
              <Dropdown
                label="Building"
                value={editBuildingId}
                onChange={setEditBuildingId}
                options={buildingOptions}
                placeholder="Select building..."
              />
            ) : (
              <LabeledReadOnly label="Building" value={userBuildingId || "(none)"} />
            )}

            <DatePickerField label="Bill start (YYYY-MM-DD)" value={editBillStart} onChange={setEditBillStart} />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                <Text style={[styles.btnText, { color: "#102a43" }]}>Cancel</Text>
              </TouchableOpacity>
              {canEdit && (
                <TouchableOpacity style={styles.btn} onPress={onUpdate} disabled={submitting}>
                  <Text style={styles.btnText}>Save</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Reusable inputs */
function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

function LabeledReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={[styles.input, { justifyContent: "center" }]}>
        <Text style={{ color: "#0b2239", fontWeight: "600" }}>{value}</Text>
      </View>
    </View>
  );
}

function Dropdown({
  label,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const showPlaceholder = placeholder && !value && options.every((o) => o.value !== "");
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.pickerWrapper}>
        <Picker
          enabled={!disabled}
          selectedValue={value}
          onValueChange={(v) => onChange(String(v))}
          style={styles.picker}
        >
          {showPlaceholder && <Picker.Item label={placeholder!} value="" />}
          {options.map((o) => (
            <Picker.Item key={o.value || o.label} label={o.label} value={o.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
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

function DatePickerModal({
  visible,
  initialDate,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  initialDate: string;
  onClose: () => void;
  onConfirm: (v: string) => void;
}) {
  const [y, setY] = useState<number>(() => {
    const d = new Date(initialDate || today());
    return d.getFullYear();
  });
  const [m, setM] = useState<number>(() => {
    const d = new Date(initialDate || today());
    return d.getMonth() + 1;
  });
  const [d, setD] = useState<number>(() => {
    const dd = new Date(initialDate || today());
    return dd.getDate();
  });

  const years = Array.from({ length: 30 }, (_, i) => new Date().getFullYear() - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalWrap}>
        <View style={styles.dateModalCard}>
          <Text style={styles.modalTitle}>Pick a date</Text>
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

/** Styles */
const styles = StyleSheet.create({
  grid: { gap: 16, padding: 8 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    ...(Platform.select({
      web: { boxShadow: "0 2px 14px rgba(0,0,0,.06)" as any },
      default: { elevation: 2 },
    }) as any),
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#102a43", marginBottom: 8 },

  rowWrap: { flexDirection: "row", gap: 8 },

  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: Platform.select({ web: 8, default: 10 }),
    width: "100%",
  },

  dropdownLabel: { fontSize: 12, fontWeight: "700", color: "#4b5563", marginBottom: 6, marginLeft: 2 },

  chipsRow: { flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "#f1f5f9" },
  chipActive: { backgroundColor: "#102a43" },
  chipText: { color: "#102a43", fontWeight: "700" },
  chipTextActive: { color: "#fff" },

  rowLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  rowTitle: { fontWeight: "700", color: "#0b2239" },
  rowMeta: { color: "#6b7c93" },

  link: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: "#eef2ff" },
  linkText: { color: "#102a43", fontWeight: "700" },

  pickerWrapper: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  picker: { width: "100%", height: 50 },

  dateButton: { justifyContent: "center", height: 50 },
  dateButtonText: { color: "#0b2239", fontWeight: "600" },

  /* Modal styles */
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    ...(Platform.select({
      web: { boxShadow: "0 2px 14px rgba(0,0,0,.12)" as any },
      default: { elevation: 3 },
    }) as any),
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#102a43", marginBottom: 10 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },

  dateModalCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "100%",
    maxWidth: 480,
  },
  datePickersRow: { flexDirection: "row", gap: 12 },
  datePickerCol: { flex: 1 },

  btn: { backgroundColor: "#102a43", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignSelf: "flex-start" },
  btnGhost: { backgroundColor: "#f1f5f9" },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "700" },
});