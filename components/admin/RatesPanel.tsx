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

/** Types */
export type Building = { building_id: string; building_name: string };
export type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  bill_start: string;
};
export type Rate = {
  rate_id: string;
  tenant_id: string;
  tenant_name?: string | null;
  /** kept fields only */
  e_vat: number | null;
  wnet_vat: number | null;
  w_vat: number | null;
  last_updated: string;
  updated_by: string;
};

/** Utils */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const toNum = (s: string) => (s.trim() === "" ? null : Number(s));

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

// decode minimal JWT payload
function decodeJwtPayload(token: string | null): {
  user_level?: string;
  building_id?: string;
  utility_role?: string[] | string;
} {
  try {
    if (!token) return {};
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const g: any = globalThis as any;
    const json = typeof g.atob === "function" ? g.atob(base64) : "";
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
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

export default function RatesPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // reference data
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  // scope
  const me = useMemo(() => decodeJwtPayload(token), [token]);
  const isAdmin = String(me?.user_level || "").toLowerCase() === "admin";
  const lockedBuildingId = isAdmin ? "" : String(me?.building_id || "");

  const utilRoles = useMemo(() => {
    const raw = (me as any)?.utility_role;
    const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return arr.map((s) => String(s).toLowerCase());
  }, [me]);
  const canElec = isAdmin || utilRoles.includes("electric");
  const canWater = isAdmin || utilRoles.includes("water");

  const [buildingId, setBuildingId] = useState<string>(lockedBuildingId);

  // list + query
  const [rates, setRates] = useState<Rate[]>([]);
  const [query, setQuery] = useState("");

  // sorting
  type SortMode =
    | "newest"
    | "oldest"
    | "idAsc"
    | "idDesc"
    | "tenantAsc"
    | "tenantDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  /** API */
  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token]
  );
  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: authHeader,
        timeout: 15000,
      }),
    [authHeader]
  );

  /** Boot */
  useEffect(() => {
    (async () => {
      if (!token) {
        setBusy(false);
        notify("Not logged in", "Please log in to manage rates.");
        return;
      }
      try {
        setBusy(true);

        // tenants (names + form dropdown)
        const tenantsRes = await api.get<Tenant[]>("/tenants");
        setTenants(tenantsRes.data || []);

        // building list is admin-only; non-admin has fixed buildingId from token
        if (isAdmin) {
          const buildingsRes = await api.get<Building[]>("/buildings");
          setBuildings(buildingsRes.data || []);
          setBuildingId(
            (prev) => prev || buildingsRes?.data?.[0]?.building_id || ""
          );
        } else {
          setBuildingId((prev) => prev || lockedBuildingId);
        }
      } catch (err: any) {
        notify("Load failed", errorText(err, "Connection error."));
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin, lockedBuildingId]);

  /** Load rates when building changes */
  useEffect(() => {
    if (!buildingId) return;
    (async () => {
      try {
        setBusy(true);
        const rRes = await api.get<Rate[]>(
          `/rates/buildings/${encodeURIComponent(buildingId)}`
        );
        setRates(rRes.data || []);
      } catch (err: any) {
        notify("Load failed", errorText(err, "Server error."));
      } finally {
        setBusy(false);
      }
    })();

    const firstTenant =
      tenants.find((t) => t.building_id === buildingId)?.tenant_id ?? "";
    setFormTenantId(firstTenant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  /** Derived lists */
  const tenantsInBuilding = useMemo(
    () => tenants.filter((t) => t.building_id === buildingId),
    [tenants, buildingId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rates;
    if (!q) return list;
    return list.filter((r) => {
      const tn = (r.tenant_name || "").toLowerCase();
      return (
        r.rate_id.toLowerCase().includes(q) ||
        r.tenant_id.toLowerCase().includes(q) ||
        tn.includes(q)
      );
    });
  }, [rates, query]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "newest":
        return arr.sort(
          (a, b) =>
            (Date.parse(b.last_updated) || 0) -
            (Date.parse(a.last_updated) || 0)
        );
      case "oldest":
        return arr.sort(
          (a, b) =>
            (Date.parse(a.last_updated) || 0) -
            (Date.parse(b.last_updated) || 0)
        );
      case "idAsc":
        return arr.sort((a, b) => cmp(a.rate_id, b.rate_id));
      case "idDesc":
        return arr.sort((a, b) => cmp(b.rate_id, a.rate_id));
      case "tenantAsc":
        return arr.sort((a, b) =>
          cmp(a.tenant_name || a.tenant_id, b.tenant_name || b.tenant_id)
        );
      case "tenantDesc":
        return arr.sort((a, b) =>
          cmp(b.tenant_name || b.tenant_id, a.tenant_name || a.tenant_id)
        );
      default:
        return arr;
    }
  }, [filtered, sortMode]);

  /** ---------- Create / Update (PUT) ---------- */
  const [createVisible, setCreateVisible] = useState(false);
  const [formTenantId, setFormTenantId] = useState<string>("");

  // kept fields only
  const [f_evat, setF_evat] = useState<string>("");
  const [f_wnet, setF_wnet] = useState<string>("");
  const [f_wvat, setF_wvat] = useState<string>("");

  const onCreateOrUpdate = async () => {
    if (!buildingId || !formTenantId) {
      notify("Missing info", "Please select a building and tenant.");
      return;
    }
    try {
      setSubmitting(true);
      const body = {
        e_vat: toNum(f_evat),
        wnet_vat: toNum(f_wnet),
        w_vat: toNum(f_wvat),
      } as any;

      const res = await api.put(
        `/rates/buildings/${encodeURIComponent(
          buildingId
        )}/tenants/${encodeURIComponent(formTenantId)}`,
        body
      );
      const rid = res?.data?.rate_id ? ` (ID: ${res.data.rate_id})` : "";
      notify("Success", `${res?.data?.message || "Saved"}${rid}`);

      setF_evat("");
      setF_wnet("");
      setF_wvat("");

      const rRes = await api.get<Rate[]>(
        `/rates/buildings/${encodeURIComponent(buildingId)}`
      );
      setRates(rRes.data || []);
      setCreateVisible(false);
    } catch (err: any) {
      notify("Save failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** ---------- Edit ---------- */
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Rate | null>(null);

  const [e_evat, setE_evat] = useState<string>("");
  const [e_wnet, setE_wnet] = useState<string>("");
  const [e_wvat, setE_wvat] = useState<string>("");

  const openEdit = (r: Rate) => {
    setEditRow(r);
    setE_evat(r.e_vat != null ? String(r.e_vat) : "");
    setE_wnet(r.wnet_vat != null ? String(r.wnet_vat) : "");
    setE_wvat(r.w_vat != null ? String(r.w_vat) : "");
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editRow) return;
    try {
      setSubmitting(true);
      const body = {
        e_vat: toNum(e_evat),
        wnet_vat: toNum(e_wnet),
        w_vat: toNum(e_wvat),
      } as any;

      await api.put(
        `/rates/buildings/${encodeURIComponent(
          buildingId
        )}/tenants/${encodeURIComponent(editRow.tenant_id)}`,
        body
      );
      setEditVisible(false);
      const rRes = await api.get<Rate[]>(
        `/rates/buildings/${encodeURIComponent(buildingId)}`
      );
      setRates(rRes.data || []);
      notify("Updated", "Rate updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Delete */
  const onDelete = async (r: Rate) => {
    const ok = await confirm(
      "Delete rate",
      `Are you sure you want to delete the rate for ${
        r.tenant_name || r.tenant_id
      }?`
    );
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(
        `/rates/buildings/${encodeURIComponent(
          buildingId
        )}/tenants/${encodeURIComponent(r.tenant_id)}`
      );
      const rRes = await api.get<Rate[]>(
        `/rates/buildings/${encodeURIComponent(buildingId)}`
      );
      setRates(rRes.data || []);
      notify("Deleted", "Tenant rate deleted.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** UI helpers */
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
          selectedValue={value}
          onValueChange={(v) => onChange(String(v))}
          style={styles.picker}
          enabled={!disabled}
        >
          {options.map((o) => (
            <Picker.Item key={o.value || "_"} label={o.label} value={o.value} />
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

  const Row = ({ item }: { item: Rate }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {item.tenant_name || item.tenant_id}
        </Text>
        <Text style={styles.rowSub}>
          {item.rate_id} • Last updated {fmtDate(item.last_updated)} by{" "}
          {item.updated_by}
        </Text>
      </View>

      <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
        <Text style={styles.linkText}>Update</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.link, { marginLeft: 8 }]}
        onPress={() => onDelete(item)}
      >
        <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  /** RENDER */
  return (
    <View style={styles.grid}>
      {/* Manage Rates + Create button */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Manage Rates</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => setCreateVisible(true)}
          >
            <Text style={styles.btnText}>+ Create / Update Rate</Text>
          </TouchableOpacity>
        </View>

        {/* Filters row */}
        <View style={styles.filtersBar}>
          {/* Search */}
          <View
            style={[
              styles.searchWrap,
              Platform.OS === "web" && ({ flex: 1.3 } as any),
            ]}
          >
            <Ionicons
              name="search"
              size={16}
              color="#94a3b8"
              style={{ marginRight: 6 }}
            />
            <TextInput
              style={styles.search}
              placeholder="Search by Rate ID, Tenant ID, Tenant Name…"
              placeholderTextColor="#9aa5b1"
              value={query}
              onChangeText={setQuery}
            />
          </View>

          {/* Building selector (admin only) */}
          <View style={[styles.filterCol, { flex: 1 }]}>
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
              <View style={{ opacity: 0.7 }}>
                <Text style={styles.dropdownLabel}>Building</Text>
                <Text style={{ paddingVertical: 10, color: "#334155" }}>
                  {buildingId || "—"}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* List */}
      <View style={styles.card}>
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.rate_id}
            ListEmptyComponent={
              <Text style={styles.empty}>No rates found.</Text>
            }
            renderItem={({ item }) => <Row item={item} />}
            style={{ marginTop: 6 }}
          />
        )}
      </View>

      {/* CREATE / UPSERT MODAL */}
      <Modal
        visible={createVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalCard}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              <Text style={styles.modalTitle}>Create / Update Rate</Text>

              {/* Tenant (filtered by building) */}
              <Dropdown
                label="Tenant"
                value={formTenantId}
                onChange={setFormTenantId}
                options={tenantsInBuilding.map((t) => ({
                  label: `${t.tenant_name} (${t.tenant_id})`,
                  value: t.tenant_id,
                }))}
              />

              {/* Electric */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>Electric</Text>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>VAT (e_vat)</Text>
                <TextInput
                  style={[styles.input, !canElec ? styles.readonlyInput : null]}
                  placeholder="e.g. 0.12"
                  keyboardType="decimal-pad"
                  value={f_evat}
                  onChangeText={setF_evat}
                  editable={canElec}
                />
              </View>

              {/* Water */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>Water</Text>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Net VAT (wnet_vat)</Text>

                <TextInput
                  style={[
                    styles.input,
                    !canWater ? styles.readonlyInput : null,
                  ]}
                  placeholder="Net VAT divisor (wnet_vat)"
                  keyboardType="decimal-pad"
                  value={f_wnet}
                  onChangeText={setF_wnet}
                  editable={canWater}
                />
              </View>
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>VAT (w_vat)</Text>
                <TextInput
                  style={[
                    styles.input,
                    !canWater ? styles.readonlyInput : null,
                  ]}
                  placeholder="VAT (w_vat) e.g. 0.12"
                  keyboardType="decimal-pad"
                  value={f_wvat}
                  onChangeText={setF_wvat}
                  editable={canWater}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btnGhost]}
                  onPress={() => setCreateVisible(false)}
                >
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, submitting && styles.btnDisabled]}
                  onPress={onCreateOrUpdate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT MODAL */}
      <Modal
        visible={editVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalCard}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              <Text style={styles.modalTitle}>Update Rate</Text>

              {editRow ? (
                <Text style={styles.readonlyField}>
                  {(editRow.tenant_name || editRow.tenant_id) +
                    "  •  " +
                    editRow.rate_id}
                </Text>
              ) : null}

              {/* Electric */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>Electric</Text>
              </View>
              <TextInput
                style={[styles.input, !canElec ? styles.readonlyInput : null]}
                placeholder="VAT (e_vat) e.g. 0.12"
                keyboardType="decimal-pad"
                value={e_evat}
                onChangeText={setE_evat}
                editable={canElec}
              />

              {/* Water */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>Water</Text>
              </View>
              <TextInput
                style={[styles.input, !canWater ? styles.readonlyInput : null]}
                placeholder="Net VAT divisor (wnet_vat)"
                keyboardType="decimal-pad"
                value={e_wnet}
                onChangeText={setE_wnet}
                editable={canWater}
              />
              <TextInput
                style={[styles.input, !canWater ? styles.readonlyInput : null]}
                placeholder="VAT (w_vat) e.g. 0.12"
                keyboardType="decimal-pad"
                value={e_wvat}
                onChangeText={setE_wvat}
                editable={canWater}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btnGhost]}
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
                    <Text style={styles.btnText}>Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** ---------------- Styles ---------------- */
const styles = StyleSheet.create({
  grid: { flex: 1, padding: 12, gap: 12 },

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
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#102a43" },

  // Filters
  filtersBar: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    gap: 12,
    marginBottom: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  filterCol: { flex: 1 },

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
  search: { flex: 1, fontSize: 14, color: "#0b1f33" },

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

  // Chips
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipIdle: { backgroundColor: "#f8fafc", borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#0f62fe", borderColor: "#0f62fe" },
  chipText: { fontSize: 12, fontWeight: "700" },
  chipTextIdle: { color: "#475569" },
  chipTextActive: { color: "#fff" },

  // List row
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

  // Modal
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    padding: 12,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
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
  readonlyField: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e2e8f0",
    paddingHorizontal: 10,
    paddingVertical: 12,
    color: "#334155",
    marginBottom: 8,
  },

  // Section headers
  sectionHeader: { marginTop: 12, marginBottom: 4 },
  sectionHeaderText: { fontWeight: "800", color: "#0b1f33" },

  // Inputs
  dropdownLabel: { color: "#486581", fontSize: 12, marginTop: 8 },
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
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: "#0b1f33",
    marginTop: 8,
  },
  readonlyInput: {
    opacity: 0.65,
  },

  loader: {
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { color: "#64748b", textAlign: "center", paddingVertical: 14 },
});