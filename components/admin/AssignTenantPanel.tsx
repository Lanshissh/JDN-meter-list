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

/** Types */
type Props = { token: string | null };

type Building = { building_id: string; building_name: string };

type Stall = {
  stall_id: string;
  stall_sn: string;
  building_id: string;
  tenant_id: string | null;
  stall_status: "available" | "occupied" | string;
  last_updated?: string | null;
};

type Tenant = {
  tenant_id: string;
  tenant_name: string;
  building_id: string;
  tenant_status: "active" | "inactive" | string;
};

/* ---------------- Alerts & helpers (web + mobile) ---------------- */
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

/* ===================== Component ===================== */
export default function AssignTenantPanel({ token }: Props) {
  const authHeader = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  // data state
  const [loading, setLoading] = useState(true);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);

  // filters
  const [buildingId, setBuildingId] = useState<string>("");
  const [search, setSearch] = useState("");

  // assign modal
  const [assignVisible, setAssignVisible] = useState(false);
  const [assignStall, setAssignStall] = useState<Stall | null>(null);
  const [assignTenantId, setAssignTenantId] = useState<string>("");
  const [tenantQuery, setTenantQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ------------ Load data ------------ */
  useEffect(() => { (async () => {
    try {
      setLoading(true);
      const [bRes, sRes, tRes] = await Promise.all([
        api.get<Building[]>("/buildings"),
        api.get<Stall[]>("/stalls"),
        api.get<Tenant[]>("/tenants"),
      ]);
      const b = bRes.data || [];
      const s = sRes.data || [];
      const t = tRes.data || [];
      setBuildings(b);
      setStalls(s);
      setTenants(t);
      if (!buildingId && b.length) setBuildingId(String(b[0].building_id));
    } catch (err) {
      notify("Load failed", errorText(err));
    } finally { setLoading(false); }
  })(); }, []);

  /* ------------ Derived lists ------------ */
  const availableStalls = useMemo(() => {
    let list = stalls.filter((s) => s.stall_status === "available");
    if (buildingId) list = list.filter((s) => String(s.building_id) === String(buildingId));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) => s.stall_sn?.toLowerCase().includes(q) || s.stall_id.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => String(a.stall_sn||"").localeCompare(String(b.stall_sn||""), undefined, { numeric: true, sensitivity: "base" }));
  }, [stalls, buildingId, search]);

  const activeTenantsSameBuilding = useMemo(() => {
    const list = tenants.filter((t) => t.tenant_status === "active" && (!buildingId || String(t.building_id) === String(buildingId)));
    const q = tenantQuery.trim().toLowerCase();
    const filtered = q ? list.filter((t) => t.tenant_name.toLowerCase().includes(q) || t.tenant_id.toLowerCase().includes(q)) : list;
    return filtered.sort((a, b) => a.tenant_name.localeCompare(b.tenant_name, undefined, { numeric: true, sensitivity: "base" }));
  }, [tenants, buildingId, tenantQuery]);

  /* ------------ Actions ------------ */
  function openAssignModal(stall: Stall) {
    setAssignStall(stall);
    setAssignTenantId("");
    setTenantQuery("");
    setAssignVisible(true);
  }

  async function confirmAssign() {
    if (!assignStall) return;
    if (!assignTenantId) { notify("Incomplete", "Please select a tenant to assign."); return; }
    try {
      setSubmitting(true);
      await api.put(`/stalls/${assignStall.stall_id}`, {
        stall_status: "occupied",
        tenant_id: assignTenantId,
        building_id: assignStall.building_id,
      });
      setAssignVisible(false);
      setAssignStall(null);
      setAssignTenantId("");
      // refresh
      const sRes = await api.get<Stall[]>("/stalls");
      setStalls(sRes.data || []);
      notify("Success", "Tenant assigned to stall.");
    } catch (err) {
      notify("Assign failed", errorText(err));
    } finally { setSubmitting(false); }
  }

  /* ------------ Rendering ------------ */
  const renderRow = ({ item }: { item: Stall }) => (
    <View style={styles.rowCard}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{item.stall_sn}</Text>
        <Text style={styles.rowSub}>ID: {item.stall_id}  •  Status: {String(item.stall_status).toUpperCase()}</Text>
      </View>
      <TouchableOpacity style={[styles.smallBtn, styles.primaryBtn]} onPress={() => openAssignModal(item)}>
        <Ionicons name="person-add-outline" size={16} color="#fff" />
        <Text style={styles.smallBtnText}>Assign</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={styles.header}> 
        <Text style={styles.title}>Assign Tenant to Stall</Text>
        <Text style={styles.subtitle}>Pick an AVAILABLE stall and assign an ACTIVE tenant in the same building.</Text>
      </View>

      {/* Filters: mobile-first layout */}
      <View style={styles.filtersBar}>
        <View style={[styles.searchWrap, { flex: 1 }]}>
          <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
          <TextInput
            placeholder="Search stall SN or ID"
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
            style={styles.input}
          />
        </View>
      </View>

      {/* Building selector (kept simple + touch-friendly) */}
      <View style={styles.selectorCard}>
        <Text style={styles.fieldLabel}>Building</Text>
        <View style={styles.dropdown}>
          <Picker selectedValue={buildingId} onValueChange={(v) => setBuildingId(String(v))} mode="dropdown">
            {buildings.map((b) => (
              <Picker.Item key={b.building_id} label={`${b.building_name} (${b.building_id})`} value={b.building_id} />
            ))}
          </Picker>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ paddingVertical: 24 }}><ActivityIndicator /></View>
      ) : (
        <FlatList
          data={availableStalls}
          keyExtractor={(s) => s.stall_id}
          renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 20 }}
          ListEmptyComponent={<Text style={styles.empty}>No available stalls.</Text>}
        />
      )}

      {/* Assign Modal */}
      <Modal visible={assignVisible} transparent animationType="fade" onRequestClose={() => setAssignVisible(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View style={[styles.modalCard, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.92) }]}>
              <Text style={styles.modalTitle}>Assign Tenant</Text>
              <View style={styles.modalDivider} />

              {/* Selected stall summary */}
              {assignStall ? (
                <View style={styles.summaryBox}>
                  <Ionicons name="information-circle-outline" size={18} color="#2563eb" />
                  <Text style={styles.summaryText}>
                    {assignStall.stall_sn} ({assignStall.stall_id}) • Building {assignStall.building_id}
                  </Text>
                </View>
              ) : null}

              {/* Tenant search + picker */}
              <View style={{ marginTop: 8 }}>
                <Text style={styles.fieldLabel}>Tenant</Text>
                <View style={[styles.searchWrap, { marginBottom: 6 }]}>
                  <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
                  <TextInput
                    placeholder="Search tenant by name or ID"
                    placeholderTextColor="#94a3b8"
                    value={tenantQuery}
                    onChangeText={setTenantQuery}
                    style={styles.input}
                  />
                </View>
                <View style={styles.dropdownTall}>
                  <Picker
                    selectedValue={assignTenantId}
                    onValueChange={(v) => setAssignTenantId(String(v))}
                    mode="dropdown"
                  >
                    <Picker.Item label="Select a tenant…" value="" />
                    {activeTenantsSameBuilding.map((t) => (
                      <Picker.Item key={t.tenant_id} label={`${t.tenant_name} (${t.tenant_id})`} value={t.tenant_id} />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* Footer actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.smallBtn, styles.ghostBtn]} onPress={() => setAssignVisible(false)} disabled={submitting}>
                  <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn, styles.primaryBtn, submitting && styles.btnDisabled]} onPress={confirmAssign} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                      <Text style={styles.smallBtnText}>Assign</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

/* ===================== Styles (mobile-first) ===================== */
const styles = StyleSheet.create({
  header: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 12, color: "#475569", marginTop: 2 },

  filtersBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, marginTop: 8, gap: 8 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderColor: "#e2e8f0",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  input: { flex: 1, fontSize: 14, color: "#0f172a", paddingVertical: 0 },

  selectorCard: { marginTop: 8, marginHorizontal: 12, backgroundColor: "#fff", borderRadius: 12, padding: 10, },
  fieldLabel: { fontSize: 12, color: "#475569", marginBottom: 4 },
  dropdown: { borderRadius: 10, overflow: "hidden", backgroundColor: "#f8fafc", borderColor: "#e2e8f0", borderWidth: StyleSheet.hairlineWidth },
  dropdownTall: { borderRadius: 10, overflow: "hidden", backgroundColor: "#f8fafc", borderColor: "#e2e8f0", borderWidth: StyleSheet.hairlineWidth, maxHeight: 220 },

  rowCard: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, backgroundColor: "#fff", borderRadius: 12, padding: 12, marginHorizontal: 12, },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowSub: { fontSize: 12, color: "#64748b", marginTop: 2 },

  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  smallBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  primaryBtn: { backgroundColor: "#2563eb" },
  ghostBtn: { backgroundColor: "#e2e8f0" },
  ghostBtnText: { color: "#1f2937" },
  btnDisabled: { opacity: 0.65 },

  empty: { textAlign: "center", color: "#6b7280", marginTop: 16 },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 },
  modalCard: {
    marginHorizontal: 8,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    ...(Platform.select({ web: { maxWidth: 560, alignSelf: "center" }, default: {} }) as any),
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  modalDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "#e5e7eb", marginVertical: 10 },
  summaryBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#eff6ff", borderColor: "#bfdbfe", borderWidth: StyleSheet.hairlineWidth, padding: 8, borderRadius: 10 },
  summaryText: { fontSize: 13, color: "#1e40af" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
});
