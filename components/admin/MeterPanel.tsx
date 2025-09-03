import React, { useEffect, useMemo, useRef, useState } from "react";
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
import QRCode from "react-native-qrcode-svg";
import { BASE_API } from "../../constants/api";

// ------------ ALERT HELPERS (web + mobile) ------------
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
// ------------------------------------------------------

// ---- Types ----
export type Meter = {
  meter_id: string;
  meter_type: "electric" | "water" | "lpg";
  meter_sn: string;
  meter_mult: number;
  stall_id: string;
  meter_status: "active" | "inactive";
  last_updated: string;
  updated_by: string;
};

export type Stall = {
  stall_id: string;
  stall_sn: string;
  building_id?: string;
};

type Building = {
  building_id: string;
  building_name: string;
};

// --- Tiny JWT payload decoder (same style as TenantsPanel) ---
function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1] || "";
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
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
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function MeterPanel({ token }: { token: string | null }) {
  // decode role + assigned building
  const jwt = useMemo(() => decodeJwtPayload(token), [token]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");

  // data state
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]); // NEW: to show building names

  // search & filter & sort
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "electric" | "water" | "lpg">("all");
  const [buildingFilter, setBuildingFilter] = useState<string>(""); // "" = ALL
  const [sortBy, setSortBy] = useState<"id_asc" | "id_desc" | "type" | "stall" | "status">("id_asc");

  // create form
  const [createVisible, setCreateVisible] = useState(false);
  const [type, setType] = useState<Meter["meter_type"]>("electric");
  const [sn, setSn] = useState("");
  const [mult, setMult] = useState("1.00");
  const [stallId, setStallId] = useState("");
  const [status, setStatus] = useState<Meter["meter_status"]>("inactive");

  // edit form
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Meter | null>(null);
  const [editType, setEditType] = useState<Meter["meter_type"]>("electric");
  const [editSn, setEditSn] = useState("");
  const [editMult, setEditMult] = useState("1.00");
  const [editStallId, setEditStallId] = useState("");
  const [editStatus, setEditStatus] = useState<Meter["meter_status"]>("inactive");

  // QR modal
  const [qrVisible, setQrVisible] = useState(false);
  const [qrMeterId, setQrMeterId] = useState("");
  const qrRef = useRef<any>(null);

  // api
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(
    () => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }),
    [authHeader]
  );

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in to manage meters.");
      return;
    }
    try {
      setBusy(true);
      const [metersRes, stallsRes] = await Promise.all([
        api.get<Meter[]>("/meters"),
        api.get<Stall[]>("/stalls"),
      ]);
      setMeters(metersRes.data || []);
      setStalls(stallsRes.data || []);

      // Only admins can fetch /buildings — names for chips
      if (isAdmin) {
        try {
          const bRes = await api.get<Building[]>("/buildings");
          setBuildings(bRes.data || []);
        } catch {
          setBuildings([]); // keep going even if this fails
        }
      } else {
        setBuildings([]);
      }
    } catch (err: any) {
      console.error("[METERS LOAD]", err?.response?.data || err?.message);
      notify("Load failed", errorText(err, "Could not load meters/stalls."));
    } finally {
      setBusy(false);
    }
  };

  // helpers
  const mtrNum = (id: string) => {
    const m = /^MTR-(\d+)/i.exec(id || "");
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };

  // stall -> building map (id only; used for filtering when operator)
  const stallToBuilding = useMemo(() => {
    const m = new Map<string, string>();
    stalls.forEach((s) => {
      if (s?.stall_id && s?.building_id) m.set(s.stall_id, s.building_id);
    });
    return m;
  }, [stalls]);

  // --- BUILDING CHIPS (labels with names if admin, else fallback to ID) ---
  const buildingChipOptions = useMemo(() => {
    if (isAdmin && buildings.length) {
      return [
        { label: "All Buildings", value: "" },
        ...buildings
          .slice()
          .sort((a, b) => a.building_name.localeCompare(b.building_name))
          .map((b) => ({
            label: `${b.building_name} (${b.building_id})`,
            value: b.building_id,
          })),
      ];
    }
    // operator: show only assigned building (if any) or fallback from stalls set
    const fallbackIds = new Set<string>();
    stalls.forEach((s) => s?.building_id && fallbackIds.add(s.building_id));
    const ids = Array.from(fallbackIds);
    const base = [{ label: "All Buildings", value: "" }];
    if (userBuildingId) return base.concat([{ label: userBuildingId, value: userBuildingId }]);
    if (ids.length) return base.concat(ids.sort().map((id) => ({ label: id, value: id })));
    return base;
  }, [isAdmin, buildings, stalls, userBuildingId]);

  // search + filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = meters;

    if (filterType !== "all") list = list.filter((m) => m.meter_type === filterType);

    if (buildingFilter) {
      list = list.filter((m) => stallToBuilding.get(m.stall_id) === buildingFilter);
    }

    if (!q) return list;
    return list.filter((m) =>
      [m.meter_id, m.meter_sn, m.meter_type, m.stall_id, m.meter_status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [meters, query, filterType, buildingFilter, stallToBuilding]);

  // sorting
  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sortBy) {
      case "id_desc":
        arr.sort((a, b) => mtrNum(b.meter_id) - mtrNum(a.meter_id) || b.meter_id.localeCompare(a.meter_id));
        break;
      case "type":
        arr.sort((a, b) => a.meter_type.localeCompare(b.meter_type) || mtrNum(a.meter_id) - mtrNum(b.meter_id));
        break;
      case "stall":
        arr.sort(
          (a, b) => (a.stall_id || "").localeCompare(b.stall_id || "") || mtrNum(a.meter_id) - mtrNum(b.meter_id)
        );
        break;
      case "status": {
        const rank = (s: Meter["meter_status"]) => (s === "active" ? 0 : 1);
        arr.sort((a, b) => rank(a.meter_status) - rank(b.meter_status) || mtrNum(a.meter_id) - mtrNum(b.meter_id));
        break;
      }
      case "id_asc":
      default:
        arr.sort((a, b) => mtrNum(a.meter_id) - mtrNum(b.meter_id) || a.meter_id.localeCompare(b.meter_id));
        break;
    }
    return arr;
  }, [filtered, sortBy]);

  // CRUD (unchanged)
  const onCreate = async () => {
    if (!sn.trim() || !stallId.trim()) {
      notify("Missing info", "Serial number and Stall are required.");
      return;
    }
    const multValue = mult.trim() === "" ? undefined : Number(mult);
    const payload: any = {
      meter_type: type,
      meter_sn: sn.trim(),
      stall_id: stallId.trim(),
      meter_status: status,
      ...(multValue !== undefined ? { meter_mult: multValue } : {}),
    };
    try {
      setSubmitting(true);
      await api.post("/meters", payload);
      notify("Success", "Meter added.");

      // reset + close modal
      setSn("");
      setMult("1.00");
      setStallId("");
      setStatus("inactive");
      setCreateVisible(false);
      await loadAll();
    } catch (err: any) {
      console.error("[METER CREATE]", err?.response?.data || err?.message);
      notify("Create failed", errorText(err, "Unable to add meter."));
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (m: Meter) => {
    setEditRow(m);
    setEditType(m.meter_type);
    setEditSn(m.meter_sn);
    setEditMult(String(m.meter_mult ?? "1"));
    setEditStallId(m.stall_id);
    setEditStatus(m.meter_status);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!editRow) return;
    const multValue = editMult.trim() === "" ? undefined : Number(editMult);
    const body: any = {
      meter_type: editType,
      meter_sn: editSn.trim(),
      stall_id: editStallId.trim(),
      meter_status: editStatus,
      ...(multValue !== undefined ? { meter_mult: multValue } : {}),
    };

    try {
      setSubmitting(true);
      await api.put(`/meters/${encodeURIComponent(editRow.meter_id)}`, body);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Meter updated successfully.");
    } catch (err: any) {
      console.error("[METER UPDATE]", err?.response?.data || err?.message);
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (m: Meter) => {
    const ok = await confirm("Delete meter", `Are you sure you want to delete ${m.meter_id}?`);
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/meters/${encodeURIComponent(m.meter_id)}`);
      await loadAll();
      notify("Deleted", "Meter removed.");
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openQr = (meter_id: string) => {
    setQrMeterId(meter_id);
    setQrVisible(true);
  };

  const downloadQr = () => {
    if (!qrRef.current) return;
    try {
      qrRef.current.toDataURL((data: string) => {
        const dataUrl = `data:image/png;base64,${data}`;
        if (Platform.OS === "web" && typeof document !== "undefined") {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `${qrMeterId || "meter-qr"}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else {
          notify("Save QR", "On mobile, please take a screenshot of this QR.");
        }
      });
    } catch (err) {
      console.error("[QR DOWNLOAD]", err);
      notify("Download failed", "Could not generate QR image.");
    }
  };

  if (busy) {
    return (
      <View style={[styles.grid, { padding: 12 }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {/* --- Manage list + Create button --- */}
      <View style={styles.card}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <Text style={styles.cardTitle}>Manage Meters</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
            <Text style={styles.btnText}>+ Create Meter</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by ID, SN, type, stall, status"
          style={styles.search}
        />

{/* Filters bar — BUILDING (left) + TYPE above SORT (right) */}
<View style={styles.filtersBar}>
  {/* Building chips (left) */}
  <View style={styles.filterCol}>
    <Text style={styles.dropdownLabel}>Filter by Building</Text>
    <View style={styles.chipsRow}>
      {buildingChipOptions.map((opt) => (
        <Chip
          key={opt.value || "all"}
          label={opt.label}
          active={buildingFilter === opt.value}
          onPress={() => setBuildingFilter(opt.value)}
        />
      ))}
    </View>
  </View>

  {/* Right column: TYPE (top) + SORT (bottom) */}
  <View style={[styles.filterCol, styles.stackCol]}>
    {/* Type */}
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.dropdownLabel}>Filter by Type</Text>
      <View style={styles.chipsRow}>
        {[
          { label: "ALL", val: "all" },
          { label: "ELECTRIC", val: "electric" },
          { label: "WATER", val: "water" },
          { label: "GAS", val: "lpg" },
        ].map(({ label, val }) => (
          <TouchableOpacity
            key={label}
            style={[styles.chip, filterType === (val as any) && styles.chipActive]}
            onPress={() => setFilterType(val as any)}
          >
            <Text style={[styles.chipText, filterType === (val as any) && styles.chipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>

    {/* Sort */}
    <View>
      <Text style={styles.dropdownLabel}>Sort</Text>
      <View style={styles.chipsRow}>
        {[
          { label: "ID ↑", val: "id_asc" },
          { label: "ID ↓", val: "id_desc" },
          { label: "Type", val: "type" },
          { label: "Stall", val: "stall" },
          { label: "Status", val: "status" },
        ].map(({ label, val }) => (
          <TouchableOpacity
            key={val}
            style={[styles.chip, sortBy === (val as any) && styles.chipActive]}
            onPress={() => setSortBy(val as any)}
          >
            <Text style={[styles.chipText, sortBy === (val as any) && styles.chipTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  </View>

  {(filterType !== "all" || buildingFilter !== "") && (
    <TouchableOpacity
      style={styles.clearBtn}
      onPress={() => {
        setFilterType("all");
        setBuildingFilter("");
      }}
    >
      <Text style={styles.clearBtnText}>Clear</Text>
    </TouchableOpacity>
  )}
</View>


        {sorted.length === 0 ? (
          <Text style={{ paddingVertical: 8, color: "#627d98" }}>No meters found.</Text>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.meter_id}
            renderItem={({ item }) => (
              <View style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.meter_id} • {item.meter_type}
                  </Text>
                  <Text style={styles.rowSub}>
                    SN: {item.meter_sn} • Mult: {item.meter_mult} • Stall: {item.stall_id} • {item.meter_status}
                  </Text>
                </View>
                <TouchableOpacity style={styles.link} onPress={() => openEdit(item)}>
                  <Text style={styles.linkText}>Update</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => onDelete(item)}>
                  <Text style={[styles.linkText, { color: "#e53935" }]}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.link, { marginLeft: 8 }]} onPress={() => openQr(item.meter_id)}>
                  <Text style={styles.linkText}>QR</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      {/* --- CREATE MODAL --- */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Create Meter</Text>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={styles.dropdownLabel}>Type</Text>
              <View style={styles.pickerWrapper}>
                <Picker selectedValue={type} onValueChange={(v) => setType(v)} style={styles.picker}>
                  <Picker.Item label="Electric" value="electric" />
                  <Picker.Item label="Water" value="water" />
                  <Picker.Item label="LPG (Gas)" value="lpg" />
                </Picker>
              </View>

              <Text style={styles.dropdownLabel}>Serial Number</Text>
              <TextInput value={sn} onChangeText={setSn} placeholder="e.g. UGF-E-000111" style={styles.input} />

              <Text style={styles.dropdownLabel}>Multiplier</Text>
              <TextInput value={mult} onChangeText={setMult} keyboardType="numeric" placeholder="1.00" style={styles.input} />

              <Text style={styles.dropdownLabel}>Stall</Text>
              <View style={styles.pickerWrapper}>
                <Picker selectedValue={stallId} onValueChange={(v) => setStallId(v)} style={styles.picker}>
                  <Picker.Item label="Select a stall" value="" />
                  {stalls.map((s) => (
                    <Picker.Item key={s.stall_id} label={`${s.stall_id} • ${s.stall_sn || ""}`} value={s.stall_id} />
                  ))}
                </Picker>
              </View>

              <Text style={styles.dropdownLabel}>Status</Text>
              <View style={styles.pickerWrapper}>
                <Picker selectedValue={status} onValueChange={(v) => setStatus(v)} style={styles.picker}>
                  <Picker.Item label="Inactive" value="inactive" />
                  <Picker.Item label="Active" value="active" />
                </Picker>
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setCreateVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Meter</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* --- EDIT MODAL --- */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit {editRow?.meter_id}</Text>

            <Text style={styles.dropdownLabel}>Type</Text>
            <View style={styles.pickerWrapper}>
              <Picker selectedValue={editType} onValueChange={(v) => setEditType(v)} style={styles.picker}>
                <Picker.Item label="Electric" value="electric" />
                <Picker.Item label="Water" value="water" />
                <Picker.Item label="LPG (Gas)" value="lpg" />
              </Picker>
            </View>

            <Text style={styles.dropdownLabel}>Serial Number</Text>
            <TextInput value={editSn} onChangeText={setEditSn} style={styles.input} />

            <Text style={styles.dropdownLabel}>Multiplier</Text>
            <TextInput
              value={editMult}
              onChangeText={setEditMult}
              keyboardType="numeric"
              placeholder="Leave blank to keep/default"
              style={styles.input}
            />

            <Text style={styles.dropdownLabel}>Stall</Text>
            <View style={styles.pickerWrapper}>
              <Picker selectedValue={editStallId} onValueChange={(v) => setEditStallId(v)} style={styles.picker}>
                {stalls.map((s) => (
                  <Picker.Item key={s.stall_id} label={`${s.stall_id} • ${s.stall_sn || ""}`} value={s.stall_id} />
                ))}
              </Picker>
            </View>

            <Text style={styles.dropdownLabel}>Status</Text>
            <View style={styles.pickerWrapper}>
              <Picker selectedValue={editStatus} onValueChange={(v) => setEditStatus(v)} style={styles.picker}>
                <Picker.Item label="Inactive" value="inactive" />
                <Picker.Item label="Active" value="active" />
              </Picker>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- QR MODAL --- */}
      <Modal visible={qrVisible} animationType="fade" transparent onRequestClose={() => setQrVisible(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>QR: {qrMeterId}</Text>
            <View style={{ alignItems: "center", paddingVertical: 8 }}>
              <QRCode value={qrMeterId || ""} size={220} getRef={(c) => (qrRef.current = c)} />
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setQrVisible(false)}>
                <Text style={styles.btnGhostText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={downloadQr}>
                <Text style={styles.btnText}>Download</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// --- Small UI helpers ---
function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// --- Styles ---
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
  dropdownLabel: {
    color: "#334e68",
    marginBottom: 6,
    marginTop: 6,
    fontWeight: "600",
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  picker: { height: 50 },
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
    marginTop: 12,
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  btnGhostText: { color: "#102a43", fontWeight: "700" },

  /* Chips bar */
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
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  clearBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
    alignSelf: "flex-end",
  },
  clearBtnText: { color: "#334e68", fontWeight: "700" },

  /* Chip styles */
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
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43",
    marginBottom: 12,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
  stackCol: { flexDirection: "column" },
});