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
const dateOf = (t: Tenant) =>
  Date.parse(t.last_updated || t.bill_start || "") || 0;

/** Tiny JWT payload decoder (no external deps) */
function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const base64 = (part || "").replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padLen);
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let str = "";
    for (let i = 0; i < padded.length; i += 4) {
      const c1 = chars.indexOf(padded[i]);
      const c2 = chars.indexOf(padded[i + 1]);
      const c3 = chars.indexOf(padded[i + 2]);
      const c4 = chars.indexOf(padded[i + 3]);
      const n = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);
      const b1 = (n >> 16) & 255,
        b2 = (n >> 8) & 255,
        b3 = n & 255;
      if (c3 === 64) str += String.fromCharCode(b1);
      else if (c4 === 64) str += String.fromCharCode(b1, b2);
      else str += String.fromCharCode(b1, b2, b3);
    }
    const json = decodeURIComponent(
      str
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** ------------ ALERT HELPERS (web + mobile) ------------ */
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
/** ------------------------------------------------------ */

/** Date field (simple, cross-platform) */
function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholder="YYYY-MM-DD"
        value={value}
        onChangeText={onChange}
        autoCapitalize="characters"
      />
    </View>
  );
}

export default function TenantsPanel({ token }: { token: string | null }) {
  const { token: ctxToken } = useAuth();
  const mergedToken = token || ctxToken || null;
  const jwt = useMemo(() => decodeJwtPayload(mergedToken), [mergedToken]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");

  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${mergedToken ?? ""}` }),
    [mergedToken],
  );
  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: authHeader,
        timeout: 15000,
      }),
    [authHeader],
  );

  // Filters & state
  const [buildingFilter, setBuildingFilter] = useState<string>("");

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  // sort chips (to match MeterPanel)
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // Create form (now shown in a modal)
  const [createVisible, setCreateVisible] = useState(false);
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
      notify("Not logged in", "Please log in to view tenants.");
      return;
    }
    try {
      setBusy(true);

      // Always fetch tenants…
      const tRes = await api.get<Tenant[]>("/tenants");
      setTenants(tRes.data || []);

      // …and only fetch buildings if admin (operators cannot access /buildings)
      let bData: Building[] = [];
      if (isAdmin) {
        const bRes = await api.get<Building[]>("/buildings");
        bData = bRes.data || [];
        setBuildings(bData);
      } else {
        setBuildings([]); // keep UI consistent; operators don't need the list
      }

      // Default building for create form
      setBuildingId((prev) => {
        if (prev) return prev;
        if (!isAdmin && userBuildingId) return userBuildingId;
        return bData?.[0]?.building_id ?? "";
      });
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally {
      setBusy(false);
    }
  };

  /** Filter then search */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tenants;

    if (buildingFilter)
      list = list.filter((t) => t.building_id === buildingFilter);

    if (!q) return list;
    return list.filter(
      (t) =>
        t.tenant_id.toLowerCase().includes(q) ||
        t.tenant_sn.toLowerCase().includes(q) ||
        t.tenant_name.toLowerCase().includes(q) ||
        t.building_id.toLowerCase().includes(q) ||
        t.bill_start.toLowerCase().includes(q),
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

  /** Create — now triggered by modal */
  const onCreate = async () => {
    const finalBuildingId = isAdmin ? buildingId : userBuildingId || buildingId;
    if (!sn || !name || !finalBuildingId || !billStart) {
      notify("Missing info", "Please fill in all fields.");
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
      const assignedId: string =
        res?.data?.tenantId ?? res?.data?.tenant_id ?? res?.data?.id ?? "";

      // reset + close modal
      setSn("");
      setName("");
      setBillStart(today());
      setCreateVisible(false);

      await loadAll();

      const msg = assignedId
        ? `Tenant created.\nID assigned: ${assignedId}`
        : "Tenant created.";
      notify("Success", msg);
    } catch (err: any) {
      notify("Create failed", errorText(err));
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
        building_id: editBuildingId,
        bill_start: editBillStart,
      });
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Tenant updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Delete */
  const onDelete = async (t: Tenant) => {
    const ok = await confirm(
      "Delete tenant",
      `Are you sure you want to delete ${t.tenant_name} (${t.tenant_id})?`,
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/tenants/${encodeURIComponent(t.tenant_id)}`);
      await loadAll();
      notify("Deleted", "Tenant removed.");
    } catch (err: any) {
      // Show server message verbatim (e.g., dependency errors)
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Building options for CREATE (lock to operator’s building) */
  const createBuildingOptions = useMemo(() => {
    if (isAdmin) {
      return buildings.map((b) => ({
        label: `${b.building_name} (${b.building_id})`,
        value: b.building_id,
      }));
    }
    const inList = buildings.find((b) => b.building_id === userBuildingId);
    const only = inList
      ? [
          {
            label: `${inList.building_name} (${inList.building_id})`,
            value: inList.building_id,
          },
        ]
      : userBuildingId
        ? [{ label: userBuildingId, value: userBuildingId }]
        : [];
    return only;
  }, [isAdmin, buildings, userBuildingId]);

  // Filter dropdown options (include operator’s building even if buildings list is empty)
  const filterBuildingOptions = useMemo(() => {
    return [
      { label: "All Buildings", value: "" },
      ...(isAdmin
        ? buildings.map((b) => ({
            label: `${b.building_name} (${b.building_id})`,
            value: b.building_id,
          }))
        : userBuildingId
          ? [{ label: userBuildingId, value: userBuildingId }]
          : []),
    ];
  }, [isAdmin, buildings, userBuildingId]);

  return (
    <View style={styles.grid}>
      {/* Manage Tenants + Create button */}
      <View style={styles.card}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <Text style={styles.cardTitle}>Manage Tenants</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => setCreateVisible(true)}
          >
            <Text style={styles.btnText}>+ Create Tenant</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search by ID, SN, name, building, date…"
          value={query}
          onChangeText={setQuery}
        />

{/* Filters bar — building chips + sort chips (like Stalls) */}
<View style={styles.filtersBar}>
  {/* Building chips */}
  <View style={styles.filterCol}>
    <Text style={styles.dropdownLabel}>Filter by Building</Text>
    <View style={styles.chipsRow}>
      {filterBuildingOptions.map((opt) => (
        <Chip
          key={opt.value || "all"}
          label={opt.label}
          active={buildingFilter === opt.value}
          onPress={() => setBuildingFilter(opt.value)}
        />
      ))}
    </View>
  </View>

  {/* Sort chips (moved here) */}
  <View style={styles.filterCol}>
    <Text style={styles.dropdownLabel}>Sort</Text>
    <View style={styles.chipsRow}>
      {[
        { label: "Newest", val: "newest" },
        { label: "Oldest", val: "oldest" },
        { label: "ID ↑", val: "idAsc" },
        { label: "ID ↓", val: "idDesc" },
      ].map(({ label, val }) => (
        <Chip
          key={val}
          label={label}
          active={sortMode === (val as any)}
          onPress={() => setSortMode(val as any)}
        />
      ))}
    </View>
  </View>

  {(!!buildingFilter) && (
    <TouchableOpacity
      style={styles.clearBtn}
      onPress={() => {
        setBuildingFilter("");
        // sort reset optional — leaving as-is to match your logic
      }}
    >
      <Text style={styles.clearBtnText}>Clear</Text>
    </TouchableOpacity>
  )}
</View>x
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.tenant_id}
            scrollEnabled={Platform.OS === "web"}
            nestedScrollEnabled={false}
            ListEmptyComponent={
              <Text style={styles.empty}>No tenants found.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.tenant_name} • {item.tenant_id}
                  </Text>
                  <Text style={styles.rowSub}>
                    {item.tenant_sn} • {item.building_id} • Bill start:{" "}
                    {item.bill_start}
                  </Text>
                  <Text style={styles.rowSub}>
                    Updated {formatDateTime(item.last_updated)} by{" "}
                    {item.updated_by}
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
            )}
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
            <Text style={styles.modalTitle}>Create Tenant</Text>

            <Text style={styles.dropdownLabel}>Tenant SN</Text>
            <TextInput
              style={styles.input}
              placeholder="Tenant SN"
              value={sn}
              onChangeText={setSn}
              autoCapitalize="characters"
            />

            <Text style={styles.dropdownLabel}>Tenant Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Tenant Name"
              value={name}
              onChangeText={setName}
            />

            {isAdmin ? (
              <Dropdown
                label="Building"
                value={buildingId}
                onChange={setBuildingId}
                options={createBuildingOptions}
              />
            ) : (
              <ReadOnlyField label="Building" value={userBuildingId || "(none)"} />
            )}

            <DatePickerField
              label="Bill start (YYYY-MM-DD)"
              value={billStart}
              onChange={setBillStart}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setCreateVisible(false)}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={onCreate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnText}>Create Tenant</Text>
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
            <Text style={styles.modalTitle}>Edit Tenant</Text>

            <Text style={styles.dropdownLabel}>Tenant SN</Text>
            <TextInput
              style={styles.input}
              value={editSn}
              onChangeText={setEditSn}
              placeholder="Tenant SN"
            />

            <Text style={styles.dropdownLabel}>Tenant Name</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Tenant Name"
            />

            <Dropdown
              label="Building"
              value={editBuildingId}
              onChange={setEditBuildingId}
              options={buildings.map((b) => ({
                label: `${b.building_name} (${b.building_id})`,
                value: b.building_id,
              }))}
              disabled={!isAdmin}
            />

            <DatePickerField
              label="Bill start"
              value={editBillStart}
              onChange={setEditBillStart}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setEditVisible(false)}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={onUpdate}
                disabled={submitting}
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
    <View className="picker" style={styles.pickerWrapper}>
      <Picker
        enabled={!disabled}
        selectedValue={value}
        onValueChange={(v) => onChange(String(v))}
        style={styles.picker}
      >
        {options.length === 0 ? (
          <Picker.Item label="No options" value="" />
        ) : null}
        {options.map((opt) => (
          <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
        ))}
      </Picker>
    </View>
  </View>
);

const Chip = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}
  >
    <Text style={[styles.chipText, active && styles.chipTextActive]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// ---------- Styles (consistent with your admin panels) ----------
const styles = StyleSheet.create({
  grid: { gap: 16 },
  card: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    ...Platform.select({
      web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any },
      default: { elevation: 1 },
    }),
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43",
    marginBottom: 12,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  picker: { height: 50 },
  dropdownLabel: {
    color: "#334e68",
    marginBottom: 6,
    marginTop: 6,
    fontWeight: "600",
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
    minWidth: 160,
  },
  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  btn: {
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    paddingHorizontal: 14,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  btnGhostText: { color: "#102a43", fontWeight: "700" },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
    alignItems: "flex-end",
  },
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

  listRow: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
    ...Platform.select({
      web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any },
      default: { elevation: 1 },
    }),
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowTitle: { fontWeight: "700", color: "#102a43" },
  rowSub: { color: "#627d98" },
  link: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#eef2ff",
  },
  linkText: { color: "#1f4bd8", fontWeight: "700" },

  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },

  // Modal visuals
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: {
    fontWeight: "700",
    fontSize: 18,
    color: "#102a43",
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },

  clearBtn: {
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#d6e0ff",
    ...Platform.select({
      web: { boxShadow: "0 1px 4px rgba(31,75,216,0.08)" as any },
    }),
  },
  clearBtnText: {
    color: "#1f4bd8",
    fontWeight: "700",
  },
  filtersBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#f7f9ff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6efff",
  },
  filterCol: { flex: 1, minWidth: 220 },
  chipsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (!isNaN(d.getTime()))
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return iso || "";
}