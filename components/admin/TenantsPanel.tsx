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
  KeyboardAvoidingView,
  ScrollView,
  Dimensions,
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
  bill_start: string; // YYYY-MM-DD
  tenant_status: "active" | "inactive";
  last_updated: string;
  updated_by: string;
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

type Rate = {
  rate_id?: string;
  tenant_id: string;
  erate_perKwH: number | null;
  e_vat: number | null;
  emin_con: number | null;
  wmin_con: number | null;
  wrate_perCbM: number | null;
  wnet_vat: number | null;
  w_vat: number | null;
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

/** Helpers */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const dateOf = (t: Tenant) =>
  Date.parse(t.last_updated || t.bill_start || "") || 0;

const today = () => new Date().toISOString().slice(0, 10);

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
      { text: "OK", onPress: () => resolve(true) },
    ]);
  });
}

/** ---------- Chip helper (copied from StallsPanel) ---------- */
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
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
}

/** Component */
const MOBILE_MODAL_MAX_HEIGHT = Math.round(
  Dimensions.get("window").height * 0.92,
);

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
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">(
    "",
  );
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // Filters modal (same behavior as StallsPanel)
  const [filtersVisible, setFiltersVisible] = useState(false);

  // Details modal compound state
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsTenant, setDetailsTenant] = useState<Tenant | null>(null);
  const [bRates, setBRates] = useState<BuildingBaseRates | null>(null);
  const [tRate, setTRate] = useState<Rate | null>(null);
  const [tRateDraft, setTRateDraft] = useState<Rate | null>(null);
  const [tenantDraft, setTenantDraft] = useState<Tenant | null>(null);
  const [tenantStalls, setTenantStalls] = useState<Stall[]>([]);
  const [stallsBusy, setStallsBusy] = useState(false);

  // ---------- CREATE TENANT ----------
  const [createVisible, setCreateVisible] = useState(false);
  const [cSN, setCSN] = useState("");
  const [cName, setCName] = useState("");
  const [cBillStart, setCBillStart] = useState(today());
  const [cStatus, setCStatus] = useState<"active" | "inactive">("active");
  const [cBuildingId, setCBuildingId] = useState("");

  useEffect(() => {
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedToken, statusFilter]);

  const loadAll = async () => {
    if (!mergedToken) {
      setBusy(false);
      notify("Not logged in", "Please log in to view tenants.");
      return;
    }
    try {
      setBusy(true);
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const tRes = await api.get<Tenant[]>("/tenants", { params });
      setTenants(tRes.data || []);

      let bData: Building[] = [];
      if (isAdmin) {
        const bRes = await api.get<Building[]>("/buildings");
        bData = bRes.data || [];
        setBuildings(bData);
      } else {
        setBuildings([]);
      }

      setBuildingFilter((prev) => {
        if (prev) return prev;
        if (!isAdmin && userBuildingId) return userBuildingId;
        return bData?.[0]?.building_id ?? "";
      });

      // default create building if empty
      setCBuildingId((prev) => {
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

  /** Derived lists */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tenants;
    if (buildingFilter)
      list = list.filter((t) => t.building_id === buildingFilter);
    if (statusFilter)
      list = list.filter((t) => t.tenant_status === statusFilter);
    if (!q) return list;
    return list.filter((t) =>
      [
        t.tenant_id,
        t.tenant_sn,
        t.tenant_name,
        t.building_id,
        t.bill_start,
        t.tenant_status,
      ]
        .map((v) => String(v).toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [tenants, query, buildingFilter, statusFilter]);

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

  /** Open details */
  const openDetails = async (row: Tenant) => {
    setDetailsTenant(row);
    setTenantDraft({ ...row });
    setBRates(null);
    setTRate(null);
    setTRateDraft(null);
    setTenantStalls([]);
    setDetailsVisible(true);

    try {
      const bRes = await api.get<BuildingBaseRates>(
        `/buildings/${encodeURIComponent(row.building_id)}/base-rates`,
      );
      setBRates(bRes.data);
    } catch {
      setBRates(null);
    }

    try {
      const rRes = await api.get<Rate>(
        `/rates/buildings/${encodeURIComponent(row.building_id)}/tenants/${encodeURIComponent(row.tenant_id)}`,
      );
      setTRate(rRes.data);
      setTRateDraft(rRes.data);
    } catch {
      setTRate(null);
      setTRateDraft({
        tenant_id: row.tenant_id,
        erate_perKwH: null,
        e_vat: null,
        emin_con: null,
        wmin_con: null,
        wrate_perCbM: null,
        wnet_vat: null,
        w_vat: null,
        lrate_perKg: null,
      });
    }

    try {
      setStallsBusy(true);
      const sRes = await api.get<Stall[]>(`/stalls`);
      const mine = (sRes.data || []).filter(
        (s) => s.tenant_id === row.tenant_id,
      );
      setTenantStalls(mine);
    } catch {
      setTenantStalls([]);
    } finally {
      setStallsBusy(false);
    }
  };

  /** Save tenant panel */
  const saveTenant = async () => {
    if (!tenantDraft) return;
    try {
      setSubmitting(true);
      await api.put(`/tenants/${encodeURIComponent(tenantDraft.tenant_id)}`, {
        tenant_sn: tenantDraft.tenant_sn,
        tenant_name: tenantDraft.tenant_name,
        building_id: tenantDraft.building_id,
        bill_start: tenantDraft.bill_start,
        tenant_status: tenantDraft.tenant_status,
      });
      notify("Updated", "Tenant updated successfully.");
      await loadAll();
    } catch (err) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Save tenant rate panel */
  const saveRate = async () => {
    if (!detailsTenant || !tRateDraft) return;
    try {
      setSubmitting(true);
      const path = `/rates/buildings/${encodeURIComponent(detailsTenant.building_id)}/tenants/${encodeURIComponent(detailsTenant.tenant_id)}`;
      const body = { ...tRateDraft } as any;
      delete body.rate_id;
      delete body.last_updated;
      delete body.updated_by;
      await api.put(path, body);
      notify("Saved", "Tenant rate saved.");
      const rRes = await api.get<Rate>(path);
      setTRate(rRes.data);
      setTRateDraft(rRes.data);
    } catch (err) {
      notify("Save failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Stalls editing */
  const updateStallRow = (idx: number, patch: Partial<Stall>) => {
    setTenantStalls((prev) => {
      const arr = [...prev];
      arr[idx] = { ...prev[idx], ...patch } as Stall;
      return arr;
    });
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
    const ok = await confirm(
      "Unassign stall",
      `Remove ${s.stall_id} from this tenant?`,
    );
    if (!ok) return;
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

  /** Modal UI shell (details modal) */
  const ModalCard: React.FC<{ title: string; children?: React.ReactNode; onClose: () => void }>
    = ({ title, children, onClose }) => (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      style={styles.modalWrap}
    >
      {/* Render zoom wrapper ONLY on web */}
      {Platform.OS === "web" ? (
        <View style={styles.webZoom80}>
          <View style={[styles.modalCard]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle} numberOfLines={1} ellipsizeMode="tail">
                {title}
              </Text>
            </View>
            <View style={styles.modalDivider} />

            <View style={{ flexGrow: 1, flexShrink: 1 }}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 14 }}>
                {children}
              </ScrollView>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={onClose}>
                <Text style={[styles.btnText, styles.actionBtnGhostText]}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, submitting && styles.btnDisabled]}
                onPress={async () => { await saveTenant(); await saveRate(); }}
                disabled={submitting}
              >
                <Text style={styles.btnText}>{submitting ? "Saving…" : "Save All"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.modalCard, { maxHeight: MOBILE_MODAL_MAX_HEIGHT }]}>
          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle} numberOfLines={1} ellipsizeMode="tail">
              {title}
            </Text>
          </View>
          <View style={styles.modalDivider} />

          <View style={{ flexGrow: 1, flexShrink: 1 }}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 14 }}>
              {children}
            </ScrollView>
          </View>

          <View style={styles.modalActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={onClose}>
              <Text style={[styles.btnText, styles.actionBtnGhostText]}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, submitting && styles.btnDisabled]}
              onPress={async () => { await saveTenant(); await saveRate(); }}
              disabled={submitting}
            >
              <Text style={styles.btnText}>{submitting ? "Saving…" : "Save All"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );

  const ReadOnlyKV: React.FC<{ label: string; value: any }> = ({ label, value }) => (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </Text>
    </View>
  );

  // ---------- Create handler ----------
  const onCreateTenant = async () => {
    const finalBldg = isAdmin ? cBuildingId : (userBuildingId || cBuildingId);
    if (!cSN || !cName || !finalBldg || !cBillStart) {
      notify("Missing info", "Please fill in all fields.");
      return;
    }
    try {
      setSubmitting(true);
      await api.post("/tenants", {
        tenant_sn: cSN,
        tenant_name: cName,
        building_id: finalBldg,
        bill_start: cBillStart,
        tenant_status: cStatus,
      });
      setCreateVisible(false);
      setCSN(""); setCName(""); setCBillStart(today()); setCStatus("active");
      await loadAll();
      notify("Success", "Tenant created.");
    } catch (err) {
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>Tenants</Text>

        {/* Create button */}
        <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
          <Text style={styles.btnText}>+ Create Tenant</Text>
        </TouchableOpacity>
      </View>

      {/* Top bar: search + Filters button */}
      <View style={styles.filtersBar}>
        <View style={[styles.searchWrap, { flex: 1 }]}>
          <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by ID, SN, name, status…"
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
        <View style={styles.loader}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(t) => t.tenant_id}
          style={{ maxHeight: 360, marginTop: 4 }}
          nestedScrollEnabled
          ListEmptyComponent={<Text style={styles.empty}>No tenants found.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => openDetails(item)} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.tenant_name} • {item.tenant_id}</Text>
                <Text style={styles.rowSub}>
                  SN: {item.tenant_sn} • Building: {item.building_id} • Bill start: {item.bill_start} • {item.tenant_status}
                </Text>
              </View>
              <View style={styles.badge}><Text style={styles.badgeText}>View</Text></View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* FILTERS modal */}
      <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.modalTitle}>Filters & Sort</Text>
            <View style={styles.modalDivider} />

            <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>Building</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "All", value: "" },
                ...(isAdmin
                  ? buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }))
                  : userBuildingId
                  ? [{ label: userBuildingId, value: userBuildingId }]
                  : []),
              ].map((opt) => (
                <Chip key={opt.value || "all"} label={opt.label} active={buildingFilter === opt.value}
                  onPress={() => setBuildingFilter(opt.value)} />
              ))}
            </View>

            <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Status</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "All", value: "" },
                { label: "Active", value: "active" },
                { label: "Inactive", value: "inactive" },
              ].map((opt) => (
                <Chip key={opt.value || "all"} label={opt.label} active={statusFilter === (opt.value as any)}
                  onPress={() => setStatusFilter(opt.value as any)} />
              ))}
            </View>

            <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Sort by</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "newest" },
                { label: "Oldest", val: "oldest" },
                { label: "ID ↑", val: "idAsc" },
                { label: "ID ↓", val: "idDesc" },
              ].map(({ label, val }) => (
                <Chip key={val} label={label} active={sortMode === (val as any)}
                  onPress={() => setSortMode(val as any)} />
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => { setQuery(""); setBuildingFilter(""); setStatusFilter(""); setSortMode("newest"); setFiltersVisible(false); }}
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

      {/* CREATE TENANT modal (WIDE on web, now FULL-WIDTH on mobile) */}
      <Modal visible={createVisible} animationType="fade" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: "padding", android: "height" })}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
          style={styles.modalWrap}
        >
          {/* No webZoom wrapper so width isn't shrunk on web */}
          <View>
            <View style={[styles.modalCard, styles.modalCardWide]}>
              <Text style={styles.modalTitle}>Create Tenant</Text>
              <View style={styles.modalDivider} />

              <View style={{ flexShrink: 1 }}>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
                  <Text style={styles.inputLabel}>Tenant SN</Text>
                  <TextInput style={styles.input} value={cSN} onChangeText={setCSN} placeholder="e.g. T-000123" placeholderTextColor="#9aa5b1" autoCapitalize="characters" />

                  <Text style={styles.inputLabel}>Tenant name</Text>
                  <TextInput style={styles.input} value={cName} onChangeText={setCName} placeholder="Tenant full name" placeholderTextColor="#9aa5b1" />

                  <Text style={styles.inputLabel}>Building</Text>
                  <View style={styles.dropdownBox}>
                    <Picker
                      enabled={isAdmin || !!userBuildingId}
                      selectedValue={isAdmin ? cBuildingId : (userBuildingId || cBuildingId)}
                      onValueChange={(v) => setCBuildingId(String(v))}
                      style={styles.dropdown}
                    >
                      {(isAdmin
                        ? buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }))
                        : userBuildingId
                        ? [{ label: userBuildingId, value: userBuildingId }]
                        : []
                      ).map((opt) => (
                        <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                      ))}
                    </Picker>
                  </View>

                  <Text style={styles.inputLabel}>Bill start (YYYY-MM-DD)</Text>
                  <TextInput style={styles.input} value={cBillStart} onChangeText={setCBillStart} placeholder="YYYY-MM-DD" placeholderTextColor="#9aa5b1" autoCapitalize="none" />

                  <Text style={styles.inputLabel}>Status</Text>
                  <View style={styles.dropdownBox}>
                    <Picker selectedValue={cStatus} onValueChange={(v) => setCStatus((v || "active") as "active" | "inactive")} style={styles.dropdown}>
                      <Picker.Item label="Active" value="active" />
                      <Picker.Item label="Inactive" value="inactive" />
                    </Picker>
                  </View>
                </ScrollView>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => setCreateVisible(false)}>
                  <Text style={[styles.btnText, styles.actionBtnGhostText]}>Close</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, submitting && styles.btnDisabled]} onPress={onCreateTenant} disabled={submitting}>
                  <Text style={styles.btnText}>{submitting ? "Saving…" : "Create"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DETAILS modal */}
      <Modal visible={detailsVisible} animationType="fade" transparent onRequestClose={() => setDetailsVisible(false)}>
        <ModalCard
          title={`Tenant Details${detailsTenant ? ` · ${detailsTenant.tenant_name}` : ""}`}
          onClose={() => setDetailsVisible(false)}
        >
          {/* GRID */}
          <View style={styles.gridWrap}>
            {/* Tenant (editable) */}
            <View style={[styles.gridItem, styles.gridSpan2]}>
              <Text style={styles.sectionTitle}>Tenant</Text>
              {tenantDraft ? (
                <View>
                  <Text style={styles.inputLabel}>Tenant SN</Text>
                  <TextInput style={styles.input} value={tenantDraft.tenant_sn} onChangeText={(v) => setTenantDraft({ ...tenantDraft, tenant_sn: v })} />

                  <Text style={styles.inputLabel}>Tenant name</Text>
                  <TextInput style={styles.input} value={tenantDraft.tenant_name} onChangeText={(v) => setTenantDraft({ ...tenantDraft, tenant_name: v })} />

                  <Text style={styles.inputLabel}>Bill start (YYYY-MM-DD)</Text>
                  <TextInput style={styles.input} value={tenantDraft.bill_start} onChangeText={(v) => setTenantDraft({ ...tenantDraft, bill_start: v })} placeholder="YYYY-MM-DD" />

                  <Text style={styles.inputLabel}>Status</Text>
                  <View style={styles.dropdownBox}>
                    <Picker selectedValue={tenantDraft.tenant_status} onValueChange={(v) => setTenantDraft({ ...tenantDraft, tenant_status: v as any })} style={styles.dropdown}>
                      <Picker.Item label="Active" value="active" />
                      <Picker.Item label="Inactive" value="inactive" />
                    </Picker>
                  </View>
                </View>
              ) : (
                <Text style={styles.muted}>Loading…</Text>
              )}
            </View>

            {/* Building base rates (read-only) */}
            <View style={[styles.gridItem]}>
              <Text style={styles.sectionTitle}>Building Rates</Text>
              {bRates ? (
                <View style={{ gap: 6 }}>
                  <ReadOnlyKV label="Electric (rate/kWh)" value={bRates.erate_perKwH} />
                  <ReadOnlyKV label="Electric min. consumption" value={bRates.emin_con} />
                  <ReadOnlyKV label="Water (rate/cbm)" value={bRates.wrate_perCbM} />
                  <ReadOnlyKV label="Water min. consumption" value={bRates.wmin_con} />
                  <ReadOnlyKV label="LPG (rate/kg)" value={bRates.lrate_perKg} />
                </View>
              ) : (
                <Text style={styles.muted}>No building base rates.</Text>
              )}
            </View>

            {/* Tenant rate (editable) */}
            <View style={[styles.gridItem]}>
              <Text style={styles.sectionTitle}>Tenant Rates</Text>
              {tRateDraft ? (
                <View>
                  <Text style={styles.inputLabel}>Electric VAT (e_vat)</Text>
                  <TextInput style={styles.input} keyboardType="decimal-pad" value={String(tRateDraft.e_vat ?? "")}
                    onChangeText={(v) => setTRateDraft({ ...tRateDraft, e_vat: v.trim() === "" ? null : Number(v) })} />

                  <Text style={styles.inputLabel}>Water VAT (w_vat)</Text>
                  <TextInput style={styles.input} keyboardType="decimal-pad" value={String(tRateDraft.w_vat ?? "")}
                    onChangeText={(v) => setTRateDraft({ ...tRateDraft, w_vat: v.trim() === "" ? null : Number(v) })} />

                  <Text style={styles.inputLabel}>Water Net VAT (wnet_vat)</Text>
                  <TextInput style={styles.input} keyboardType="decimal-pad" value={String(tRateDraft.wnet_vat ?? "")}
                    onChangeText={(v) => setTRateDraft({ ...tRateDraft, wnet_vat: v.trim() === "" ? null : Number(v) })} />
                </View>
              ) : (
                <Text style={styles.muted}>No tenant rate yet.</Text>
              )}
            </View>

            {/* Stalls list (editable) */}
            <View style={[styles.gridItem, styles.gridSpan2]}>
              <Text style={styles.sectionTitle}>Stalls</Text>
              {stallsBusy ? (
                <ActivityIndicator />
              ) : tenantStalls.length === 0 ? (
                <Text style={styles.muted}>No stalls assigned to this tenant.</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {tenantStalls.map((s, i) => (
                    <View key={s.stall_id} style={styles.stallRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.smallLabel}>Stall ID</Text>
                        <Text style={styles.smallValue}>{s.stall_id}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.smallLabel}>Stall SN</Text>
                        <TextInput style={styles.inputSm} value={s.stall_sn} onChangeText={(v) => updateStallRow(i, { stall_sn: v })} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.smallLabel}>Status</Text>
                        <View style={[styles.dropdownBox, { height: 36 }]}>
                          <Picker selectedValue={s.stall_status} onValueChange={(v) => updateStallRow(i, { stall_status: String(v) })} style={styles.dropdown}>
                            <Picker.Item label="Available" value="available" />
                            <Picker.Item label="Occupied" value="occupied" />
                            <Picker.Item label="Maintenance" value="maintenance" />
                          </Picker>
                        </View>
                      </View>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TouchableOpacity style={styles.btnGhost} onPress={() => saveStall(tenantStalls[i])}>
                          <Text style={styles.btnGhostText}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnDanger} onPress={() => unassignStall(tenantStalls[i])}>
                          <Text style={styles.btnDangerText}>Unassign</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </ModalCard>
      </Modal>
    </View>
  );
}

/** Styles — responsive grid + copied filter chips modal */
const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
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
    marginBottom: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },

  // top bar
  filtersBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    minWidth: 160,
  },
  search: { flex: 1, color: "#0f172a" },

  // list
  loader: { paddingVertical: 18, alignItems: "center" },
  empty: { textAlign: "center", color: "#64748b", padding: 12 },
  listRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowTitle: { fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontSize: 12, marginTop: 2 },
  badge: {
    backgroundColor: "#bfbfbfff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  // buttons
  btn: {
    backgroundColor: "#082cac",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
  },
  btnGhostText: { color: "#082cac", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },

  btnDanger: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  btnDangerText: { color: "#fff", fontWeight: "700" },

  // form
  inputLabel: {
    marginTop: 8,
    marginBottom: 6,
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
  },

  // Modal overlay
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.28)",
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.select({
      web: { padding: 16 } as any,
      default: { paddingVertical: 16, paddingHorizontal: 0 } as any, // ← no side padding on mobile
    }) as any),
  },

  // Base modal card (Details modal uses this; mobile height set in JSX)
  modalCard: {
    width: "100%",
    maxWidth: 1000,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    ...(Platform.select({
      web: { boxShadow: "0 18px 44px rgba(15,23,42,0.08)" as any },
      default: { elevation: 6 },
    }) as any),
  },

  // Create Tenant — wide on web, FULL WIDTH on mobile
  modalCardWide: {
    alignSelf: "center",
    ...(Platform.select({
      web: {
        width: "200%",
        maxWidth: 1000,
        position: "relative",
        left: "50%",
        transform: "translateX(-50%)",
      },
      default: {
        width: "100%",          // ← full width on mobile
        maxWidth: 560,          // optional cap; remove or raise if you want even wider
        maxHeight: MOBILE_MODAL_MAX_HEIGHT,
      },
    }) as any),
  },

  modalDivider: { height: 1, backgroundColor: "#eef2f7", marginVertical: 10 },
  modalHeaderRow: { flexDirection: "row", alignItems: "center" },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a", flexShrink: 1 },

  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },

  actionBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#082cac",
  },
  actionBtnGhost: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionBtnGhostText: { color: "#082cac", fontWeight: "700" },

  // grid
  gridWrap: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    flexWrap: "wrap",
    gap: 12,
  },
  gridItem: {
    borderWidth: 1,
    borderColor: "#eef2f7",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fafcff",
    flexBasis: Platform.OS === "web" ? "48%" : "100%",
    flexGrow: 1,
  },
  gridSpan2: { flexBasis: Platform.OS === "web" ? "100%" : "100%" },

  // readonly key-value
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  kvLabel: { color: "#475569" },
  kvValue: { color: "#0f172a", fontWeight: "700" },

  // stalls
  stallRow: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    gap: 10,
    alignItems: Platform.OS === "web" ? "center" : "stretch",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
  },
  smallLabel: { fontSize: 11, color: "#64748b", marginBottom: 4 },
  smallValue: { fontSize: 12, color: "#0f172a", fontWeight: "700" },
  inputSm: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#f8fafc",
    color: "#0f172a",
  },

  // -------- copied filter chips modal styles (from StallsPanel) --------
  dropdownLabel: { fontSize: 12, fontWeight: "700", color: "#486581", marginBottom: 6 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#c7d2fe",
    backgroundColor: "#eef2ff",
  },
  chipIdle: { backgroundColor: "#fff", borderColor: "#e2e8f0" },
  chipActive: { backgroundColor: "#082cac", borderColor: "#082cac" },
  chipText: { fontSize: 12 },
  chipTextIdle: { color: "#082cac", fontWeight: "700" },
  chipTextActive: { color: "#fff", fontWeight: "700" },

  // Filters prompt modal (small like BuildingPanel/StallsPanel)
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

  // picker used in details grid
  dropdownBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
  },
  dropdown: { height: 36 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  muted: { color: "#94a3b8" },

  // web-only zoom (used by details modal shell)
  webZoom80: {
    ...(Platform.select({
      web: { zoom: 0.8 } as any,
      default: {},
    }) as any),
  },
});