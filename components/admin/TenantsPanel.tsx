// components/admin/TenantsPanel.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  useWindowDimensions,
} from "react-native";
import axios from "axios";
import { Picker } from "@react-native-picker/picker";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";
import { Card, Button, Input, ModalSheet, tokens } from "../ui/ProUI";

/** ------------ Types ------------- */
type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  tenant_status: "active" | "inactive";
  vat_code: string | null;
  wt_code: string | null;
  for_penalty: boolean;
  last_updated?: string;
  updated_by?: string;
};
type Building = { building_id: string; building_name: string };
type BuildingBaseRates = {
  building_id: string;
  erate_perKwH: number | null;
  emin_con: number | null;
  wrate_perCbM: number | null;
  wmin_con: number | null;
  lrate_perKg: number | null;
  last_updated?: string;
  updated_by?: string;
};
type Stall = {
  stall_id: string;
  stall_sn: string;
  building_id: string;
  tenant_id: string | null;
  stall_status: "available" | "occupied" | "maintenance" | string;
  last_updated?: string;
  updated_by?: string;
};
type VatRow = { tax_id: string | number; vat_code: string; vat_description?: string | null };
type WtRow  = { wt_id: string; wt_code: string; wt_description?: string | null };

/** ------------ Utils ------------- */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });

function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1] || "";
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
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
  } catch { return null; }
}

function notify(title: string, message?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert)
    window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
function errorText(err: any, fallback = "Server error.") {
  const d = err?.response?.data;
  if (typeof d === "string") return d;
  if (d?.error) return String(d.error);
  if (d?.message) return String(d.message);
  if (err?.message) return String(err.message);
  try { return JSON.stringify(d ?? err); } catch { return fallback; }
}
const fmt = (n: number | null | undefined, unit?: string) => {
  if (n == null || !isFinite(Number(n))) return "—";
  const out = Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(n));
  return unit ? `${out} ${unit}` : out;
};

/** Heights for modal sheet inner scrollers */
const H = Dimensions.get("window").height;
const FOOTER_H = 68, HEADER_H = 56, V_MARGIN = 24;
const MOBILE_MODAL_MAX_HEIGHT = Math.round(H - (FOOTER_H + HEADER_H + V_MARGIN));

/** Local Chip (matches StallsPanel look) */
const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
    <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
  </TouchableOpacity>
);

/** Styled Picker for sheets */
function PickerField({
  label, value, onChange, children, placeholder, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  children: React.ReactNode; placeholder?: string; disabled?: boolean;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.pickerShell, disabled && { opacity: 0.6 }]}>
        <Picker
          enabled={!disabled}
          selectedValue={value}
          onValueChange={(v) => onChange(String(v))}
          mode={Platform.OS === "android" ? "dropdown" : undefined}
          dropdownIconColor={tokens.color.ink}
          style={styles.pickerNative}
          itemStyle={styles.pickerItemIOS}
          prompt={label}
        >
          {placeholder ? <Picker.Item label={placeholder} value="" /> : null}
          {children}
        </Picker>
        <Ionicons name="chevron-down" size={16} color={tokens.color.ink} style={styles.pickerIcon} />
      </View>
    </View>
  );
}

/** ------------ Component ------------- */
export default function TenantsPanel({ token }: { token: string | null }) {
  const { token: ctxToken } = useAuth();
  const mergedToken = token || ctxToken || null;
  const jwt = useMemo(() => decodeJwtPayload(mergedToken), [mergedToken]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const authHeader = useMemo(() => ({ Authorization: `Bearer ${mergedToken ?? ""}` }), [mergedToken]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  // data
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [vatCodes, setVatCodes] = useState<VatRow[]>([]);
  const [wtCodes, setWtCodes] = useState<WtRow[]>([]);

  // list filters (copied from StallsPanel UX)
  const [query, setQuery] = useState("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");
  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // mobile building picker
  const [buildingPickerVisible, setBuildingPickerVisible] = useState(false);

  // Quick Edit modal sheet
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsTenant, setDetailsTenant] = useState<Tenant | null>(null);
  const [tenantDraft, setTenantDraft] = useState<Tenant | null>(null);
  const [bRates, setBRates] = useState<BuildingBaseRates | null>(null);
  const [tenantStalls, setTenantStalls] = useState<Stall[]>([]);
  const [stallsBusy, setStallsBusy] = useState(false);

  // Create Tenant sheet
  const [createVisible, setCreateVisible] = useState(false);
  const [cBuildingId, setCBuildingId] = useState<string>("");
  const [cTenantSn, setCTenantSn] = useState<string>("");
  const [cTenantName, setCTenantName] = useState<string>("");
  const [cStatus, setCStatus] = useState<"active" | "inactive">("active");
  const [cPenalty, setCPenalty] = useState<boolean>(false);
  const [cVat, setCVat] = useState<string>("");
  const [cWt, setCWt] = useState<string>("");

  /** load data */
  useEffect(() => { loadAll(); /* eslint-disable react-hooks/exhaustive-deps */ }, [mergedToken, statusFilter]);
  const loadAll = async () => {
    if (!mergedToken) { setBusy(false); notify("Not logged in", "Please log in to view tenants."); return; }
    try {
      setBusy(true);

      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const tRes = await api.get<Tenant[]>("/tenants", { params });
      setTenants((tRes.data || []).map((t: any) => ({
        ...t,
        vat_code: t.vat_code ?? null,
        wt_code: t.wt_code ?? null,
        for_penalty: !!t.for_penalty,
      })));

      try { const bRes = await api.get<Building[]>("/buildings"); setBuildings(bRes.data || []); }
      catch { setBuildings([]); }

      setBuildingFilter((prev) => prev || (!isAdmin && userBuildingId) || "");
      setCBuildingId((!isAdmin && userBuildingId) || "");

      try {
        const [vRes, wRes] = await Promise.all([api.get<VatRow[]>("/vat"), api.get<WtRow[]>("/wt")]);
        setVatCodes(vRes.data || []); setWtCodes(wRes.data || []);
      } catch { setVatCodes([]); setWtCodes([]); }
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally { setBusy(false); }
  };

  /** derived list (like StallsPanel) */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tenants;
    if (buildingFilter) list = list.filter((t) => t.building_id === buildingFilter);
    if (statusFilter) list = list.filter((t) => t.tenant_status === statusFilter);
    if (!q) return list;
    return list.filter((t) =>
      [t.tenant_id, t.tenant_sn, t.tenant_name, t.building_id, t.tenant_status, t.vat_code ?? "", t.wt_code ?? ""]
        .map((v) => String(v).toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [tenants, query, buildingFilter, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dateOf = (t: Tenant) => Date.parse(t.last_updated || "") || 0;
    switch (sortMode) {
      case "newest": return arr.sort((a, b) => dateOf(b) - dateOf(a));
      case "oldest": return arr.sort((a, b) => dateOf(a) - dateOf(b));
      case "idAsc":  return arr.sort((a, b) => cmp(a.tenant_id, b.tenant_id));
      case "idDesc": return arr.sort((a, b) => cmp(b.tenant_id, a.tenant_id));
      default: return arr;
    }
  }, [filtered, sortMode]);

  /** helpers */
  const buildingName = (id: string) => {
    const b = buildings.find((x) => x.building_id === id);
    return b ? `${b.building_name} (${b.building_id})` : id;
  };

  /** quick-edit open / save / delete */
  const openDetails = async (row: Tenant) => {
    setDetailsTenant(row);
    setTenantDraft({ ...row });
    setBRates(null);
    setTenantStalls([]);
    setDetailsVisible(true);

    try {
      const bRes = await api.get<BuildingBaseRates>(`/buildings/${encodeURIComponent(row.building_id)}/base-rates`);
      setBRates(bRes.data);
    } catch { setBRates(null); }

    try {
      setStallsBusy(true);
      const sRes = await api.get<Stall[]>(`/stalls`);
      setTenantStalls((sRes.data || []).filter((s) => s.tenant_id === row.tenant_id));
    } catch { setTenantStalls([]); } finally { setStallsBusy(false); }
  };

  const saveTenant = async () => {
    if (!tenantDraft) return;
    try {
      setSubmitting(true);
      await api.put(`/tenants/${encodeURIComponent(tenantDraft.tenant_id)}`, {
        tenant_sn: tenantDraft.tenant_sn,
        tenant_name: tenantDraft.tenant_name,
        tenant_status: tenantDraft.tenant_status,
        vat_code: tenantDraft.vat_code ?? null,
        wt_code: tenantDraft.wt_code ?? null,
        for_penalty: !!tenantDraft.for_penalty,
      });
      notify("Saved", "Tenant updated.");
      await loadAll();
      setDetailsVisible(false);
    } catch (err) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteTenant = async (t: Tenant) => {
    const go = async () => {
      try {
        setSubmitting(true);
        await api.delete(`/tenants/${encodeURIComponent(t.tenant_id)}`);
        notify("Deleted", `Tenant ${t.tenant_name} removed.`);
        setDetailsVisible(false);
        await loadAll();
      } catch (err) {
        notify("Delete failed", errorText(err, "Unable to delete tenant."));
      } finally {
        setSubmitting(false);
      }
    };

    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(`Delete ${t.tenant_name} (${t.tenant_id})?`)) go();
    } else {
      Alert.alert("Confirm delete", `Delete ${t.tenant_name}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: go },
      ]);
    }
  };

  const saveStall = async (s: Stall) => {
    try {
      setSubmitting(true);
      await api.put(`/stalls/${encodeURIComponent(s.stall_id)}`, {
        stall_sn: s.stall_sn,
        stall_status: s.stall_status,
        tenant_id: s.tenant_id,
      });
      notify("Stall updated", `${s.stall_id} saved.`);
    } catch (err) {
      notify("Stall save failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };
  const unassignStall = async (s: Stall) => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (!window.confirm(`Remove ${s.stall_id} from this tenant?`)) return;
    }
    try {
      setSubmitting(true);
      await api.put(`/stalls/${encodeURIComponent(s.stall_id)}`, {
        stall_sn: s.stall_sn,
        stall_status: "available",
        tenant_id: null,
      });
      setTenantStalls((prev) => prev.filter((x) => x.stall_id !== s.stall_id));
      notify("Unassigned", `${s.stall_id} is now available.`);
    } catch (err) {
      notify("Unassign failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** ---------- UI (copied structure from StallsPanel) ---------- */
  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.page}>
      <View style={styles.grid}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Tenants</Text>
            <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
              <Text style={styles.btnText}>+ Create Tenant</Text>
            </TouchableOpacity>
          </View>

          {/* Toolbar: Search + Filters button */}
          <View style={styles.filtersBar}>
            <View style={[styles.searchWrap, { flex: 1 }]}>
              <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by ID, SN, name, VAT/WT…"
                placeholderTextColor="#9aa5b1"
                style={styles.search}
              />
            </View>

            <TouchableOpacity style={styles.btnGhost} onPress={() => setFiltersVisible(true)}>
              <Ionicons name="options-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
              <Text style={styles.btnGhostText}>Filters</Text>
            </TouchableOpacity>
          </View>

          {/* Building filter (chips below search) + mobile quick select */}
          <View style={{ marginTop: 6, marginBottom: 15 }}>
            <View style={styles.buildingHeaderRow}>
              <Text style={styles.dropdownLabel}>Building</Text>
            </View>

            {isMobile ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRowHorizontal}>
                <Chip label="All" active={buildingFilter === ""} onPress={() => setBuildingFilter("")} />
                {(isAdmin ? buildings : buildings.filter((b) => b.building_id === userBuildingId))
                  .slice()
                  .sort((a, b) => a.building_name.localeCompare(b.building_name))
                  .map((b) => (
                    <Chip
                      key={b.building_id}
                      label={b.building_name || b.building_id}
                      active={buildingFilter === b.building_id}
                      onPress={() => setBuildingFilter(b.building_id)}
                    />
                  ))}
              </ScrollView>
            ) : (
              <View style={styles.chipsRow}>
                <Chip label="All" active={buildingFilter === ""} onPress={() => setBuildingFilter("")} />
                {(isAdmin ? buildings : buildings.filter((b) => b.building_id === userBuildingId))
                  .slice()
                  .sort((a, b) => a.building_name.localeCompare(b.building_name))
                  .map((b) => (
                    <Chip
                      key={b.building_id}
                      label={b.building_name || b.building_id}
                      active={buildingFilter === b.building_id}
                      onPress={() => setBuildingFilter(b.building_id)}
                    />
                  ))}
              </View>
            )}
          </View>

          {/* LIST — FlatList is the ONLY vertical scroller */}
          {busy ? (
            <View style={styles.loader}><ActivityIndicator /></View>
          ) : (
            <FlatList
              data={sorted}
              keyExtractor={(item) => item.tenant_id}
              style={{ flex: 1 }}
              contentContainerStyle={sorted.length === 0 ? styles.emptyPad : { paddingBottom: 24 }}
              ListEmptyComponent={<Text style={styles.empty}>No tenants found.</Text>}
              renderItem={({ item }) => (
                <View style={[styles.row, isMobile && styles.rowMobile]}>
                  {/* Main details */}
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>
                      {item.tenant_name} <Text style={styles.rowSub}>({item.tenant_id})</Text>
                    </Text>
                    <Text style={styles.rowMeta}>
                      SN: {item.tenant_sn || "—"} · {buildingName(item.building_id)}
                    </Text>
                    <Text style={styles.rowMetaSmall}>
                      Status: {item.tenant_status.toUpperCase()} · VAT: {item.vat_code || "—"} · WT: {item.wt_code || "—"} · Penalty: {item.for_penalty ? "Yes" : "No"}
                    </Text>
                  </View>

                  {/* Actions (desktop right; mobile below) */}
                  {isMobile ? (
                    <View style={styles.rowActionsMobile}>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionEdit]} onPress={() => openDetails(item)}>
                        <Ionicons name="create-outline" size={16} color="#1f2937" />
                        <Text style={[styles.actionText, styles.actionEditText]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={() => deleteTenant(item)}>
                        <Ionicons name="trash-outline" size={16} color="#fff" />
                        <Text style={[styles.actionText, styles.actionDeleteText]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.rowActions}>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionEdit]} onPress={() => openDetails(item)}>
                        <Ionicons name="create-outline" size={16} color="#1f2937" />
                        <Text style={[styles.actionText, styles.actionEditText]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionDelete]} onPress={() => deleteTenant(item)}>
                        <Ionicons name="trash-outline" size={16} color="#fff" />
                        <Text style={[styles.actionText, styles.actionDeleteText]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
            />
          )}
        </View>
      </View>

      {/* FILTERS modal (status + sort; building chips live under search) */}
      <ModalSheet
        visible={filtersVisible}
        title="Filters & Sort"
        onClose={() => setFiltersVisible(false)}
        footer={
          <>
            <Button
              variant="ghost"
              onPress={() => { setQuery(""); setStatusFilter(""); setSortMode("newest"); }}
            >
              Reset
            </Button>
            <Button onPress={() => setFiltersVisible(false)}>Apply</Button>
          </>
        }
      >
        <Text style={styles.dropdownLabel}>Status</Text>
        <View style={styles.chipsRow}>
          <Chip label="All" active={statusFilter === ""} onPress={() => setStatusFilter("")} />
          <Chip label="Active" active={statusFilter === "active"} onPress={() => setStatusFilter("active")} />
          <Chip label="Inactive" active={statusFilter === "inactive"} onPress={() => setStatusFilter("inactive")} />
        </View>

        <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Sort by</Text>
        <View style={styles.chipsRow}>
          <Chip label="Newest" active={sortMode === "newest"} onPress={() => setSortMode("newest")} />
          <Chip label="Oldest" active={sortMode === "oldest"} onPress={() => setSortMode("oldest")} />
          <Chip label="ID ↑"   active={sortMode === "idAsc"}  onPress={() => setSortMode("idAsc")} />
          <Chip label="ID ↓"   active={sortMode === "idDesc"} onPress={() => setSortMode("idDesc")} />
        </View>
      </ModalSheet>

      {/* MOBILE building picker (user-friendly for long building lists) */}
      <ModalSheet
        visible={buildingPickerVisible}
        title="Select Building"
        onClose={() => setBuildingPickerVisible(false)}
        footer={<Button onPress={() => setBuildingPickerVisible(false)}>Done</Button>}
      >
        <View style={styles.pickerShell}>
          <Picker
            selectedValue={buildingFilter}
            onValueChange={(v) => setBuildingFilter(String(v))}
            mode={Platform.OS === "android" ? "dropdown" : undefined}
            dropdownIconColor={tokens.color.ink}
            style={styles.pickerNative}
            itemStyle={styles.pickerItemIOS}
          >
            <Picker.Item label="All" value="" />
            {(isAdmin ? buildings : buildings.filter((b) => b.building_id === userBuildingId))
              .map((b) => (
                <Picker.Item key={b.building_id} label={`${b.building_name} (${b.building_id})`} value={b.building_id} />
              ))}
          </Picker>
          <Ionicons name="chevron-down" size={16} color={tokens.color.ink} style={styles.pickerIcon} />
        </View>
      </ModalSheet>

      {/* QUICK EDIT SHEET */}
      <ModalSheet
        visible={detailsVisible}
        title={detailsTenant ? `Quick Edit • ${detailsTenant.tenant_name}` : "Quick Edit"}
        onClose={() => setDetailsVisible(false)}
        footer={
          <>
            <Button
              variant="danger"
              icon="trash-outline"
              onPress={() => detailsTenant && deleteTenant(detailsTenant)}
              disabled={submitting}
            >
              {submitting ? "Deleting…" : "Delete"}
            </Button>
            <Button variant="ghost" onPress={() => setDetailsVisible(false)}>Close</Button>
            <Button icon="save-outline" onPress={saveTenant} disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <SafeAreaView style={{ width: "100%" }}>
          <View style={styles.sheetBody}>
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              <View style={styles.quickGrid}>
                {/* LEFT column: Tenant & Taxes */}
                <View style={styles.quickCol}>
                  <Card title="Tenant">
                    <View style={{ gap: 10 }}>
                      <View>
                        <Text style={styles.fieldLabel}>Tenant SN</Text>
                        <Input
                          placeholder="e.g., SN-001"
                          value={tenantDraft?.tenant_sn || ""}
                          onChangeText={(v) => setTenantDraft((t) => (t ? { ...t, tenant_sn: v } : t))}
                        />
                      </View>

                      <View>
                        <Text style={styles.fieldLabel}>Tenant Name</Text>
                        <Input
                          placeholder="Tenant name"
                          value={tenantDraft?.tenant_name || ""}
                          onChangeText={(v) => setTenantDraft((t) => (t ? { ...t, tenant_name: v } : t))}
                        />
                      </View>

                      <View style={styles.rowInline}>
                        <View style={[styles.flex1, { marginRight: 8 }]}>
                          <PickerField
                            label="Status"
                            value={tenantDraft?.tenant_status || "active"}
                            onChange={(v) => setTenantDraft((t) => (t ? { ...t, tenant_status: v as "active" | "inactive" } : t))}
                          >
                            <Picker.Item label="Active" value="active" />
                            <Picker.Item label="Inactive" value="inactive" />
                          </PickerField>
                        </View>

                        <View style={[styles.flex1, { marginLeft: 8 }]}>
                          <Text style={styles.fieldLabel}>Penalty</Text>
                          <Button
                            variant="ghost"
                            icon={tenantDraft?.for_penalty ? "checkbox" : "square-outline" as any}
                            onPress={() => setTenantDraft((t) => (t ? { ...t, for_penalty: !t.for_penalty } : t))}
                          >
                            {tenantDraft?.for_penalty ? "For penalty" : "No penalty"}
                          </Button>
                        </View>
                      </View>

                      <View>
                        <Text style={styles.fieldLabel}>Building (read-only)</Text>
                        <View style={styles.readonlyBox}>
                          <Text style={styles.readonlyText}>
                            {detailsTenant ? buildingName(detailsTenant.building_id) : "—"}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Card>

                  <Card title="Taxes" style={{ marginTop: 12 }}>
                    <View style={{ gap: 10 }}>
                      <PickerField
                        label="VAT Code"
                        value={tenantDraft?.vat_code ?? ""}
                        onChange={(v) => setTenantDraft((t) => (t ? { ...t, vat_code: v || null } : t))}
                        placeholder="— None —"
                      >
                        {vatCodes.map((v) => (
                          <Picker.Item
                            key={String(v.tax_id)}
                            label={`${v.vat_code}${v.vat_description ? ` — ${v.vat_description}` : ""}`}
                            value={v.vat_code}
                          />
                        ))}
                      </PickerField>

                      <PickerField
                        label="Withholding Code"
                        value={tenantDraft?.wt_code ?? ""}
                        onChange={(v) => setTenantDraft((t) => (t ? { ...t, wt_code: v || null } : t))}
                        placeholder="— None —"
                      >
                        {wtCodes.map((w) => (
                          <Picker.Item
                            key={w.wt_id}
                            label={`${w.wt_code}${w.wt_description ? ` — ${w.wt_description}` : ""}`}
                            value={w.wt_code}
                          />
                        ))}
                      </PickerField>
                    </View>
                  </Card>
                </View>

                {/* RIGHT column: Building & Stalls */}
                <View style={styles.quickCol}>
                  <Card title="Building">
                    <Text style={styles.kv}><Text style={styles.kvKey}>ID:</Text> {detailsTenant?.building_id || "—"}</Text>
                    <Text style={styles.kv}>
                      <Text style={styles.kvKey}>Name:</Text>{" "}
                      {detailsTenant ? buildingName(detailsTenant.building_id).replace(` (${detailsTenant.building_id})`, "") : "—"}
                    </Text>
                  </Card>

                  <Card title="Base Rates (Read-only)" style={{ marginTop: 12 }}>
                    <Text style={styles.kv}><Text style={styles.kvKey}>Electric Rate:</Text> {fmt(bRates?.erate_perKwH, "per kWh")}</Text>
                    <Text style={styles.kv}><Text style={styles.kvKey}>Electric Min:</Text> {fmt(bRates?.emin_con, "kWh")}</Text>
                    <Text style={styles.kv}><Text style={styles.kvKey}>Water Rate:</Text> {fmt(bRates?.wrate_perCbM, "per cu.m")}</Text>
                    <Text style={styles.kv}><Text style={styles.kvKey}>Water Min:</Text> {fmt(bRates?.wmin_con, "cu.m")}</Text>
                    <Text style={styles.kv}><Text style={styles.kvKey}>LPG Rate:</Text> {fmt(bRates?.lrate_perKg, "per kg")}</Text>
                  </Card>

                  <Card
                    title="Stalls"
                    right={stallsBusy ? <ActivityIndicator /> : undefined}
                    style={{ marginTop: 12 }}
                  >
                    {stallsBusy ? null : tenantStalls.length === 0 ? (
                      <Text style={styles.empty}>No stalls assigned.</Text>
                    ) : (
                      tenantStalls.map((s) => (
                        <View key={s.stall_id} style={styles.stallRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle}>
                              {s.stall_sn} <Text style={styles.rowSub}>({s.stall_id})</Text>
                            </Text>
                            <Text style={styles.rowMetaSmall}>Status: {String(s.stall_status).toUpperCase()}</Text>
                          </View>

                          <Button variant="ghost" onPress={() => unassignStall(s)}>Unassign</Button>
                          <Button onPress={() => saveStall(s)}>Save</Button>
                        </View>
                      ))
                    )}
                  </Card>
                </View>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </ModalSheet>

      {/* CREATE TENANT SHEET */}
      <ModalSheet
        visible={createVisible}
        title="Create Tenant"
        onClose={() => setCreateVisible(false)}
        footer={
          <>
            <Button variant="ghost" onPress={() => setCreateVisible(false)}>Cancel</Button>
            <Button
              icon="save-outline"
              onPress={async () => {
                if (!isAdmin && !userBuildingId) { notify("Building required", "Your account is missing a building assignment."); return; }
                const building_id = isAdmin ? (cBuildingId || userBuildingId) : userBuildingId;
                if (!building_id) { notify("Building required", "Please choose a building."); return; }
                if (!cTenantName.trim()) { notify("Missing name", "Please enter tenant name."); return; }

                try {
                  setSubmitting(true);
                  await api.post("/tenants", {
                    tenant_sn: cTenantSn.trim() || null,
                    tenant_name: cTenantName.trim(),
                    building_id,
                    tenant_status: cStatus,
                    vat_code: cVat || null,
                    wt_code: cWt || null,
                    for_penalty: !!cPenalty,
                  });
                  setCreateVisible(false);
                  setCTenantSn(""); setCTenantName(""); setCStatus("active"); setCPenalty(false); setCVat(""); setCWt("");
                  await loadAll();
                  notify("Created", "Tenant created successfully.");
                } catch (err) {
                  notify("Create failed", errorText(err, "Unable to create tenant."));
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Create"}
            </Button>
          </>
        }
      >
        <View style={{ gap: 12 }}>
          <View style={styles.rowInline}>
            <View style={[styles.flex1, { marginRight: 8 }]}>
              <PickerField
                label="Building"
                value={isAdmin ? cBuildingId : userBuildingId}
                onChange={setCBuildingId}
                disabled={!isAdmin}
                placeholder={isAdmin ? "Select building…" : undefined}
              >
                {(isAdmin ? buildings : buildings.filter(b => b.building_id === userBuildingId)).map((b) => (
                  <Picker.Item key={b.building_id} label={`${b.building_name} (${b.building_id})`} value={b.building_id} />
                ))}
              </PickerField>
            </View>

            <View style={[styles.flex1, { marginLeft: 8 }]}>
              <PickerField label="Status" value={cStatus} onChange={(v) => setCStatus(v as any)}>
                <Picker.Item label="Active" value="active" />
                <Picker.Item label="Inactive" value="inactive" />
              </PickerField>
            </View>
          </View>

          <View style={styles.rowInline}>
            <View style={[styles.flex1, { marginRight: 8 }]}>
              <Text style={styles.fieldLabel}>Tenant SN</Text>
              <Input placeholder="e.g., SN-001" value={cTenantSn} onChangeText={setCTenantSn} />
            </View>
            <View style={[styles.flex1, { marginLeft: 8 }]}>
              <Text style={styles.fieldLabel}>Tenant Name</Text>
              <Input placeholder="Tenant name" value={cTenantName} onChangeText={setCTenantName} />
            </View>
          </View>

          <View style={styles.rowInline}>
            <View style={[styles.flex1, { marginRight: 8 }]}>
              <PickerField label="VAT Code" value={cVat} onChange={setCVat} placeholder="— None —">
                {vatCodes.map((v) => (
                  <Picker.Item key={String(v.tax_id)} label={`${v.vat_code}${v.vat_description ? ` — ${v.vat_description}` : ""}`} value={v.vat_code} />
                ))}
              </PickerField>
            </View>
            <View style={[styles.flex1, { marginLeft: 8 }]}>
              <PickerField label="Withholding Code" value={cWt} onChange={setCWt} placeholder="— None —">
                {wtCodes.map((w) => (
                  <Picker.Item key={w.wt_id} label={`${w.wt_code}${w.wt_description ? ` — ${w.wt_description}` : ""}`} value={w.wt_code} />
                ))}
              </PickerField>
            </View>
          </View>

          <View style={{ marginTop: 6 }}>
            <Text style={styles.fieldLabel}>Penalty</Text>
            <Button
              variant="ghost"
              icon={cPenalty ? "checkbox" : "square-outline" as any}
              onPress={() => setCPenalty((v) => !v)}
            >
              {cPenalty ? "For penalty" : "No penalty"}
            </Button>
          </View>

          <Text style={styles.helpText}>You can assign stalls from the Stalls/Assign panel after creating the tenant.</Text>
        </View>
      </ModalSheet>
    </KeyboardAvoidingView>
  );
}

/** ------------ Styles (copied look from StallsPanel) ------------- */
const styles = StyleSheet.create({
  // outer layout so FlatList can scroll
  page: { flex: 1, minHeight: 0 },
  grid: { flex: 1, padding: 14, gap: 14, minHeight: 0 },
  card: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    ...(Platform.select({
      web: { boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)" } as any,
      default: { elevation: 2 },
    }) as any),
  },

  // header + toolbar
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },

  btn: { backgroundColor: "#2563eb", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },

  filtersBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  search: { flex: 1, height: 40, color: "#0f172a" },
  btnGhost: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  btnGhostText: { color: "#394e6a", fontWeight: "700" },

  // Building filter header row (label + mobile "Select" button)
  buildingHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  quickSelectBtn: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#e0ecff", borderColor: "#93c5fd", borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  quickSelectText: { color: "#1d4ed8", fontWeight: "800", letterSpacing: 0.3, fontSize: 12 },

  // Chips (desktop/tablet wrap)
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  // Chips (mobile horizontal scroll)
  chipsRowHorizontal: {
    paddingRight: 4,
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#f8fafc",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: { backgroundColor: "#e0ecff", borderColor: "#93c5fd" },
  chipIdle: {},
  chipText: { fontWeight: "700" },
  chipTextActive: { color: "#1d4ed8" },
  chipTextIdle: { color: "#334155" },

  // row item (matches StallsPanel)
  row: {
    borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 12, padding: 12, marginBottom: 10,
    backgroundColor: "#fff", flexDirection: "row", alignItems: "center",
  },
  rowMobile: { flexDirection: "column", alignItems: "stretch" },
  rowMain: { flex: 1, paddingRight: 10 },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontWeight: "600" },
  rowMeta: { color: "#334155", marginTop: 6 },
  rowMetaSmall: { color: "#94a3b8", marginTop: 2, fontSize: 12 },

  rowActions: { width: 200, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  rowActionsMobile: { flexDirection: "row", gap: 8, marginTop: 10, justifyContent: "flex-start", alignItems: "center" },

  actionBtn: {
    height: 36, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6,
  },
  actionEdit: { backgroundColor: "#e2e8f0" },
  actionDelete: { backgroundColor: "#ef4444" },
  actionText: { fontWeight: "700" },
  actionEditText: { color: "#1f2937" },
  actionDeleteText: { color: "#fff" },

  // empty + loader
  loader: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },
  emptyPad: { paddingVertical: 30 },
  empty: { paddingVertical: 12, textAlign: "center", color: "#64748b" },

  // modal sheet helpers
  fieldLabel: { fontSize: 12, color: tokens.color.inkSubtle, marginBottom: 6, fontWeight: "700" },
  rowInline: { flexDirection: "row", alignItems: "center" },
  flex1: { flex: 1 },
  readonlyBox: {
    height: 42, borderRadius: 10, borderWidth: 1, borderColor: tokens.color.line,
    backgroundColor: "#fff", justifyContent: "center", paddingHorizontal: 12,
  },
  readonlyText: { color: tokens.color.ink, fontWeight: "700" },
  pickerShell: {
    position: "relative", borderWidth: 1, borderColor: tokens.color.line,
    backgroundColor: "#fff", borderRadius: 12, overflow: "hidden",
  },
  pickerNative: { width: "100%", height: 44, paddingLeft: 8, color: tokens.color.ink, fontSize: 14 },
  pickerItemIOS: { fontSize: 16, color: tokens.color.ink },
  pickerIcon: { position: "absolute", right: 10, top: 14, opacity: 0.8 },
  dropdownLabel: { fontWeight: "800", color: "#0f172a", marginBottom: 8, textTransform: "none" },

  kv: { fontSize: 13, color: tokens.color.ink, marginTop: 6 },
  kvKey: { color: tokens.color.inkSubtle, fontWeight: "700" },
  stallRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: tokens.color.line, gap: 8,
  },
  helpText: { color: tokens.color.inkMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },

  // Quick Edit sheet layout (two columns on web, wraps on native)
  quickGrid: {
    gap: 12,
    ...(Platform.OS === "web"
      ? ({
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 12,
          rowGap: 12,
        } as any)
      : {
          flexDirection: "row",
          flexWrap: "wrap",
        }),
  },
  quickCol: {
    ...(Platform.OS === "web"
      ? {}
      : {
          flexGrow: 1,
          flexBasis: "48%",
          minWidth: 280,
        }),
  },

  sheetBody: { maxHeight: MOBILE_MODAL_MAX_HEIGHT, flexShrink: 1, width: "100%" },
  sheetScroll: { maxHeight: MOBILE_MODAL_MAX_HEIGHT },
  sheetContent: { paddingVertical: 12, gap: 12, paddingBottom: 96 },

  sep: { height: 1, backgroundColor: tokens.color.line, marginVertical: 10 },
});