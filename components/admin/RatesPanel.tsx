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
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import axios from "axios";
import { Picker } from "@react-native-picker/picker";
import { BASE_API } from "../../constants/api";

/** Types */
type Building = { building_id: string; building_name: string };
type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  bill_start: string;
};
type Rate = {
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
  String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

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

// very small safe JWT payload decode to read user_level and building_id
function decodeJwtPayload(token: string | null): { user_level?: string; building_id?: string; utility_role?: any } {
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

/** Component */
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

  const [buildingId, setBuildingId] = useState<string>(lockedBuildingId);

  // list + query
  const [rates, setRates] = useState<Rate[]>([]);
  const [query, setQuery] = useState("");

  // create/update form fields
  const [formTenantId, setFormTenantId] = useState<string>("");
  const [f_erate, setF_erate] = useState<string>("");
  const [f_evat, setF_evat] = useState<string>("");
  const [f_emin, setF_emin] = useState<string>("");
  const [f_wmin, setF_wmin] = useState<string>("");
  const [f_wrate, setF_wrate] = useState<string>("");
  const [f_wnet, setF_wnet] = useState<string>("");
  const [f_wvat, setF_wvat] = useState<string>("");
  const [f_lpg, setF_lpg] = useState<string>("");

  // edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Rate | null>(null);
  const [e_erate, setE_erate] = useState<string>("");
  const [e_evat, setE_evat] = useState<string>("");
  const [e_emin, setE_emin] = useState<string>("");
  const [e_wmin, setE_wmin] = useState<string>("");
  const [e_wrate, setE_wrate] = useState<string>("");
  const [e_wnet, setE_wnet] = useState<string>("");
  const [e_wvat, setE_wvat] = useState<string>("");
  const [e_lpg, setE_lpg] = useState<string>("");

  // sorting
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc" | "tenantAsc" | "tenantDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  /** API */
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
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
    const boot = async () => {
      if (!token) {
        setBusy(false);
        Alert.alert("Not logged in", "Please log in to manage rates.");
        return;
      }
      try {
        setBusy(true);

        // 1) Always load tenants (biller is allowed; server will scope to their building)
        // 2) Admin only: load buildings list (biller cannot call /buildings — it's admin-only)
        const [tenantsRes, buildingsRes] = await Promise.all([
          api.get<Tenant[]>("/tenants"),
          isAdmin ? api.get<Building[]>("/buildings") : Promise.resolve({ data: [] as Building[] }),
        ]);

        setTenants(tenantsRes.data || []);
        if (isAdmin) setBuildings(buildingsRes.data || []);

        // pick buildingId:
        setBuildingId((prev) => {
          if (prev) return prev;
          if (!isAdmin && lockedBuildingId) return lockedBuildingId;
          return buildingsRes?.data?.[0]?.building_id ?? lockedBuildingId ?? "";
        });

      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || "Connection error.";
        Alert.alert("Load failed", msg);
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
        Alert.alert("Load failed", err?.response?.data?.error ?? "Server error.");
      } finally {
        setBusy(false);
      }
    };
    run();

    // default tenant for form
    const firstTenant = tenants.find((t) => t.building_id === buildingId)?.tenant_id ?? "";
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
    if (!q) return rates;
    return rates.filter((r) => {
      const tn = (r.tenant_name || "").toLowerCase();
      return r.rate_id.toLowerCase().includes(q) || r.tenant_id.toLowerCase().includes(q) || tn.includes(q);
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

  /** Create or Update (PUT) */
  const onCreateOrUpdate = async () => {
    if (!buildingId || !formTenantId) {
      Alert.alert("Missing info", "Please select a building and tenant.");
      return;
    }
    try {
      setSubmitting(true);
      const body = {
        erate_perKwH: toNum(f_erate),
        e_vat: toNum(f_evat),
        emin_con: toNum(f_emin),
        wmin_con: toNum(f_wmin),
        wrate_perCbM: toNum(f_wrate),
        wnet_vat: toNum(f_wnet),
        w_vat: toNum(f_wvat),
        lrate_perKg: toNum(f_lpg),
      };
      const res = await api.put(
        `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(formTenantId)}`,
        body
      );
      const rid = res?.data?.rate_id ? ` (ID: ${res.data.rate_id})` : "";
      Alert.alert("Success", `${res?.data?.message || "Saved"}${rid}`);

      // clear numeric fields but keep tenant selection
      setF_erate("");
      setF_evat("");
      setF_emin("");
      setF_wmin("");
      setF_wrate("");
      setF_wnet("");
      setF_wvat("");
      setF_lpg("");

      // refresh
      const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
      setRates(rRes.data || []);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Server error.";
      Alert.alert("Save failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Edit modal helpers */
  const openEdit = (r: Rate) => {
    setEditRow(r);
    setE_erate(r.erate_perKwH != null ? String(r.erate_perKwH) : "");
    setE_evat(r.e_vat != null ? String(r.e_vat) : "");
    setE_emin(r.emin_con != null ? String(r.emin_con) : "");
    setE_wmin(r.wmin_con != null ? String(r.wmin_con) : "");
    setE_wrate(r.wrate_perCbM != null ? String(r.wrate_perCbM) : "");
    setE_wnet(r.wnet_vat != null ? String(r.wnet_vat) : "");
    setE_wvat(r.w_vat != null ? String(r.w_vat) : "");
    setE_lpg(r.lrate_perKg != null ? String(r.lrate_perKg) : "");
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editRow) return;
    try {
      setSubmitting(true);
      const body = {
        erate_perKwH: toNum(e_erate),
        e_vat: toNum(e_evat),
        emin_con: toNum(e_emin),
        wmin_con: toNum(e_wmin),
        wrate_perCbM: toNum(e_wrate),
        wnet_vat: toNum(e_wnet),
        w_vat: toNum(e_wvat),
        lrate_perKg: toNum(e_lpg),
      };
      await api.put(
        `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(editRow.tenant_id)}`,
        body
      );
      setEditVisible(false);
      const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
      setRates(rRes.data || []);
      Alert.alert("Updated", "Rate updated successfully.");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Server error.";
      Alert.alert("Update failed", msg);
    } finally {
      setSubmitting(false);
    }
  };

  /** Delete */
  const confirmDelete = (r: Rate) =>
    Platform.OS === "web"
      ? Promise.resolve(window.confirm(`Delete rate for ${r.tenant_name || r.tenant_id}?`))
      : new Promise((resolve) => {
          Alert.alert(
            "Delete rate",
            `Are you sure you want to delete the rate for ${r.tenant_name || r.tenant_id}?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Delete", style: "destructive", onPress: () => resolve(true) },
            ]
          );
        });

  const onDelete = async (r: Rate) => {
    const ok = await confirmDelete(r);
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(
        `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(r.tenant_id)}`
      );
      const rRes = await api.get<Rate[]>(`/rates/buildings/${encodeURIComponent(buildingId)}`);
      setRates(rRes.data || []);
      if (Platform.OS !== "web") Alert.alert("Deleted", "Tenant rate deleted.");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Server error.";
      Alert.alert("Delete failed", msg);
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
          enabled={!disabled}
          selectedValue={value}
          onValueChange={(val) => onChange(String(val))}
          style={styles.picker}
        >
          {options.map((opt) => (
            <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );

  const LabeledInput = ({
    label,
    value,
    setValue,
    keyboardType = "decimal-pad",
  }: {
    label: string;
    value: string;
    setValue: (s: string) => void;
    keyboardType?: "default" | "numeric" | "decimal-pad";
  }) => (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        keyboardType={keyboardType}
        placeholder="0.00"
        style={styles.input}
      />
    </View>
  );

  const Chip = ({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) => (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  /** Render */
  return (
    <View style={styles.grid}>
      {/* SCOPE BAR */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Scope</Text>
        <Dropdown
          label="Building"
          value={buildingId}
          onChange={setBuildingId}
          disabled={!isAdmin}
          options={
            isAdmin
              ? buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }))
              : [{ label: lockedBuildingId || "No Building", value: lockedBuildingId || "" }]
          }
        />
      </View>

      {/* CREATE / UPDATE (PUT) — mobile-friendly */}
      <View style={styles.card}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContainer}>
            <Text style={styles.cardTitle}>Create / Update Tenant Rate</Text>

            <Dropdown
              label="Tenant"
              value={formTenantId}
              onChange={setFormTenantId}
              options={tenantsInBuilding.map((t) => ({
                label: `${t.tenant_name} (${t.tenant_sn})`,
                value: t.tenant_id,
              }))}
            />

            {/* Electric */}
            <Text style={styles.sectionTitle}>Electric</Text>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="Electric Rate per KwH" value={f_erate} setValue={setF_erate} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Electric VAT" value={f_evat} setValue={setF_evat} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Electric Min Consumption" value={f_emin} setValue={setF_emin} />
              </View>
            </View>

            {/* Water */}
            <Text style={styles.sectionTitle}>Water</Text>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="Water Min Consumption" value={f_wmin} setValue={setF_wmin} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Water Rate per CbM" value={f_wrate} setValue={setF_wrate} />
              </View>
              <View className="field" style={styles.field}>
                <LabeledInput label="Water Net VAT" value={f_wnet} setValue={setF_wnet} />
              </View>
            </View>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="Water VAT" value={f_wvat} setValue={setF_wvat} />
              </View>
            </View>

            {/* LPG */}
            <Text style={styles.sectionTitle}>LPG</Text>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="LPG Rate per Kg" value={f_lpg} setValue={setF_lpg} />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.btn, styles.btnWide, submitting && styles.btnDisabled]}
              onPress={onCreateOrUpdate}
              disabled={submitting || !formTenantId}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save Rate</Text>}
            </TouchableOpacity>

            <Text style={styles.hint}>
              • Admin can edit all fields. Biller edits are limited by their utility access; other fields will be
              ignored by the server.
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {/* LIST */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Tenant Rates in Building</Text>

        <TextInput
          style={styles.search}
          placeholder="Search tenant name, SN, tenant_id, or rate_id…"
          value={query}
          onChangeText={setQuery}
        />

        <View style={styles.chipsRow}>
          <Chip label="Newest" active={sortMode === "newest"} onPress={() => setSortMode("newest")} />
          <Chip label="Oldest" active={sortMode === "oldest"} onPress={() => setSortMode("oldest")} />
          <Chip label="Rate ID ↑" active={sortMode === "idAsc"} onPress={() => setSortMode("idAsc")} />
          <Chip label="Rate ID ↓" active={sortMode === "idDesc"} onPress={() => setSortMode("idDesc")} />
          <Chip label="Tenant ↑" active={sortMode === "tenantAsc"} onPress={() => setSortMode("tenantAsc")} />
          <Chip label="Tenant ↓" active={sortMode === "tenantDesc"} onPress={() => setSortMode("tenantDesc")} />
        </View>

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
            ListEmptyComponent={<Text style={styles.empty}>No rates found for this building.</Text>}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.tenant_name || item.tenant_id} <Text style={styles.muted}>({item.tenant_id})</Text>
                  </Text>
                  <Text style={styles.rowSub}>
                    Rate ID: <Text style={styles.mono}>{item.rate_id}</Text> • Updated: {fmtDate(item.last_updated)} • By:{" "}
                    {item.updated_by}
                  </Text>
                  <Text style={styles.rowSub}>
                    E[rate/vat/min]: {item.erate_perKwH ?? "-"} / {item.e_vat ?? "-"} / {item.emin_con ?? "-"} • W[min/rate/netvat/vat]:{" "}
                    {item.wmin_con ?? "-"} / {item.wrate_perCbM ?? "-"} / {item.wnet_vat ?? "-"} / {item.w_vat ?? "-"} • LPG/kg:{" "}
                    {item.lrate_perKg ?? "-"}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
                    <Text style={styles.linkText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => onDelete(item)}>
                    <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )}
      </View>

      {/* EDIT MODAL */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Edit Rate</Text>

            <Text style={styles.sectionTitle}>Electric</Text>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="Electric Rate per KwH" value={e_erate} setValue={setE_erate} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Electric VAT" value={e_evat} setValue={setE_evat} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Electric Min Consumption" value={e_emin} setValue={setE_emin} />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Water</Text>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="Water Min Consumption" value={e_wmin} setValue={setE_wmin} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Water Rate per CbM" value={e_wrate} setValue={setE_wrate} />
              </View>
              <View style={styles.field}>
                <LabeledInput label="Water Net VAT" value={e_wnet} setValue={setE_wnet} />
              </View>
            </View>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="Water VAT" value={e_wvat} setValue={setE_wvat} />
              </View>
            </View>

            <Text style={styles.sectionTitle}>LPG</Text>
            <View style={[styles.gridCols, styles.stackOnMobile]}>
              <View style={styles.field}>
                <LabeledInput label="LPG Rate per Kg" value={e_lpg} setValue={setE_lpg} />
              </View>
            </View>

            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 16 }}>
              <TouchableOpacity style={[styles.btn, styles.btnLight]} onPress={() => setEditVisible(false)}>
                <Text style={[styles.btnText, { color: "#082cac" }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { marginLeft: 8 }]}
                onPress={onUpdate}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Styles */
const styles = StyleSheet.create({
  grid: {
    gap: 12,
    padding: 12,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: "#000", shadowOpacity: 0.06, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2 },
      web: {},
    }),
  },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "700", marginTop: 8, marginBottom: 4 },
  inputLabel: { fontSize: 12, color: "#374151", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    overflow: "hidden",
  },
  picker: { height: 40 },
  formContainer: { paddingBottom: 8 },
  gridCols: { flexDirection: "row", gap: 8 },
  stackOnMobile: { flexWrap: "wrap" },
  field: { flex: 1, minWidth: 180 },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: "#c7d2fe" },
  chipActive: { backgroundColor: "#e0e7ff" },
  chipText: { fontSize: 12, color: "#1f2937" },
  chipTextActive: { fontWeight: "700" },

  search: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },

  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowTitle: { fontSize: 14, fontWeight: "700" },
  rowSub: { fontSize: 12, color: "#334155", marginTop: 2 },
  muted: { color: "#6b7280" },
  mono: { fontFamily: Platform.select({ web: "monospace", default: "System" }) },

  link: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: "#f3f4f6" },
  linkText: { fontSize: 12, color: "#082cac", fontWeight: "700" },

  btn: { backgroundColor: "#082cac", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  btnLight: { backgroundColor: "#eef2ff" },
  btnText: { color: "#fff", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
  btnWide: { marginTop: 12, alignSelf: "flex-start" },

  hint: { marginTop: 8, color: "#64748b", fontSize: 12 },

  loader: { paddingVertical: 20 },
  empty: { paddingVertical: 20, textAlign: "center", color: "#6b7280" },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
  },
  dropdownLabel: {
    fontSize: 12,
    color: "#374151",
    marginBottom: 4,
    fontWeight: "600",
  },
});