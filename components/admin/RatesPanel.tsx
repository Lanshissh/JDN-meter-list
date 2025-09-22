import { Picker } from "@react-native-picker/picker";
import axios from "axios";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
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

// very small safe JWT payload decode to read user_level and building_id
function decodeJwtPayload(token: string | null): {
  user_level?: string;
  building_id?: string;
  utility_role?: any;
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

  // utility filter
  type UtilFilter = "" | "has_elec" | "has_water" | "has_lpg" | "missing";
  const [utilFilter, setUtilFilter] = useState<UtilFilter>("");

  // create/edit modals
  const [createVisible, setCreateVisible] = useState(false);
  const [formTenantId, setFormTenantId] = useState<string>("");
  const [f_erate, setF_erate] = useState<string>("");
  const [f_evat, setF_evat] = useState<string>("");
  const [f_emin, setF_emin] = useState<string>("");
  const [f_wmin, setF_wmin] = useState<string>("");
  const [f_wrate, setF_wrate] = useState<string>("");
  const [f_wnet, setF_wnet] = useState<string>("");
  const [f_wvat, setF_wvat] = useState<string>("");
  const [f_lpg, setF_lpg] = useState<string>("");

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
    [token],
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

        // 1) Always load all tenants (server scopes by role/building)
        // 2) Admin only: load buildings list
        const [tenantsRes, buildingsRes] = await Promise.all([
          api.get<Tenant[]>("/tenants"),
          isAdmin
            ? api.get<Building[]>("/buildings")
            : Promise.resolve({ data: [] as Building[] }),
        ]);

        setTenants(tenantsRes.data || []);
        if (isAdmin) setBuildings(buildingsRes.data || []);

        // Keep existing buildingId if set; otherwise lock or pick first building if admin
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
        const rRes = await api.get<Rate[]>(
          `/rates/buildings/${encodeURIComponent(buildingId)}`,
        );
        setRates(rRes.data || []);
      } catch (err: any) {
        notify("Load failed", errorText(err, "Server error."));
      } finally {
        setBusy(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId]);

  /** Derived lists */

  // Show ALL tenants in the dropdown (labels include building)
  const tenantOptionsAll = useMemo(() => {
    return tenants
      .slice()
      .sort((a, b) => {
        const byBldg = cmp(a.building_id, b.building_id);
        if (byBldg !== 0) return byBldg;
        return cmp(a.tenant_name || a.tenant_sn, b.tenant_name || b.tenant_sn);
      })
      .map((t) => ({
        label: `${t.tenant_name} (${t.tenant_id}) · ${t.building_id}`,
        value: t.tenant_id,
      }));
  }, [tenants]);

  // admin-only building options
  const buildingOptions = useMemo(() => {
    if (!isAdmin) return [];
    return buildings.map((b) => ({
      label: `${b.building_name} (${b.building_id})`,
      value: b.building_id,
    }));
  }, [isAdmin, buildings]);

  // filter + search for the rate list
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rates;

    if (utilFilter) {
      list = list.filter((r) => {
        const hasElec = r.erate_perKwH != null;
        const hasWater = r.wrate_perCbM != null;
        const hasLpg = r.lrate_perKg != null;

        switch (utilFilter) {
          case "has_elec":
            return hasElec;
          case "has_water":
            return hasWater;
          case "has_lpg":
            return hasLpg;
          case "missing":
            return !hasElec || !hasWater || !hasLpg;
          default:
            return true;
        }
      });
    }

    if (!q) return list;
    return list.filter((r) => {
      const tn = (r.tenant_name || "").toLowerCase();
      return (
        r.rate_id.toLowerCase().includes(q) ||
        r.tenant_id.toLowerCase().includes(q) ||
        tn.includes(q)
      );
    });
  }, [rates, query, utilFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "newest":
        return arr.sort(
          (a, b) =>
            (Date.parse(b.last_updated) || 0) -
            (Date.parse(a.last_updated) || 0),
        );
      case "oldest":
        return arr.sort(
          (a, b) =>
            (Date.parse(a.last_updated) || 0) -
            (Date.parse(b.last_updated) || 0),
        );
      case "idAsc":
        return arr.sort((a, b) => cmp(a.rate_id, b.rate_id));
      case "idDesc":
        return arr.sort((a, b) => cmp(b.rate_id, a.rate_id));
      case "tenantAsc":
        return arr.sort((a, b) =>
          cmp(a.tenant_name || a.tenant_id, b.tenant_name || b.tenant_id),
        );
      case "tenantDesc":
        return arr.sort((a, b) =>
          cmp(b.tenant_name || b.tenant_id, a.tenant_name || a.tenant_id),
        );
      default:
        return arr;
    }
  }, [filtered, sortMode]);

  /** Handlers */

  // When choosing a tenant in the create modal, auto-set buildingId to the tenant's building.
  const onSelectTenantForForm = (tenantId: string) => {
    setFormTenantId(tenantId);
    const t = tenants.find((x) => x.tenant_id === tenantId);
    if (t) {
      // Admin can switch buildings; operators/billers are already scoped
      setBuildingId((prev) => (isAdmin ? t.building_id : prev));
    }
  };

  /** Create or Update (PUT) */
  const onCreateOrUpdate = async () => {
    if (!formTenantId) {
      notify("Missing info", "Please select a tenant.");
      return;
    }
    // Use the tenant's actual building so the API path is always correct
    const t = tenants.find((x) => x.tenant_id === formTenantId);
    const targetBuildingId = t?.building_id || buildingId;
    if (!targetBuildingId) {
      notify(
        "Missing building",
        "Could not determine building for the selected tenant.",
      );
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
        `/rates/buildings/${encodeURIComponent(
          targetBuildingId,
        )}/tenants/${encodeURIComponent(formTenantId)}`,
        body,
      );
      const rid = res?.data?.rate_id ? ` (ID: ${res.data.rate_id})` : "";
      notify("Success", `${res?.data?.message || "Saved"}${rid}`);

      // clear numeric fields but keep tenant selection
      setF_erate("");
      setF_evat("");
      setF_emin("");
      setF_wmin("");
      setF_wrate("");
      setF_wnet("");
      setF_wvat("");
      setF_lpg("");

      // refresh list based on the actual building we wrote to
      const rRes = await api.get<Rate[]>(
        `/rates/buildings/${encodeURIComponent(targetBuildingId)}`,
      );
      setRates(rRes.data || []);
      setCreateVisible(false);

      // ensure the UI building matches the tenant's building after save
      if (isAdmin) setBuildingId(targetBuildingId);
    } catch (err: any) {
      notify("Save failed", errorText(err));
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
      // keep current buildingId context for edits
      await api.put(
        `/rates/buildings/${encodeURIComponent(
          buildingId,
        )}/tenants/${encodeURIComponent(editRow.tenant_id)}`,
        body,
      );
      setEditVisible(false);
      const rRes = await api.get<Rate[]>(
        `/rates/buildings/${encodeURIComponent(buildingId)}`,
      );
      setRates(rRes.data || []);
      notify("Updated", "Rate updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** UI */
  const RateRow = ({ item }: { item: Rate }) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>
          {item.tenant_name || item.tenant_id}
        </Text>
        <Text style={styles.rowSub}>
          {item.rate_id}
          {item.last_updated ? ` • ${fmtDate(item.last_updated)}` : ""}
          {item.updated_by ? ` • ${item.updated_by}` : ""}
        </Text>
      </View>
      <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
        <Text style={styles.linkText}>Update</Text>
      </TouchableOpacity>
    </View>
  );

  /** 🔧 NEW: ensure a real selection exists (RN Web Picker doesn’t emit change for the first item) */
  useEffect(() => {
    if (!formTenantId && tenantOptionsAll.length) {
      onSelectTenantForForm(tenantOptionsAll[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantOptionsAll.length]);

  return (
    <View style={styles.grid}>
      {/* Manage Rates */}
      <View style={styles.card}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <Text style={styles.cardTitle}>Manage Rates</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => {
              if (!formTenantId && tenantOptionsAll.length) {
                onSelectTenantForForm(tenantOptionsAll[0].value);
              }
              setCreateVisible(true);
            }}
          >
            <Text style={styles.btnText}>+ Create / Update</Text>
          </TouchableOpacity>
        </View>

        {/* Admin can choose building; operators/billers see their locked one */}
        <View style={styles.filtersBar}>
          <View style={styles.filterCol}>
            <Text style={styles.dropdownLabel}>Building</Text>
            {isAdmin ? (
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={buildingId}
                  onValueChange={(v) => setBuildingId(String(v))}
                  style={styles.picker}
                >
                  {buildingOptions.map((b) => (
                    <Picker.Item key={b.value} label={b.label} value={b.value} />
                  ))}
                </Picker>
              </View>
            ) : (
              <Text style={styles.lockedText}>
                {buildingId || "(no building assigned)"}
              </Text>
            )}
          </View>

          {/* Utility filter chips */}
          <View style={[styles.filterCol, styles.stackCol]}>
            <Text style={styles.dropdownLabel}>Utility filter</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "ALL", val: "" },
                { label: "ELECTRIC", val: "has_elec" },
                { label: "WATER", val: "has_water" },
                { label: "LPG", val: "has_lpg" },
                { label: "MISSING ANY", val: "missing" },
              ].map(({ label, val }) => (
                <TouchableOpacity
                  key={val || "all"}
                  style={[styles.chip, utilFilter === (val as any) && styles.chipActive]}
                  onPress={() => setUtilFilter(val as any)}
                >
                  <Text style={[styles.chipText, utilFilter === (val as any) && styles.chipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Sort */}
          <View style={[styles.filterCol, styles.stackCol]}>
            <Text style={styles.dropdownLabel}>Sort</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "Rate ID ↑", val: "idAsc" },
                { label: "Rate ID ↓", val: "idDesc" },
                { label: "Tenant ↑", val: "tenantAsc" },
                { label: "Tenant ↓", val: "tenantDesc" },
              ].map(({ label, val }) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.chip, sortMode === (val as any) && styles.chipActive]}
                  onPress={() => setSortMode(val as any)}
                >
                  <Text style={[styles.chipText, sortMode === (val as any) && styles.chipTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Search */}
        <TextInput
          style={styles.search}
          placeholder="Search by rate ID or tenant…"
          value={query}
          onChangeText={setQuery}
        />

        {/* List */}
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(r) => r.rate_id}
            style={{ marginTop: 4 }}
            ListEmptyComponent={<Text style={styles.empty}>No rates found.</Text>}
            renderItem={({ item }) => <RateRow item={item} />}
          />
        )}
      </View>

      {/* Create/Update Modal */}
      <Modal visible={createVisible} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create / Update Rate</Text>
            <View style={styles.modalDivider} />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {/* Tenant (ALL tenants shown, labeled with building) */}
              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Tenant</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={formTenantId}
                    onValueChange={(v) => onSelectTenantForForm(String(v))}
                    style={styles.picker}
                  >
                    {tenantOptionsAll.map((t) => (
                      <Picker.Item key={t.value} label={t.label} value={t.value} />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* If admin, show which building will be used (auto-updates after tenant selection) */}
              {isAdmin && (
                <View style={{ marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>
                    Target Building (auto from tenant)
                  </Text>
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={buildingId}
                      onValueChange={(v) => setBuildingId(String(v))}
                      style={styles.picker}
                    >
                      {buildingOptions.map((b) => (
                        <Picker.Item key={b.value} label={b.label} value={b.value} />
                      ))}
                    </Picker>
                  </View>
                </View>
              )}

              {/* Electric */}
              <Text style={styles.sectionLabel}>Electric</Text>
              <TextInput
                style={styles.input}
                placeholder="Rate per kWh (erate_perKwH)"
                keyboardType="decimal-pad"
                value={f_erate}
                onChangeText={setF_erate}
              />
              <TextInput
                style={styles.input}
                placeholder="VAT (e_vat) e.g. 0.12"
                keyboardType="decimal-pad"
                value={f_evat}
                onChangeText={setF_evat}
              />
              <TextInput
                style={styles.input}
                placeholder="Minimum consumption (emin_con)"
                keyboardType="decimal-pad"
                value={f_emin}
                onChangeText={setF_emin}
              />

              {/* Water */}
              <Text style={styles.sectionLabel}>Water</Text>
              <TextInput
                style={styles.input}
                placeholder="Minimum consumption (wmin_con)"
                keyboardType="decimal-pad"
                value={f_wmin}
                onChangeText={setF_wmin}
              />
              <TextInput
                style={styles.input}
                placeholder="Rate per m³ (wrate_perCbM)"
                keyboardType="decimal-pad"
                value={f_wrate}
                onChangeText={setF_wrate}
              />
              <TextInput
                style={styles.input}
                placeholder="Net VAT factor (wnet_vat) e.g. 0.88"
                keyboardType="decimal-pad"
                value={f_wnet}
                onChangeText={setF_wnet}
              />
              <TextInput
                style={styles.input}
                placeholder="VAT (w_vat) e.g. 0.12"
                keyboardType="decimal-pad"
                value={f_wvat}
                onChangeText={setF_wvat}
              />

              {/* LPG */}
              <Text style={styles.sectionLabel}>LPG</Text>
              <TextInput
                style={styles.input}
                placeholder="Rate per Kg (lrate_perKg)"
                keyboardType="decimal-pad"
                value={f_lpg}
                onChangeText={setF_lpg}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setCreateVisible(false)}
                style={[styles.btn, styles.btnGhost]}
              >
                <Text style={[styles.btnText, styles.btnGhostText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onCreateOrUpdate}
                style={[styles.btn, submitting && styles.btnDisabled]}
                disabled={submitting}
              >
                <Text style={styles.btnText}>
                  {submitting ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={editVisible} animationType="fade" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Update Rate</Text>
            <View style={styles.modalDivider} />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              <Text style={styles.readonly}>
                Tenant: {editRow?.tenant_name || editRow?.tenant_id}
              </Text>

              <Text style={styles.sectionLabel}>Electric</Text>
              <TextInput
                style={styles.input}
                placeholder="Rate per kWh (erate_perKwH)"
                keyboardType="decimal-pad"
                value={e_erate}
                onChangeText={setE_erate}
              />
              <TextInput
                style={styles.input}
                placeholder="VAT (e_vat)"
                keyboardType="decimal-pad"
                value={e_evat}
                onChangeText={setE_evat}
              />
              <TextInput
                style={styles.input}
                placeholder="Minimum consumption (emin_con)"
                keyboardType="decimal-pad"
                value={e_emin}
                onChangeText={setE_emin}
              />

              <Text style={styles.sectionLabel}>Water</Text>
              <TextInput
                style={styles.input}
                placeholder="Minimum consumption (wmin_con)"
                keyboardType="decimal-pad"
                value={e_wmin}
                onChangeText={setE_wmin}
              />
              <TextInput
                style={styles.input}
                placeholder="Rate per m³ (wrate_perCbM)"
                keyboardType="decimal-pad"
                value={e_wrate}
                onChangeText={setE_wrate}
              />
              <TextInput
                style={styles.input}
                placeholder="Net VAT factor (wnet_vat)"
                keyboardType="decimal-pad"
                value={e_wnet}
                onChangeText={setE_wnet}
              />
              <TextInput
                style={styles.input}
                placeholder="VAT (w_vat)"
                keyboardType="decimal-pad"
                value={e_wvat}
                onChangeText={setE_wvat}
              />

              <Text style={styles.sectionLabel}>LPG</Text>
              <TextInput
                style={styles.input}
                placeholder="Rate per Kg (lrate_perKg)"
                keyboardType="decimal-pad"
                value={e_lpg}
                onChangeText={setE_lpg}
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setEditVisible(false)}
                style={[styles.btn, styles.btnGhost]}
              >
                <Text style={[styles.btnText, styles.btnGhostText]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onUpdate}
                style={[styles.btn, submitting && styles.btnDisabled]}
                disabled={submitting}
              >
                <Text style={styles.btnText}>
                  {submitting ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

/** Styles */
const styles = StyleSheet.create({
  grid: {
    padding: 10,
    gap: 10,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    ...(Platform.select({
      web: { boxShadow: "0 10px 30px rgba(0,0,0,0.05)" as any },
      default: { elevation: 2 },
    }) as any),
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43",
  },
  filtersBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
    marginBottom: 6,
  },
  filterCol: {
    minWidth: 220,
    flexShrink: 0,
  },
  stackCol: {
    minWidth: 260,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#cbd2d9",
    backgroundColor: "#fff",
  },
  chipActive: {
    backgroundColor: "#082cac",
    borderColor: "#082cac",
  },
  chipText: { color: "#102a43", fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: "#fff" },

  dropdownLabel: {
    fontSize: 12,
    color: "#627d98",
    marginBottom: 4,
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 8,
    overflow: "hidden",
  },
  picker: { height: 40 },

  lockedText: {
    paddingVertical: 10,
    fontSize: 14,
    color: "#102a43",
  },

  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
  },

  loader: { padding: 20, alignItems: "center" },
  empty: { color: "#627d98", padding: 12 },

  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f4f8",
    flexDirection: "row",
    alignItems: "center",
  },
  rowTitle: { fontSize: 14, fontWeight: "700", color: "#102a43" },
  rowSub: { fontSize: 12, color: "#627d98", marginTop: 2 },

  link: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6 },
  linkText: { color: "#1f73b7", fontWeight: "700" },

  btn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cbd2d9",
  },
  btnGhostText: { color: "#102a43" },
  btnDisabled: { opacity: 0.6 },

  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "center",
    padding: 12,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    maxHeight: "90%",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#102a43",
    marginBottom: 4,
  },
  modalDivider: {
    height: 1,
    backgroundColor: "#edf2f7",
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
  },

  sectionLabel: {
    marginTop: 10,
    marginBottom: 4,
    fontWeight: "800",
    color: "#243b53",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
  },
  readonly: {
    paddingVertical: 6,
    color: "#486581",
  },
});