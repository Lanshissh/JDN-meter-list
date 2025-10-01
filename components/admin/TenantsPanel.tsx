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
import { useAuth } from "../../contexts/AuthContext";

/** Types */
type Tenant = {
  tenant_id: string;
  tenant_sn: string;
  tenant_name: string;
  building_id: string;
  bill_start: string; // YYYY-MM-DD
  tenant_status: "active" | "inactive";
  last_updated: string; // ISO
  updated_by: string;
};

type Building = {
  building_id: string;
  building_name: string;
  erate_perKwH?: number | null;
  emin_con?: number | null;
  wrate_perCbM?: number | null;
  wmin_con?: number | null;
  lrate_perKg?: number | null;
  last_updated?: string;
  updated_by?: string;
};

type Stall = {
  stall_id: string;
  stall_sn: string;
  tenant_id: string | null;
  building_id: string;
  stall_status: "occupied" | "available" | "under maintenance";
  last_updated: string;
  updated_by: string;
};

type Meter = {
  meter_id: string;
  meter_type: "electric" | "water" | "lpg";
  meter_sn: string;
  meter_mult: number;
  stall_id: string;
  meter_status: "active" | "inactive";
  last_updated: string;
  updated_by: string;
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

/** Helpers */
const cmp = (a: string | number, b: string | number) =>
  String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });

const dateOfTenant = (t: Tenant) =>
  Date.parse(t.last_updated || t.bill_start || "") || 0;

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

/** Alerts */
function notify(title: string, message?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && (window as any).alert) {
    (window as any).alert(message ? `${title}\n\n${message}` : title);
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
    return Promise.resolve(!!(window as any).confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "OK", style: "default", onPress: () => resolve(true) },
    ]);
  });
}

/** Component */
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
        timeout: 20000,
      }),
    [authHeader],
  );

  // Filters & state
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"" | "active" | "inactive">("");
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [query, setQuery] = useState("");

  type SortMode = "newest" | "oldest" | "idAsc" | "idDesc";
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  // Create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [sn, setSn] = useState("");
  const [name, setName] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [billStart, setBillStart] = useState(today());
  const [createStatus, setCreateStatus] = useState<"active" | "inactive">("active");

  // Edit modal (legacy simple edit)
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Tenant | null>(null);
  const [editSn, setEditSn] = useState("");
  const [editName, setEditName] = useState("");
  const [editBuildingId, setEditBuildingId] = useState("");
  const [editBillStart, setEditBillStart] = useState(today());
  const [editStatus, setEditStatus] = useState<"active" | "inactive">("active");

  // Details modal (+ inline edit mode)
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailsTenant, setDetailsTenant] = useState<Tenant | null>(null);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [detailsEdit, setDetailsEdit] = useState(false);

  const [allStalls, setAllStalls] = useState<Stall[]>([]);
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [tenantStalls, setTenantStalls] = useState<Stall[]>([]);
  const [tenantMeters, setTenantMeters] = useState<Meter[]>([]);
  const [tenantRate, setTenantRate] = useState<Rate | null>(null);

  // Building rates (display only)
  const [buildingBase, setBuildingBase] = useState<Building | null>(null);

  // Inline editable state (mirrors details values when edit starts)
  const [edTenantName, setEdTenantName] = useState("");
  const [edTenantSn, setEdTenantSn] = useState("");
  const [edBillStart, setEdBillStart] = useState(today());
  const [edTenantStatus, setEdTenantStatus] = useState<"active" | "inactive">("active");

  const [edSelectedStallIds, setEdSelectedStallIds] = useState<Set<string>>(new Set());
  const [edMetersMap, setEdMetersMap] = useState<Record<string, string>>({}); // meter_id -> stall_id

  const [edRateEVat, setEdRateEVat] = useState<string>("");
  const [edRateWVat, setEdRateWVat] = useState<string>("");
  const [edRateWNetVat, setEdRateWNetVat] = useState<string>("");

  // Load core lists
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

      const [tRes, sRes, mRes, bRes] = await Promise.all([
        api.get<Tenant[]>("/tenants", { params }),
        api.get<Stall[]>("/stalls"),
        api.get<Meter[]>("/meters"),
        isAdmin ? api.get<Building[]>("/buildings") : Promise.resolve({ data: [] as Building[] }),
      ]);

      setTenants(tRes.data || []);
      setAllStalls(sRes.data || []);
      setAllMeters(mRes.data || []);
      if (isAdmin) setBuildings(bRes.data || []);

      setBuildingId((prev) => {
        if (prev) return prev;
        if (!isAdmin && userBuildingId) return userBuildingId;
        return (bRes as any)?.data?.[0]?.building_id ?? "";
      });
    } catch (err: any) {
      notify("Load failed", errorText(err, "Connection error."));
    } finally {
      setBusy(false);
    }
  };

  /** Building options */
  const createBuildingOptions = useMemo(() => {
    if (isAdmin)
      return buildings.map((b) => ({
        label: `${b.building_name} (${b.building_id})`,
        value: b.building_id,
      }));
    const only = userBuildingId ? [{ label: userBuildingId, value: userBuildingId }] : [];
    return only;
  }, [isAdmin, buildings, userBuildingId]);

  const filterBuildingOptions = useMemo(
    () => [
      { label: "All Buildings", value: "" },
      ...(isAdmin
        ? buildings.map((b) => ({ label: `${b.building_name} (${b.building_id})`, value: b.building_id }))
        : userBuildingId
          ? [{ label: userBuildingId, value: userBuildingId }]
          : []),
    ],
    [isAdmin, buildings, userBuildingId],
  );

  /** Derived lists for search/sort */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tenants;
    if (buildingFilter) list = list.filter((t) => t.building_id === buildingFilter);
    if (statusFilter) list = list.filter((t) => t.tenant_status === statusFilter);
    if (!q) return list;
    return list.filter((t) =>
      [t.tenant_id, t.tenant_sn, t.tenant_name, t.building_id, t.bill_start, t.tenant_status]
        .join("|")
        .toLowerCase()
        .includes(q),
    );
  }, [tenants, query, buildingFilter, statusFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortMode) {
      case "newest":
        return arr.sort((a, b) => dateOfTenant(b) - dateOfTenant(a));
      case "oldest":
        return arr.sort((a, b) => dateOfTenant(a) - dateOfTenant(b));
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
        tenant_status: createStatus,
      });
      const assignedId: string =
        (res as any)?.data?.tenantId ??
        (res as any)?.data?.tenant_id ??
        (res as any)?.data?.id ??
        "";
      setSn("");
      setName("");
      setBillStart(today());
      setCreateStatus("active");
      setCreateVisible(false);
      await loadAll();
      notify("Success", assignedId ? `Tenant created.\nID assigned: ${assignedId}` : "Tenant created.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Classic Edit (kept) */
  const openEdit = (row: Tenant) => {
    setEditRow(row);
    setEditSn(row.tenant_sn);
    setEditName(row.tenant_name);
    setEditBuildingId(row.building_id);
    setEditBillStart(row.bill_start);
    setEditStatus(row.tenant_status);
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
        tenant_status: editStatus,
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

  /** DETAILS: open & load modal data */
  const openDetails = async (t: Tenant) => {
    setDetailsTenant(t);
    setDetailsEdit(false);
    setTenantStalls([]);
    setTenantMeters([]);
    setTenantRate(null);
    setBuildingBase(null);
    setDetailsVisible(true);

    try {
      setDetailsBusy(true);

      // 1) Stalls under tenant (client-side filter)
      const stalls = allStalls.filter((s) => s.tenant_id === t.tenant_id);
      setTenantStalls(stalls);

      // 2) Meters on those stalls (client-side filter)
      const stallIds = new Set(stalls.map((s) => s.stall_id));
      const meters = allMeters.filter((m) => stallIds.has(m.stall_id));
      setTenantMeters(meters);

      // 3) Tenant-specific rate (per-tenant endpoint)
      if (t.building_id) {
        try {
          const rRes = await api.get<Rate>(
            `/rates/buildings/${encodeURIComponent(
              t.building_id,
            )}/tenants/${encodeURIComponent(t.tenant_id)}`,
          );
          setTenantRate(rRes.data || null);
        } catch {
          setTenantRate(null);
        }

        // 4) Building base rates (from /buildings/:id)
        try {
          const bRes = await api.get<Building>(`/buildings/${encodeURIComponent(t.building_id)}`);
          setBuildingBase(bRes.data || null);
        } catch {
          setBuildingBase(null);
        }
      }
    } catch (err: any) {
      notify("Load failed", errorText(err));
    } finally {
      setDetailsBusy(false);
    }
  };

  /** Begin inline edit: seed editable state with current details */
  const startInlineEdit = () => {
    if (!detailsTenant) return;
    setEdTenantName(detailsTenant.tenant_name);
    setEdTenantSn(detailsTenant.tenant_sn);
    setEdBillStart(detailsTenant.bill_start);
    setEdTenantStatus(detailsTenant.tenant_status);

    const selected = new Set(tenantStalls.map((s) => s.stall_id));
    setEdSelectedStallIds(selected);

    const m: Record<string, string> = {};
    tenantMeters.forEach((mm) => (m[mm.meter_id] = mm.stall_id));
    setEdMetersMap(m);

    setEdRateEVat(tenantRate?.e_vat != null ? String(tenantRate.e_vat) : "");
    setEdRateWVat(tenantRate?.w_vat != null ? String(tenantRate.w_vat) : "");
    setEdRateWNetVat(tenantRate?.wnet_vat != null ? String(tenantRate.wnet_vat) : "");

    setDetailsEdit(true);
  };

  /** Cancel inline edit */
  const cancelInlineEdit = () => {
    setDetailsEdit(false);
  };

  /** Save inline edits */
  const saveInlineEdit = async () => {
    if (!detailsTenant) return;

    try {
      setSubmitting(true);

      const tenantId = detailsTenant.tenant_id;
      const buildingId = detailsTenant.building_id;

      // A) Update tenant core info (if changed)
      const needTenantUpdate =
        edTenantName !== detailsTenant.tenant_name ||
        edTenantSn !== detailsTenant.tenant_sn ||
        edBillStart !== detailsTenant.bill_start ||
        edTenantStatus !== detailsTenant.tenant_status;

      if (needTenantUpdate) {
        await api.put(`/tenants/${encodeURIComponent(tenantId)}`, {
          tenant_sn: edTenantSn,
          tenant_name: edTenantName,
          building_id: buildingId,
          bill_start: edBillStart,
          tenant_status: edTenantStatus,
        });
      }

      // B) Assign/unassign stalls to this tenant (only within the same building)
      const stallsInBuilding = allStalls.filter((s) => s.building_id === buildingId);
      const currentlySelected = new Set(tenantStalls.map((s) => s.stall_id));
      const nextSelected = edSelectedStallIds;

      // Stalls to assign (selected now but not previously)
      const toAssign = [...nextSelected].filter((id) => !currentlySelected.has(id));
      // Stalls to unassign (previously selected but not now)
      const toUnassign = [...currentlySelected].filter((id) => !nextSelected.has(id));

      // Security: ensure they belong to the same building
      const validId = new Set(stallsInBuilding.map((s) => s.stall_id));
      const toAssignValid = toAssign.filter((id) => validId.has(id));
      const toUnassignValid = toUnassign.filter((id) => validId.has(id));

      // Apply assignments
      await Promise.all(
        toAssignValid.map((stallId) =>
          api.put(`/stalls/${encodeURIComponent(stallId)}`, { tenant_id: tenantId }),
        ),
      );
      await Promise.all(
        toUnassignValid.map((stallId) =>
          api.put(`/stalls/${encodeURIComponent(stallId)}`, { tenant_id: null }),
        ),
      );

      // C) Move meters to selected stalls if changed (only allow target among selected stalls)
      const allowedTargets = new Set([...nextSelected]);
      const meterUpdates = Object.entries(edMetersMap).filter(([mid, newStallId]) => {
        const orig = tenantMeters.find((m) => m.meter_id === mid)?.stall_id;
        return newStallId && newStallId !== orig && allowedTargets.has(newStallId);
      });

      await Promise.all(
        meterUpdates.map(([meterId, stallId]) =>
          api.put(`/meters/${encodeURIComponent(meterId)}`, { stall_id: stallId }),
        ),
      );

      // D) Upsert tenant rate (VAT fields only here)
      const parsedEVat = edRateEVat === "" ? null : Number(edRateEVat);
      const parsedWVat = edRateWVat === "" ? null : Number(edRateWVat);
      const parsedWNetVat = edRateWNetVat === "" ? null : Number(edRateWNetVat);

      const ratePayload = {
        e_vat: isNaN(parsedEVat as any) ? null : parsedEVat,
        w_vat: isNaN(parsedWVat as any) ? null : parsedWVat,
        wnet_vat: isNaN(parsedWNetVat as any) ? null : parsedWNetVat,
      };

      if (tenantRate && tenantRate.tenant_id) {
        // Update
        try {
          await api.put(
            `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(
              tenantId,
            )}`,
            ratePayload,
          );
        } catch (e) {
          // If PUT not available, try POST as fallback
          await api.post(
            `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(
              tenantId,
            )}`,
            ratePayload,
          );
        }
      } else {
        // Create
        await api.post(
          `/rates/buildings/${encodeURIComponent(buildingId)}/tenants/${encodeURIComponent(
            tenantId,
          )}`,
          ratePayload,
        );
      }

      // Refresh everything for this tenant
      await loadAll();
      await openDetails({ ...detailsTenant });
      setDetailsEdit(false);
      notify("Saved", "Changes have been applied.");
    } catch (err: any) {
      notify("Save failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Small UI helpers */
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
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const Row = ({ item }: { item: Tenant }) => (
    <TouchableOpacity onPress={() => openDetails(item)} style={styles.row} activeOpacity={0.8}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.tenant_name}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {item.tenant_id} • SN: {item.tenant_sn} • {item.tenant_status} • {item.building_id}
        </Text>
      </View>
        <View style={styles.badge}><Text style={styles.badgeText}>View</Text></View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.grid}>
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Manage Tenants</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
            <Text style={styles.btnText}>+ Create</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchWrap, { marginTop: 6 }]}>
          <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name, ID, SN, building…"
            placeholderTextColor="#9aa5b1"
            style={styles.search}
          />
        </View>

        {/* Filters BELOW search */}
        <View style={styles.filtersBar}>
          <View style={[styles.filterCol, { flex: 1 }]}>
            <Text style={styles.dropdownLabel}>Building</Text>
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

          <View style={[styles.filterCol, { flex: 1 }]}>
            <Text style={styles.dropdownLabel}>Status</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "All", val: "" },
                { label: "Active", val: "active" },
                { label: "Inactive", val: "inactive" },
              ].map(({ label, val }) => (
                <Chip
                  key={label}
                  label={label}
                  active={statusFilter === (val as any)}
                  onPress={() => setStatusFilter(val as any)}
                />
              ))}
            </View>
          </View>

          <View style={[styles.filterCol, { flex: 1 }]}>
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
        </View>

        {/* List */}
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(t) => t.tenant_id}
            style={{ maxHeight: 420, marginTop: 6 }}
            nestedScrollEnabled
            ListEmptyComponent={<Text style={styles.empty}>No tenants found.</Text>}
            renderItem={({ item }) => <Row item={item} />}
          />
        )}
      </View>

      {/* CREATE modal */}
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
            <View style={styles.modalDivider} />

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Serial No.</Text>
                  <TextInput style={styles.input} value={sn} onChangeText={setSn} placeholder="TNT0001234" />
                </View>

                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Name</Text>
                  <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Tenant name" />
                </View>
              </View>

              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Building</Text>
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={buildingId}
                      onValueChange={(v) => setBuildingId(String(v))}
                      style={styles.picker}
                      enabled={isAdmin}
                    >
                      {createBuildingOptions.map((opt) => (
                        <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                      ))}
                    </Picker>
                  </View>
                </View>

                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Bill Start</Text>
                  <TextInput style={styles.input} value={billStart} onChangeText={setBillStart} placeholder="YYYY-MM-DD" />
                </View>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Status</Text>
                <View style={styles.chipsRow}>
                  {["active", "inactive"].map((st) => (
                    <Chip key={st} label={st.toUpperCase()} active={createStatus === (st as any)} onPress={() => setCreateStatus(st as any)} />
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setCreateVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

{/* DETAILS modal (view + inline edit) */}
<Modal
  visible={detailsVisible}
  animationType="fade"
  transparent
  onRequestClose={() => setDetailsVisible(false)}
>
  <KeyboardAvoidingView
    behavior={Platform.OS === "ios" ? "padding" : undefined}
    style={styles.modalWrap}
  >
    <View style={[styles.modalCard, styles.modalCardLarge]}>
      {/* Modal header + actions */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.modalTitle}>
          Tenant Details{detailsTenant ? ` · ${detailsTenant.tenant_name}` : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnGhost]}
            onPress={() => setDetailsVisible(false)}
            accessibilityLabel="Close details"
          >
        <Text style={[styles.btnText, styles.actionBtnGhostText]}>Close</Text>
          </TouchableOpacity>
          {!detailsEdit ? (
            <TouchableOpacity
              style={[styles.btn]}
              onPress={startInlineEdit}
              disabled={detailsBusy || !detailsTenant}
            >
              <Text style={styles.btnText}>Edit</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={saveInlineEdit}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.modalDivider} />

      {detailsBusy ? (
        <View style={styles.loader}>
          <ActivityIndicator />
        </View>
      ) : (
        // Scrollable content area
        <View style={styles.scrollArea}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
          >
            {/* Section: Tenant */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Tenant</Text>
              {!detailsTenant ? (
                <Text style={styles.empty}>No tenant selected.</Text>
              ) : !detailsEdit ? (
                <>
                  <Text style={styles.kv}><Text style={styles.k}>ID:</Text> <Text style={styles.v}>{detailsTenant.tenant_id}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>SN:</Text> <Text style={styles.v}>{detailsTenant.tenant_sn}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Name:</Text> <Text style={styles.v}>{detailsTenant.tenant_name}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Building:</Text> <Text style={styles.v}>{detailsTenant.building_id}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Bill start:</Text> <Text style={styles.v}>{detailsTenant.bill_start}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Status:</Text> <Text style={styles.v}>{detailsTenant.tenant_status}</Text></Text>
                  {!!detailsTenant.last_updated && (
                    <Text style={styles.kv}><Text style={styles.k}>Last updated:</Text> <Text style={styles.v}>{formatDateTime(detailsTenant.last_updated)}</Text></Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.kv}><Text style={styles.k}>ID:</Text> <Text style={styles.v}>{detailsTenant.tenant_id}</Text></Text>
                  <View style={styles.rowWrap}>
                    <View style={{ flex: 1, marginTop: 8 }}>
                      <Text style={styles.dropdownLabel}>Serial No.</Text>
                      <TextInput style={styles.input} value={edTenantSn} onChangeText={setEdTenantSn} />
                    </View>
                    <View style={{ flex: 1, marginTop: 8 }}>
                      <Text style={styles.dropdownLabel}>Name</Text>
                      <TextInput style={styles.input} value={edTenantName} onChangeText={setEdTenantName} />
                    </View>
                  </View>
                  <View style={styles.rowWrap}>
                    <View style={{ flex: 1, marginTop: 8 }}>
                      <Text style={styles.dropdownLabel}>Bill Start</Text>
                      <TextInput style={styles.input} value={edBillStart} onChangeText={setEdBillStart} placeholder="YYYY-MM-DD" />
                    </View>
                    <View style={{ flex: 1, marginTop: 8 }}>
                      <Text style={styles.dropdownLabel}>Status</Text>
                      <View style={styles.chipsRow}>
                        {(["active", "inactive"] as const).map((st) => (
                          <Chip key={st} label={st.toUpperCase()} active={edTenantStatus === st} onPress={() => setEdTenantStatus(st)} />
                        ))}
                      </View>
                    </View>
                  </View>
                </>
              )}
            </View>

            {/* Section: Stalls */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Stalls under tenant</Text>
              {!detailsTenant ? (
                <Text style={styles.empty}>No tenant selected.</Text>
              ) : !detailsEdit ? (
                tenantStalls.length === 0 ? (
                  <Text style={styles.empty}>No stalls assigned.</Text>
                ) : (
                  tenantStalls.map((s) => (
                    <Text key={s.stall_id} style={styles.kv}>
                      <Text style={styles.k}>• {s.stall_id}</Text>{" "}
                      <Text style={styles.v}>SN: {s.stall_sn} · {s.stall_status}</Text>
                    </Text>
                  ))
                )
              ) : (
                <>
                  <Text style={styles.dropdownLabel}>Select stalls for this tenant</Text>
                  <View style={styles.chipsRow}>
                    {allStalls
                      .filter((s) => s.building_id === detailsTenant.building_id)
                      .map((s) => {
                        const selected = edSelectedStallIds.has(s.stall_id);
                        // ✅ boolean-only value for disabled
                        const disabled: boolean =
                          !!s.tenant_id && s.tenant_id !== detailsTenant?.tenant_id;
                        const label = `${s.stall_id} (${s.stall_sn})`;
                        return (
                          <TouchableOpacity
                            key={s.stall_id}
                            onPress={() => {
                              if (disabled) return;
                              const next = new Set(edSelectedStallIds);
                              if (selected) next.delete(s.stall_id);
                              else next.add(s.stall_id);
                              setEdSelectedStallIds(next);
                            }}
                            style={[
                              styles.chip,
                              selected ? styles.chipActive : styles.chipIdle,
                              disabled && { opacity: 0.5 },
                            ]}
                            disabled={disabled}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                selected ? styles.chipTextActive : styles.chipTextIdle,
                              ]}
                            >
                              {label}
                              {disabled ? " • assigned" : ""}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                </>
              )}
            </View>

            {/* Section: Meters */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Meters of tenant</Text>
              {!detailsTenant ? (
                <Text style={styles.empty}>No tenant selected.</Text>
              ) : !detailsEdit ? (
                tenantMeters.length === 0 ? (
                  <Text style={styles.empty}>No meters found for this tenant.</Text>
                ) : (
                  tenantMeters.map((m) => (
                    <Text key={m.meter_id} style={styles.kv}>
                      <Text style={styles.k}>• {m.meter_id}</Text>{" "}
                      <Text style={styles.v}>
                        {m.meter_type.toUpperCase()} · SN: {m.meter_sn} · Stall: {m.stall_id} · {m.meter_status}
                      </Text>
                    </Text>
                  ))
                )
              ) : (
                <>
                  {Object.keys(edMetersMap).length === 0 ? (
                    <Text style={styles.empty}>No meters found for this tenant.</Text>
                  ) : (
                    Object.entries(edMetersMap).map(([meterId, stallId]) => (
                      <View key={meterId} style={[styles.rowWrap, { alignItems: "center", gap: 12 }]}>
                        <Text style={[styles.kv, { minWidth: 120 }]}><Text style={styles.k}>• {meterId}</Text></Text>
                        <View style={[styles.pickerWrapper, { flex: 1 }]}>
                          <Picker
                            selectedValue={stallId}
                            onValueChange={(v) =>
                              setEdMetersMap((prev) => ({ ...prev, [meterId]: String(v) }))
                            }
                            style={styles.picker}
                          >
                            {[...edSelectedStallIds].map((sid) => (
                              <Picker.Item key={sid} label={`Stall ${sid}`} value={sid} />
                            ))}
                          </Picker>
                        </View>
                      </View>
                    ))
                  )}
                  <Text style={[styles.kv, { marginTop: 6, fontSize: 12, color: "#475569" }]}>
                    Only stalls selected above are available as meter targets.
                  </Text>
                </>
              )}
            </View>

            {/* Section: Tenant Rate (VAT) */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Tenant Rate</Text>
              {!detailsEdit ? (
                !tenantRate ? (
                  <Text style={styles.empty}>No rate configured for this tenant.</Text>
                ) : (
                  <>
                    <Text style={styles.kv}><Text style={styles.k}>E-VAT:</Text> <Text style={styles.v}>{tenantRate.e_vat ?? "—"}</Text></Text>
                    <Text style={styles.kv}><Text style={styles.k}>W-VAT:</Text> <Text style={styles.v}>{tenantRate.w_vat ?? "—"}</Text></Text>
                    <Text style={styles.kv}><Text style={styles.k}>W-Net VAT:</Text> <Text style={styles.v}>{tenantRate.wnet_vat ?? "—"}</Text></Text>
                    {!!tenantRate.last_updated && (
                      <Text style={styles.kv}><Text style={styles.k}>Last updated:</Text> <Text style={styles.v}>{formatDateTime(tenantRate.last_updated)}</Text></Text>
                    )}
                  </>
                )
              ) : (
                <View style={styles.rowWrap}>
                  <View style={{ flex: 1, marginTop: 8 }}>
                    <Text style={styles.dropdownLabel}>E-VAT</Text>
                    <TextInput keyboardType="numeric" style={styles.input} value={edRateEVat} onChangeText={setEdRateEVat} placeholder="e.g. 12" />
                  </View>
                  <View style={{ flex: 1, marginTop: 8 }}>
                    <Text style={styles.dropdownLabel}>W-VAT</Text>
                    <TextInput keyboardType="numeric" style={styles.input} value={edRateWVat} onChangeText={setEdRateWVat} placeholder="e.g. 12" />
                  </View>
                  <View style={{ flex: 1, marginTop: 8 }}>
                    <Text style={styles.dropdownLabel}>W-Net VAT</Text>
                    <TextInput keyboardType="numeric" style={styles.input} value={edRateWNetVat} onChangeText={setEdRateWNetVat} placeholder="e.g. 0" />
                  </View>
                </View>
              )}
            </View>

            {/* Section: Building Rates (display only) */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Building Rates</Text>
              {!buildingBase ? (
                <Text style={styles.empty}>No base rates found for this building.</Text>
              ) : (
                <>
                  <Text style={styles.kv}><Text style={styles.k}>Electric (₱/kWh):</Text> <Text style={styles.v}>{buildingBase.erate_perKwH ?? "—"}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Electric Min. Consumption:</Text> <Text style={styles.v}>{buildingBase.emin_con ?? "—"}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Water (₱/cbm):</Text> <Text style={styles.v}>{buildingBase.wrate_perCbM ?? "—"}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>Water Min. Consumption:</Text> <Text style={styles.v}>{buildingBase.wmin_con ?? "—"}</Text></Text>
                  <Text style={styles.kv}><Text style={styles.k}>LPG (₱/kg):</Text> <Text style={styles.v}>{buildingBase.lrate_perKg ?? "—"}</Text></Text>
                  {!!buildingBase.last_updated && (
                    <Text style={styles.kv}><Text style={styles.k}>Last updated:</Text> <Text style={styles.v}>{formatDateTime(buildingBase.last_updated)}</Text></Text>
                  )}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  </KeyboardAvoidingView>
</Modal>


      {/* Classic EDIT modal (unchanged) */}
      <Modal
        visible={editVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, styles.modalCardLarge]}>
            <Text style={styles.modalTitle}>Edit Tenant {editRow?.tenant_id}</Text>
            <View style={styles.modalDivider} />

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Serial No.</Text>
                  <TextInput style={styles.input} value={editSn} onChangeText={setEditSn} />
                </View>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Name</Text>
                  <TextInput style={styles.input} value={editName} onChangeText={setEditName} />
                </View>
              </View>

              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Building</Text>
                  <View style={styles.pickerWrapper}>
                    <Picker
                      selectedValue={editBuildingId}
                      onValueChange={(v) => setEditBuildingId(String(v))}
                      style={styles.picker}
                      enabled={isAdmin}
                    >
                      {createBuildingOptions.map((opt) => (
                        <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                      ))}
                    </Picker>
                  </View>
                </View>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Bill Start</Text>
                  <TextInput style={styles.input} value={editBillStart} onChangeText={setEditBillStart} />
                </View>
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Status</Text>
                <View style={styles.chipsRow}>
                  {["active", "inactive"].map((st) => (
                    <Chip key={st} label={st.toUpperCase()} active={editStatus === (st as any)} onPress={() => setEditStatus(st as any)} />
                  ))}
                </View>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save changes</Text>}
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
  grid: { padding: 12, gap: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16,42,67,0.08)" as any },
      default: { elevation: 2 },
    }) as any),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },

  // search + filters layout
  filtersBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    alignItems: "flex-start",
    marginTop: 6,
  },

  filterCol: { minWidth: 220, flexShrink: 1 },

  dropdownLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#486581",
    marginBottom: 6,
  },

  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipIdle: { borderColor: "#94a3b8", backgroundColor: "#fff" },
  chipActive: { borderColor: "#2563eb", backgroundColor: "#2563eb" },
  chipText: { fontSize: 12 },
  chipTextIdle: { color: "#334e68" },
  chipTextActive: { color: "#fff" },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
    minWidth: 220,
  },
  search: { flex: 1, color: "#0f172a", paddingVertical: 6 },

  btn: {
    backgroundColor: "#0f62fe",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  btnWarn: { backgroundColor: "#d97706" },
  btnText: { color: "#fff", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  btnGhostText: { color: "#0f172a" },

  input: {
    height: 38,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 10,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
  },

  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#f8fafc",
  },
  picker: { height: 38 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#eef2f7",
    paddingVertical: 10,
    gap: 10,
  },
  rowTitle: { fontWeight: "700", color: "#102a43" },
  rowSub: { color: "#64748b", marginTop: 2, fontSize: 12 },

  badge: { backgroundColor: "#e5e7eb", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, alignSelf: "center" },
  badgeText: { color: "#102a43", fontSize: 12 },

  loader: { alignItems: "center", justifyContent: "center", padding: 20 },
  empty: { color: "#64748b", paddingVertical: 8 },

  // modal
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    width: "100%",
    maxWidth: 720,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef2f7",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(16,42,67,0.08)" as any },
      default: { elevation: 4 },
    }) as any),
  },
  modalCardLarge: {
    maxWidth: 980,
    maxHeight: "75%",
  },
  scrollArea: {
    flexGrow: 1,
    minHeight: 0,     // lets the ScrollView shrink inside flex layouts
    maxHeight: "100%",
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#102a43" },
  modalDivider: {
    height: 1,
    backgroundColor: "#eef2f7",
    marginVertical: 10,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 10,
  },

  rowWrap: { flexDirection: "row", gap: 8 },

  // details sections
  sectionCard: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#eef2f7",
    borderRadius: 10,
    backgroundColor: "#fafbff",
  },
  sectionTitle: { fontWeight: "800", color: "#0f172a", marginBottom: 6 },
  kv: { color: "#0f172a", marginTop: 2 },
  k: { fontWeight: "700" },
  v: { color: "#0f172a" },
  actionBtnGhostText: { color: "#1f4bd8", fontWeight: "800" },
  actionBtnGhost: { backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#cbd5e1" },
  actionBtn: { backgroundColor: "#1f4bd8", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },

});