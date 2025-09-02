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
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";

type Stall = {
  stall_id: string;
  stall_sn: string;
  tenant_id: string | null;
  building_id: string;
  stall_status: "occupied" | "available" | "under maintenance";
  last_updated: string;
  updated_by: string;
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

const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const dateOf = (s: Stall) => Date.parse(s.last_updated || "") || 0;

/** Safe JWT payload decode (no deps) */
function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const base64 = (part || "").replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(padLen);
    // atob polyfill
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    let str = "";
    let i = 0;
    for (; i < padded.length; i += 4) {
      const c1 = chars.indexOf(padded[i]);
      const c2 = chars.indexOf(padded[i + 1]);
      const c3 = chars.indexOf(padded[i + 2]);
      const c4 = chars.indexOf(padded[i + 3]);
      const n = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);
      const b1 = (n >> 16) & 255;
      const b2 = (n >> 8) & 255;
      const b3 = n & 255;
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
/** ------------------------------------------------------ */

export default function StallsPanel({ token }: { token: string | null }) {
  const { token: ctxToken } = useAuth();
  const mergedToken = token || ctxToken || null;

  const jwt = useMemo(() => decodeJwtPayload(mergedToken), [mergedToken]);
  const role = String(jwt?.user_level || "").toLowerCase();
  const isAdmin = role === "admin";
  const isOperator = role === "operator";
  const userBuildingId = String(jwt?.building_id || "");

  // Operators now have full CRUD
  const canCreate = isAdmin || isOperator;
  const canEdit = isAdmin || isOperator;
  const canDelete = isAdmin || isOperator;

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [stalls, setStalls] = useState<Stall[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [query, setQuery] = useState("");

  // list filters
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"" | Stall["stall_status"]>(
    "",
  );

  // --- create form (now in a modal) ---
  const [createVisible, setCreateVisible] = useState(false);
  const [stallSn, setStallSn] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState<Stall["stall_status"]>("available");

  // edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editStall, setEditStall] = useState<Stall | null>(null);

  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

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

  const loadAll = async () => {
    if (!mergedToken) {
      setBusy(false);
      notify("Not logged in", "Please log in to manage stalls.");
      return;
    }
    try {
      setBusy(true);

      // Always get stalls + tenants; only admins fetch /buildings (some backends keep this admin-only)
      const reqs: Promise<any>[] = [
        api.get<Stall[]>("/stalls"),
        api.get<Tenant[]>("/tenants"),
      ];
      if (isAdmin) reqs.push(api.get<Building[]>("/buildings"));

      const [stallsRes, tenantsRes, buildingsRes] = (await Promise.all(
        reqs,
      )) as [any, any, any?];

      setStalls(stallsRes?.data || []);
      setTenants(tenantsRes?.data || []);

      if (isAdmin && buildingsRes) {
        setBuildings(buildingsRes.data || []);
        if (!buildingId && buildingsRes.data?.length) {
          setBuildingId(buildingsRes.data[0].building_id);
        }
      } else {
        // lock building to operator's own building (and other non-admins)
        setBuildingId((prev) => prev || userBuildingId || "");
      }
    } catch (err: any) {
      console.error("[STALLS LOAD]", err?.response?.data || err?.message);
      notify("Load failed", errorText(err, "Connection error."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedToken]);

  // tenant lists filtered by building
  const tenantsForCreate = useMemo(
    () => tenants.filter((t) => !buildingId || t.building_id === buildingId),
    [tenants, buildingId],
  );
  const tenantsForEdit = useMemo(() => {
    if (!editStall) return [];
    return tenants.filter((t) => t.building_id === editStall.building_id);
  }, [tenants, editStall]);

  // list filtering + sorting
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = stalls;

    if (buildingFilter)
      list = list.filter((s) => s.building_id === buildingFilter);
    if (statusFilter)
      list = list.filter((s) => s.stall_status === statusFilter);

    if (!q) return list;
    return list.filter(
      (s) =>
        s.stall_id.toLowerCase().includes(q) ||
        s.stall_sn.toLowerCase().includes(q) ||
        s.building_id.toLowerCase().includes(q) ||
        (s.tenant_id?.toLowerCase() ?? "").includes(q) ||
        s.stall_status.toLowerCase().includes(q),
    );
  }, [stalls, query, buildingFilter, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "newest":
        return arr.sort((a, b) => dateOf(b) - dateOf(a));
      case "oldest":
        return arr.sort((a, b) => dateOf(a) - dateOf(b));
      case "idAsc":
        return arr.sort((a, b) => cmp(a.stall_id, b.stall_id));
      case "idDesc":
        return arr.sort((a, b) => cmp(b.stall_id, a.stall_id));
      default:
        return arr;
    }
  }, [filtered, sortMode]);

  // --- Create ---
  const onCreate = async () => {
    if (!canCreate) return;
    // admin chooses building; operator is locked to own building
    const finalBuildingId = isAdmin ? buildingId : userBuildingId;

    if (!stallSn || !finalBuildingId || !status) {
      notify("Missing info", "Please fill in Stall SN, Building, and Status.");
      return;
    }
    try {
      setSubmitting(true);
      await api.post("/stalls", {
        stall_sn: stallSn,
        tenant_id: status === "available" ? null : tenantId || null,
        building_id: finalBuildingId,
        stall_status: status,
      });
      // reset + close
      setStallSn("");
      setTenantId("");
      setStatus("available");
      setCreateVisible(false);

      await loadAll();
      notify("Success", "Stall created.");
    } catch (err: any) {
      console.error("[CREATE STALL]", err?.response?.data || err?.message);
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // --- Edit modal ---
  const openEdit = (stall: Stall) => {
    if (!canEdit) return;
    setEditStall({ ...stall });
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!canEdit || !editStall) return;
    try {
      setSubmitting(true);
      const finalBuildingId = isAdmin ? editStall.building_id : userBuildingId; // operator locked to own building
      await api.put(`/stalls/${encodeURIComponent(editStall.stall_id)}`, {
        stall_sn: editStall.stall_sn,
        tenant_id:
          editStall.stall_status === "available"
            ? null
            : editStall.tenant_id || null,
        building_id: finalBuildingId,
        stall_status: editStall.stall_status,
      });
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Stall updated successfully.");
    } catch (err: any) {
      console.error("[UPDATE STALL]", err?.response?.data || err?.message);
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (stall: Stall) => {
    if (!canDelete) return;
    const ok = await confirm(
      "Delete stall",
      `Are you sure you want to delete ${stall.stall_sn} (${stall.stall_id})?`,
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/stalls/${encodeURIComponent(stall.stall_id)}`);
      await loadAll();
      notify("Deleted", "Stall removed.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.grid}>
      {/* LIST & FILTERS + Create button */}
      <View style={styles.card}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <Text style={styles.cardTitle}>Manage Stalls</Text>
          {canCreate && (
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setCreateVisible(true)}
            >
              <Text style={styles.btnText}>+ Create Stall</Text>
            </TouchableOpacity>
          )}
        </View>

        <TextInput
          style={styles.search}
          placeholder="Search by ID, SN, tenant, building, status…"
          value={query}
          onChangeText={setQuery}
        />

        <View style={styles.filtersBar}>
          <View className="filter-building" style={styles.filterCol}>
            <Dropdown
              label="Filter by Building"
              value={buildingFilter}
              onChange={setBuildingFilter}
              options={[
                { label: "All Buildings", value: "" },
                ...buildings.map((b) => ({
                  label: `${b.building_name} (${b.building_id})`,
                  value: b.building_id,
                })),
                // Optional: show operator's building if buildings list is empty
                ...(buildings.length === 0 && userBuildingId
                  ? [{ label: userBuildingId, value: userBuildingId }]
                  : []),
              ]}
            />
          </View>

          <View className="filter-status" style={styles.filterCol}>
            <Dropdown
              label="Filter by Status"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as any)}
              options={[
                { label: "All Statuses", value: "" },
                { label: "Available", value: "available" },
                { label: "Occupied", value: "occupied" },
                { label: "Under Maintenance", value: "under maintenance" },
              ]}
            />
          </View>

          {(!!buildingFilter || !!statusFilter) && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                setBuildingFilter("");
                setStatusFilter("");
              }}
            >
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.stall_id}
            scrollEnabled={Platform.OS === "web"}
            nestedScrollEnabled={false}
            ListEmptyComponent={
              <Text style={styles.empty}>No stalls found.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.stall_sn}</Text>
                  <Text style={styles.rowSub}>
                    {item.stall_id} • {item.stall_status} • {item.building_id}
                  </Text>
                  {item.tenant_id && (
                    <Text style={styles.rowSub}>Tenant: {item.tenant_id}</Text>
                  )}
                </View>

                {(canEdit || canDelete) && (
                  <>
                    {canEdit && (
                      <TouchableOpacity
                        style={styles.link}
                        onPress={() => openEdit(item)}
                      >
                        <Text style={styles.linkText}>Update</Text>
                      </TouchableOpacity>
                    )}
                    {canDelete && (
                      <TouchableOpacity
                        style={[styles.link, { marginLeft: 8 }]}
                        onPress={() => onDelete(item)}
                      >
                        <Text style={[styles.linkText, { color: "#e53935" }]}>
                          Delete
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
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
        <View style={styles.modalWrap}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Create Stall</Text>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                <TextInput
                  style={styles.input}
                  placeholder="Stall SN"
                  value={stallSn}
                  onChangeText={setStallSn}
                />

                {isAdmin ? (
                  <Dropdown
                    label="Building"
                    value={buildingId}
                    onChange={setBuildingId}
                    options={buildings.map((b) => ({
                      label: `${b.building_name} (${b.building_id})`,
                      value: b.building_id,
                    }))}
                  />
                ) : (
                  <ReadOnlyField
                    label="Building"
                    value={userBuildingId || "(none)"}
                  />
                )}

                <Dropdown
                  label="Status"
                  value={status}
                  onChange={(v) => {
                    const s = v as Stall["stall_status"];
                    setStatus(s);
                    if (s === "available") setTenantId("");
                  }}
                  options={[
                    { label: "Available", value: "available" },
                    { label: "Occupied", value: "occupied" },
                    { label: "Under Maintenance", value: "under maintenance" },
                  ]}
                />

                {status !== "available" && (
                  <Dropdown
                    label="Tenant"
                    value={tenantId}
                    onChange={setTenantId}
                    options={[
                      { label: "None", value: "" },
                      ...tenantsForCreate.map((t) => ({
                        label: `${t.tenant_name} (${t.tenant_id})`,
                        value: t.tenant_id,
                      })),
                    ]}
                  />
                )}
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={() => setCreateVisible(false)}
                >
                  <Text style={[styles.btnText, { color: "#102a43" }]}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.btn}
                  onPress={onCreate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Create Stall</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* EDIT MODAL */}
      <Modal visible={editVisible} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              Edit Stall {editStall?.stall_id}
            </Text>
            {editStall && (
              <>
                <TextInput
                  style={styles.input}
                  value={editStall.stall_sn}
                  onChangeText={(v) =>
                    setEditStall({ ...editStall, stall_sn: v })
                  }
                />
                <Dropdown
                  label="Building"
                  value={editStall.building_id}
                  onChange={(v) =>
                    setEditStall({ ...editStall, building_id: v })
                  }
                  options={buildings.map((b) => ({
                    label: `${b.building_name} (${b.building_id})`,
                    value: b.building_id,
                  }))}
                  disabled={!isAdmin} // only admin can change building
                />
                <Dropdown
                  label="Status"
                  value={editStall.stall_status}
                  onChange={(v) => {
                    const s = v as Stall["stall_status"];
                    setEditStall({
                      ...editStall,
                      stall_status: s,
                      tenant_id: s === "available" ? null : editStall.tenant_id,
                    });
                  }}
                  options={[
                    { label: "Available", value: "available" },
                    { label: "Occupied", value: "occupied" },
                    { label: "Under Maintenance", value: "under maintenance" },
                  ]}
                />
                {editStall.stall_status !== "available" && (
                  <Dropdown
                    label="Tenant"
                    value={editStall.tenant_id ?? ""}
                    onChange={(v) =>
                      setEditStall({ ...editStall, tenant_id: v || null })
                    }
                    options={[
                      { label: "None", value: "" },
                      ...tenantsForEdit.map((t) => ({
                        label: `${t.tenant_name} (${t.tenant_id})`,
                        value: t.tenant_id,
                      })),
                    ]}
                  />
                )}
              </>
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
              {canEdit && (
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
              )}
            </View>
          </View>
        </View>
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
  const onValueChange = disabled
    ? () => {}
    : (itemValue: any) => onChange(String(itemValue));
  return (
    <View style={{ marginTop: 8, opacity: disabled ? 0.6 : 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View
        style={styles.pickerWrapper}
        pointerEvents={disabled ? "none" : "auto"}
      >
        <Picker
          selectedValue={value}
          onValueChange={onValueChange}
          style={styles.picker}
          enabled={Platform.OS === "android" ? !disabled : true}
        >
          {options.map((opt) => (
            <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

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
  input: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: "#102a43",
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

  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 12,
  },

  chipsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
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
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },

  dropdownLabel: {
    color: "#334e68ff",
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 6,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  picker: { height: 55, width: "100%" },

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
  clearBtn: {
    alignSelf: "flex-end",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#eef2ff",
    borderWidth: 1,
    borderColor: "#d6e0ff",
  },
  clearBtnText: { color: "#1f4bd8", fontWeight: "700" },
});