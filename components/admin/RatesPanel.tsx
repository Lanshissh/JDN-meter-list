
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
  erate_perKwH: number | null;
  e_vat: number | null;
  emin_con: number | null;
  wmin_con: number | null;
  wrate_perCbM: number | null;
  wnet_vat: number | null;
  w_vat: number | null;
  lrate_perKg: number | null;
  last_updated: string;
  updated_by: string;
};

/** Utils */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

// very small safe JWT payload decode to read user_level and building_id
function decodeJwtPayload(token: string | null): {
  user_level?: string;
  building_id?: string;
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

/** Component */
export default function RatesPanel({ token }: { token: string | null }) {
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // reference data
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  // list + query
  const [rates, setRates] = useState<Rate[]>([]);
  const [query, setQuery] = useState("");

  // scope
  const me = useMemo(() => decodeJwtPayload(token), [token]);
  const isAdmin = String(me?.user_level || "").toLowerCase() === "admin";
  const lockedBuildingId = isAdmin ? "" : String(me?.building_id || "");

  const [buildingId, setBuildingId] = useState<string>(lockedBuildingId);

  // sort
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc" | "tenantAsc" | "tenantDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // modals
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);

  // create form (VAT only)
  const [formTenantId, setFormTenantId] = useState<string>("");
  const [f_evat, setF_evat] = useState<string>("");
  const [f_wnet, setF_wnet] = useState<string>("");
  const [f_wvat, setF_wvat] = useState<string>("");

  // edit form (VAT only)
  const [editRow, setEditRow] = useState<Rate | null>(null);
  const [e_evat, setE_evat] = useState<string>("");
  const [e_wnet, setE_wnet] = useState<string>("");
  const [e_wvat, setE_wvat] = useState<string>("");

  /** API */
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  /** Boot */
  useEffect(() => {
    const boot = async () => {
      if (!token) {
        setBusy(false);
        notify("Not logged in", "Please log in to manage rates.");
        return;
      }
      try {
        setBusy(true);
        const [tenantsRes, buildingsRes] = await Promise.all([
          api.get<Tenant[]>("/tenants"),
          isAdmin ? api.get<Building[]>("/buildings") : Promise.resolve({ data: [] as Building[] }),
        ]);
        setTenants(tenantsRes.data || []);
        if (isAdmin) setBuildings(buildingsRes.data || []);
        setBuildingId((prev) => {
          if (prev) return prev;
          if (!isAdmin && lockedBuildingId) return lockedBuildingId;
          return buildingsRes?.data?.[0]?.building_id ?? lockedBuildingId ?? "";
        });
      } catch (err: any) {
        notify("Load failed", errorText(err, "Connection error."));
      } finally {
        setBusy(false);
      }
    };
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin, lockedBuildingId]);

  /** Load rates when building changes */
  useEffect(() => {
    if (!buildingId) return;
    const run = async () => {
      try {
        setBusy(true);
        const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
        setRates(rRes.data || []);
      } catch (err: any) {
        notify("Load failed", errorText(err, "Server error."));
      } finally {
        setBusy(false);
      }
    };
    run();

    const firstTenant = tenants.find((t) => t.building_id === buildingId)?.tenant_id ?? "";
    setFormTenantId(firstTenant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  /** Derived lists */
  const buildingChipOptions = useMemo(() => {
    if (isAdmin && buildings.length) {
      return [
        { label: "All Buildings", value: "" },
        ...buildings
          .slice()
          .sort((a, b) => a.building_name.localeCompare(b.building_name))
          .map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id })),
      ];
    }
    const base = [{ label: "All Buildings", value: "" }];
    if (lockedBuildingId) return base.concat([{ label: lockedBuildingId, value: lockedBuildingId }]);
    const ids = Array.from(new Set(tenants.map((t) => t.building_id))).sort();
    return base.concat(ids.map((id) => ({ label: id, value: id })));
  }, [isAdmin, buildings, tenants, lockedBuildingId]);

  const tenantsInBuilding = useMemo(() => tenants.filter((t) => t.building_id === buildingId), [tenants, buildingId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter((r) => {
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
        return arr.sort((a, b) => (Date.parse(b.last_updated) || 0) - (Date.parse(a.last_updated) || 0));
      case "oldest":
        return arr.sort((a, b) => (Date.parse(a.last_updated) || 0) - (Date.parse(b.last_updated) || 0));
      case "idAsc":
        return arr.sort((a, b) => cmp(a.rate_id, b.rate_id));
      case "idDesc":
        return arr.sort((a, b) => cmp(b.rate_id, a.rate_id));
      case "tenantAsc":
        return arr.sort((a, b) => cmp(a.tenant_name || a.tenant_id, b.tenant_name || b.tenant_id));
      case "tenantDesc":
        return arr.sort((a, b) => cmp(b.tenant_name || b.tenant_id, a.tenant_name || a.tenant_id));
      default:
        return arr;
    }
  }, [filtered, sortMode]);

  /** Create / Update (VAT fields only) */
  const onCreateOrUpdate = async () => {
    if (!buildingId || !formTenantId) {
      notify("Missing info", "Please select a building and tenant.");
      return;
    }
    try {
      setSubmitting(true);
      const body = {
        e_vat: f_evat.trim() === "" ? null : Number(f_evat),
        wnet_vat: f_wnet.trim() === "" ? null : Number(f_wnet),
        w_vat: f_wvat.trim() === "" ? null : Number(f_wvat),
      } as any;

      const res = await api.put(
        `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(formTenantId)}`,
        body,
      );
      const rid = res?.data?.rate_id ? ` (ID: ${res.data.rate_id})` : "";
      notify("Success", `${res?.data?.message || "Saved"}${rid}`);

      setF_evat("");
      setF_wnet("");
      setF_wvat("");

      const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
      setRates(rRes.data || []);
      setCreateVisible(false);
    } catch (err: any) {
      notify("Save failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Edit */
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
        e_vat: e_evat.trim() === "" ? null : Number(e_evat),
        wnet_vat: e_wnet.trim() === "" ? null : Number(e_wnet),
        w_vat: e_wvat.trim() === "" ? null : Number(e_wvat),
      } as any;

      await api.put(
        `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(editRow.tenant_id)}`,
        body,
      );
      setEditVisible(false);
      const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
      setRates(rRes.data || []);
      notify("Updated", "Rate updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Clear — only the remaining fields */
  const onClearRates = async (r: Rate) => {
    const ok = await confirm("Clear tenant rates", `This will clear rate fields for ${r.tenant_name || r.tenant_id}. Continue?`);
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.put(
        `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(r.tenant_id)}`,
        { e_vat: null, wnet_vat: null, w_vat: null },
      );
      const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
      setRates(rRes.data || []);
      notify("Cleared", "Rate fields were cleared.");
    } catch (err: any) {
      notify("Failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- UI helpers ----------
  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
    </TouchableOpacity>
  );

  const InputRow = ({ label, value, onChangeText, keyboardType = "default", placeholder }: any) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#9aa5b1"
        style={styles.input}
      />
    </View>
  );

  // ---------- Render ----------
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Rates</Text>
        <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
          <Text style={styles.btnText}>+ Create / Update Rates</Text>
        </TouchableOpacity>
      </View>

      {/* Search + Filters button (like BuildingPanel) */}
      <View style={styles.filtersBar}>
        <View style={[styles.searchWrap, { flex: 1 }]}>
          <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search rates by tenant name or ID…"
            placeholderTextColor="#9aa5b1"
            style={styles.search}
          />
        </View>

        <TouchableOpacity style={styles.btnGhost} onPress={() => setFiltersVisible(true)}>
          <Ionicons name="filter-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
          <Text style={styles.btnGhostText}>Filters</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {busy ? (
        <View style={styles.loader}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.rate_id}
          style={{ maxHeight: 360, marginTop: 4 }}
          nestedScrollEnabled
          ListEmptyComponent={<Text style={styles.empty}>No rates found.</Text>}
          renderItem={({ item }) => (
            <View style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {(item.tenant_name || item.tenant_id) + " "}
                  <Text style={styles.rowSubMuted}>· {item.rate_id}</Text>
                </Text>
                <Text style={styles.rowSub}>
                  e_vat: {item.e_vat ?? "—"} · wnet_vat: {item.wnet_vat ?? "—"} · w_vat: {item.w_vat ?? "—"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => openEdit(item)}>
                  <Text style={styles.actionBtnGhostText}>Update</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => onClearRates(item)}>
                  <Text style={styles.actionBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* FILTERS modal (Building + Sort) */}
      <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.modalTitle}>Filters & Sort</Text>
            <View style={styles.modalDivider} />

            <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>Building</Text>
            <View style={styles.chipsRow}>
              {buildingChipOptions.map((opt) => (
                <Chip
                  key={opt.value || "all"}
                  label={opt.label}
                  active={buildingId === opt.value}
                  onPress={() => setBuildingId(opt.value)}
                />
              ))}
            </View>

            <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Sort by</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "ID ↑", val: "idAsc" },
                { label: "ID ↓", val: "idDesc" },
                { label: "Tenant ↑", val: "tenantAsc" },
                { label: "Tenant ↓", val: "tenantDesc" },
              ].map(({ label, val }) => (
                <Chip key={val} label={label} active={sortMode === (val as SortMode)} onPress={() => setSortMode(val as SortMode)} />
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => { setQuery(""); setSortMode("newest"); setBuildingId(lockedBuildingId || ""); setFiltersVisible(false); }}
              >
                <Text style={styles.btnGhostText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={() => setFiltersVisible(false)}>
                <Text style={styles.btnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* CREATE modal */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create / Update Rate</Text>
            <View style={styles.modalDivider} />

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              {/* Tenant selector */}
              <Text style={styles.label}>Tenant</Text>
              <View style={styles.chipsRowWrap}>
                {tenantsInBuilding.map((t) => (
                  <TouchableOpacity
                    key={t.tenant_id}
                    onPress={() => setFormTenantId(t.tenant_id)}
                    style={[styles.chip, formTenantId === t.tenant_id ? styles.chipActive : styles.chipIdle]}
                  >
                    <Text style={[styles.chipText, formTenantId === t.tenant_id ? styles.chipTextActive : styles.chipTextIdle]}>
                      {t.tenant_name} ({t.tenant_id})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Keep ONLY VAT fields */}
              <InputRow label="Electric VAT (e_vat)" value={f_evat} onChangeText={setF_evat} keyboardType="decimal-pad" placeholder="e.g. 0.12" />
              <InputRow label="Water net (wnet_vat)" value={f_wnet} onChangeText={setF_wnet} keyboardType="decimal-pad" placeholder="e.g. 0.00" />
              <InputRow label="Water VAT (w_vat)" value={f_wvat} onChangeText={setF_wvat} keyboardType="decimal-pad" placeholder="e.g. 0.12" />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setCreateVisible(false)}>
                <Text style={styles.btnGhostText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreateOrUpdate} disabled={submitting}>
                <Text style={styles.btnText}>{submitting ? "Saving…" : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT modal */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Rate</Text>
            <View style={styles.modalDivider} />

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={[styles.label, { marginBottom: 6 }]}>
                Tenant: <Text style={styles.rowSubMuted}>{editRow?.tenant_name || editRow?.tenant_id}</Text>
              </Text>

              {/* Keep ONLY VAT fields */}
              <InputRow label="Electric VAT (e_vat)" value={e_evat} onChangeText={setE_evat} keyboardType="decimal-pad" placeholder="e.g. 0.12" />
              <InputRow label="Water net (wnet_vat)" value={e_wnet} onChangeText={setE_wnet} keyboardType="decimal-pad" placeholder="e.g. 0.00" />
              <InputRow label="Water VAT (w_vat)" value={e_wvat} onChangeText={setE_wvat} keyboardType="decimal-pad" placeholder="e.g. 0.12" />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => editRow && onClearRates(editRow)}>
                <Text style={styles.actionBtnText}>Delete</Text>
              </TouchableOpacity>

              <View style={{ flex: 1 }} />

              <TouchableOpacity style={styles.btnGhost} onPress={() => setEditVisible(false)}>
                <Text style={styles.btnGhostText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>
                <Text style={styles.btnText}>{submitting ? "Saving…" : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** Styles (synced with BuildingPanel look) */
const styles = StyleSheet.create({
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
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },

  // search + filter button row like BuildingPanel
  filtersBar: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e7ecf3",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 220,
  },
  search: { flex: 1, color: "#0f172a", paddingVertical: 2 },

  // list rows
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  rowTitle: { fontSize: 14, fontWeight: "700", color: "#0f172a" },
  rowSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  rowSubMuted: { color: "#94a3b8" },

  loader: { padding: 20, alignItems: "center" },
  empty: { padding: 14, textAlign: "center", color: "#475569" },

  // fields
  field: { marginBottom: 10 },
  label: { fontSize: 12, color: "#6b7280", marginBottom: 6 },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e7ecf3",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#0f172a",
  },

  // chips
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
  },
  chipIdle: { backgroundColor: "#fff", borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#082cac", borderColor: "#082cac" },
  chipText: { fontSize: 12 },
  chipTextIdle: { color: "#0f172a", fontWeight: "700" },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipsRowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  dropdownLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#486581",
    marginBottom: 6,
  },

  // buttons
  actionBtn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionBtnText: { color: "#fff", fontWeight: "700" },
  actionBtnGhost: {
    backgroundColor: "#edf2ff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionBtnGhostText: { color: "#082cac", fontWeight: "700" },
  btn: {
    backgroundColor: "#082cac",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },

  btnGhost: {
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    flexDirection: "row",
  },
  btnGhostText: { color: "#082cac", fontWeight: "700" },

  btnDanger: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnDangerText: { color: "#fff", fontWeight: "700" },

  btnDangerGhost: {
    backgroundColor: "#fff0f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  btnDangerGhostText: { color: "#b91c1c", fontWeight: "700" },

  btnDisabled: { opacity: 0.65 },

  // modal
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    width: "100%",
    maxWidth: 700,
    maxHeight: "88%",
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 16px 48px rgba(16,42,67,0.15)" as any },
      default: { elevation: 4 },
    }) as any),
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  modalDivider: { height: 1, backgroundColor: "#eef2f7", marginVertical: 8 },
  modalActions: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },

  // Filters prompt (like BuildingPanel small modal)
  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(16,42,67,0.25)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  promptCard: {
    backgroundColor: "#fff",
    width: "100%",
    maxWidth: 520,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16,42,67,0.08)" as any },
      default: { elevation: 3 },
    }) as any),
  },
});