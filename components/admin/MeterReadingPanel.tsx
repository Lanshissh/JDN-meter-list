// components/admin/MeterReadingPanel.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Linking,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import NetInfo from "@react-native-community/netinfo";
import { QRCodeScanner, OnSuccessfulScanProps } from "@masumdev/rn-qrcode-scanner";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";
import { useScanHistory } from "../../contexts/ScanHistoryContext";

/* ---------- helpers ---------- */
const todayStr = () => new Date().toISOString().slice(0, 10);
function notify(title: string, message?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert)
    window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
function errorText(err: any, fallback = "Server error.") {
  try {
    const res = err?.response;
    const data = res?.data;
    const status = res?.status;
    const method = res?.config?.method?.toUpperCase?.();
    const url = res?.config?.url;

    const header = status
      ? `${method || "REQUEST"} ${url || ""} → ${status}`
      : (typeof err?.message === "string" && err.message) || null;

    const pick = (v: any): string | null => {
      if (!v) return null;
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      if (typeof v === "object") {
        if (typeof (v as any).error === "string") return (v as any).error;
        if (typeof (v as any).message === "string") return (v as any).message;
        if ((v as any).error && typeof (v as any).error.message === "string") return (v as any).error.message;
        return JSON.stringify(v, null, 2);
      }
      return null;
    };

    const body =
      pick(data) ||
      pick(err?.message) ||
      (err?.toString && err.toString() !== "[object Object]" ? err.toString() : null) ||
      fallback;

    return [header, body].filter(Boolean).join("\n\n");
  } catch {
    return fallback;
  }
}
function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null;
  try {
    const raw = token.trim().replace(/^Bearer\s+/i, "");
    const part = raw.split(".")[1] || "";
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
function fmtValue(n: number | string | null | undefined, unit?: string) {
  if (n == null) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!isFinite(v)) return String(n);
  const formatted = Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  return unit ? `${formatted} ${unit}` : formatted;
}
function formatDateTime(dt: string) {
  try {
    const d = new Date(dt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch { return dt; }
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
// Convert any base64 / data URL into a usable preview URL for <Image>
function toDataUrl(val?: string) {
  const s = (val || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  return `data:image/jpeg;base64,${s}`;
}

/* ---------- types ---------- */
export type Reading = {
  reading_id: string;
  meter_id: string;
  reading_value: number;
  read_by: string;
  lastread_date: string;
  last_updated: string;
  updated_by: string;
  remarks?: string | null;
};
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
type Stall = { stall_id: string; building_id?: string; stall_sn?: string };
type Building = { building_id: string; building_name: string };

export default function MeterReadingPanel({ token }: { token: string | null }) {
  // auth + api
  const jwt = useMemo(() => decodeJwtPayload(token), [token]);
  const rolesRaw = String(jwt?.user_level ?? jwt?.user_roles ?? "").toLowerCase();
  const isAdmin = rolesRaw.includes("admin");
  const isOperator = rolesRaw.includes("operator");
  const canWrite = isAdmin || isOperator;
  const userBuildingId = String(jwt?.building_id || "");

  const headerToken =
    token && /^Bearer\s/i.test(token.trim()) ? token.trim() : token ? `Bearer ${token.trim()}` : "";
  const authHeader = useMemo(() => (headerToken ? { Authorization: headerToken } : {}), [headerToken]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  // device
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  // connectivity
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => setIsConnected(!!s.isConnected));
    NetInfo.fetch().then((s) => setIsConnected(!!s.isConnected));
    return () => sub && sub();
  }, []);
  const { scans, queueScan, removeScan, approveOne, approveAll, markPending, isConnected: ctxConnected } =
    useScanHistory();
  const online = isConnected ?? ctxConnected ?? false;

  // filters + data
  const [typeFilter, setTypeFilter] = useState<"" | "electric" | "water" | "lpg">("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "id_desc" | "id_asc">("date_desc");
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [buildingPickerVisible, setBuildingPickerVisible] = useState(false);

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // searches
  const [meterQuery, setMeterQuery] = useState("");
  const [query, setQuery] = useState("");

  // selection & modals
  const [selectedMeterId, setSelectedMeterId] = useState("");
  const [readingsModalVisible, setReadingsModalVisible] = useState(false);
  const PAGE_SIZE = 30;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [selectedMeterId]);

  const [createVisible, setCreateVisible] = useState(false);
  const [formMeterId, setFormMeterId] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState<string>(todayStr());
  const [formRemarks, setFormRemarks] = useState<string>("");
  const [formImage, setFormImage] = useState<string>(""); // REQUIRED for POST

  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Reading | null>(null);
  const [editMeterId, setEditMeterId] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editRemarks, setEditRemarks] = useState<string>("");
  const [editImage, setEditImage] = useState<string>(""); // optional (do not send to keep current image)

  const [scanVisible, setScanVisible] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);
  const readingInputRef = useRef<TextInput>(null);

  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyTab, setHistoryTab] = useState<"all" | "pending" | "failed" | "approved">("all");

  // Image tool modal
  const [imgToolVisible, setImgToolVisible] = useState(false);

  // ---------- AUTO-DETECT READING ENDPOINT ----------
  const READING_ENDPOINTS = ["/meter_reading", "/readings", "/meter-readings", "/meterreadings"];
  const [readingBase, setReadingBase] = useState<string>(READING_ENDPOINTS[0]);

  async function detectReadingEndpoint() {
    for (const p of READING_ENDPOINTS) {
      try {
        const res = await api.get(p, { validateStatus: () => true });
        // accept list or a wrapper with items
        if ((res.status >= 200 && res.status < 400 && Array.isArray(res.data)) || (res.status === 200 && res.data && typeof res.data === "object" && "items" in res.data)) {
          setReadingBase(p);
          return p;
        }
      } catch {
        // try next
      }
    }
    // keep default if none matched; errors will be shown by errorText
    return READING_ENDPOINTS[0];
  }

  // derived
  const filteredScans = useMemo(
    () => (historyTab === "all" ? scans : scans.filter((s) => s.status === historyTab)),
    [scans, historyTab]
  );
  const readNum = (id: string) => {
    const m = /^MR-(\d+)/i.exec(id || "");
    return m ? parseInt(m[1], 10) : 0;
  };

  // load
  useEffect(() => {
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in to manage meter readings.");
      return;
    }
    try {
      setBusy(true);

      // 1) detect the working readings route
      const base = await detectReadingEndpoint();

      // 2) fetch using detected base
      const [rRes, mRes, sRes] = await Promise.all([
        api.get<Reading[]>(base),
        api.get<Meter[]>("/meters"),
        api.get<Stall[]>("/stalls"),
      ]);
      setReadings(Array.isArray(rRes.data) ? rRes.data : (rRes.data as any)?.items ?? []);
      setMeters(mRes.data || []);
      setStalls(sRes.data || []);
      if (!formMeterId && mRes.data?.length) setFormMeterId(mRes.data[0].meter_id);
      if (isAdmin) {
        try {
          const bRes = await api.get<Building[]>("/buildings");
          setBuildings(bRes.data || []);
        } catch {
          setBuildings([]);
        }
      }
      if (!isAdmin && userBuildingId) setBuildingFilter((prev) => prev || userBuildingId);
    } catch (err: any) {
      notify("Load failed", errorText(err, "Please check your connection and permissions."));
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-console
        console.error("LOAD ERROR", err?.response ?? err);
      }
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (selectedMeterId) setFormMeterId(selectedMeterId);
  }, [selectedMeterId]);

  const metersById = useMemo(() => {
    const map = new Map<string, Meter>();
    meters.forEach((m) => map.set(m.meter_id, m));
    return map;
  }, [meters]);
  const stallToBuilding = useMemo(() => {
    const m = new Map<string, string>();
    stalls.forEach((s) => {
      if (s?.stall_id && s?.building_id) m.set(s.stall_id, s.building_id);
    });
    return m;
  }, [stalls]);

  const buildingChipOptions = useMemo(() => {
    if (isAdmin && buildings.length) {
      return [{ label: "All", value: "" }].concat(
        buildings
          .slice()
          .sort((a, b) => a.building_name.localeCompare(b.building_name))
          .map((b) => ({ label: b.building_name || b.building_id, value: b.building_id }))
      );
    }
    const base = [{ label: "All", value: "" }];
    if (userBuildingId) return base.concat([{ label: userBuildingId, value: userBuildingId }]);
    const ids = Array.from(new Set(stalls.map((s) => s.building_id).filter(Boolean) as string[])).sort();
    return base.concat(ids.map((id) => ({ label: id, value: id })));
  }, [isAdmin, buildings, stalls, userBuildingId]);

  const metersVisible = useMemo(() => {
    let list = meters;
    if (typeFilter) list = list.filter((m) => (m.meter_type || "").toLowerCase() === typeFilter);
    if (buildingFilter) list = list.filter((m) => stallToBuilding.get(m.stall_id || "") === buildingFilter);
    const q = meterQuery.trim().toLowerCase();
    if (q)
      list = list.filter((m) =>
        [m.meter_id, m.meter_sn, m.stall_id, m.meter_status, m.meter_type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    const mtrNum = (id: string) => {
      const m = /^MTR-(\d+)/i.exec(id || "");
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    return [...list].sort((a, b) => mtrNum(a.meter_id) - mtrNum(b.meter_id) || a.meter_id.localeCompare(b.meter_id));
  }, [meters, typeFilter, buildingFilter, meterQuery, stallToBuilding]);

  /* ---------- CRUD ---------- */
  const onCreate = async () => {
    if (!canWrite) {
      notify("Not allowed", "Only admin/operator can create readings.");
      return;
    }
    if (!formMeterId || !formValue) {
      notify("Missing info", "Please select a meter and enter a reading.");
      return;
    }
    const valueNum = parseFloat(formValue);
    if (Number.isNaN(valueNum)) {
      notify("Invalid value", "Reading must be a number.");
      return;
    }
    if (!formImage.trim()) {
      notify(
        "Image required",
        "Your backend now requires an image (base64/base64url/data URL/hex). Paste it in the Image field."
      );
      return;
    }
    const payload = {
      meter_id: formMeterId,
      reading_value: valueNum,
      lastread_date: formDate || todayStr(),
      remarks: formRemarks.trim() || null,
      image: formImage.trim(),
    };

    if (!online) {
      await queueScan(payload);
      setFormValue("");
      setFormDate(todayStr());
      setFormRemarks("");
      setFormImage("");
      setCreateVisible(false);
      notify("Saved offline", "The reading (with image) was added to Offline History. Approve it when you have internet.");
      return;
    }

    try {
      setSubmitting(true);
      await api.post(readingBase, payload);
      setFormValue("");
      setFormDate(todayStr());
      setFormRemarks("");
      setFormImage("");
      setCreateVisible(false);
      await loadAll();
      notify("Success", "Meter reading recorded.");
    } catch (err: any) {
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (row: Reading) => {
    setEditRow(row);
    setEditMeterId(row.meter_id);
    setEditValue(String(row.reading_value));
    setEditDate(row.lastread_date);
    setEditRemarks(row.remarks ?? "");
    setEditImage("");
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (!canWrite || !editRow) return;
    try {
      setSubmitting(true);
      const body: any = {
        meter_id: editMeterId,
        reading_value: editValue === "" ? undefined : parseFloat(editValue),
        lastread_date: editDate,
        remarks: editRemarks.trim() === "" ? null : editRemarks.trim(),
      };
      if (editImage.trim()) body.image = editImage.trim();
      await api.put(`${readingBase}/${encodeURIComponent(editRow.reading_id)}`, body);
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Reading updated successfully.");
    } catch (err: any) {
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (row?: Reading) => {
    if (!canWrite) {
      notify("Not allowed", "Only admin/operator can delete readings.");
      return;
    }
    const target = row ?? editRow;
    if (!target) return;
    const ok = await confirm("Delete reading?", `Are you sure you want to delete ${target.reading_id}? This cannot be undone.`);
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(`${readingBase}/${encodeURIComponent(target.reading_id)}`);
      setEditVisible(false);
      await loadAll();
      notify("Deleted", `${target.reading_id} removed.`);
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // scanning
  const onScan = (data: OnSuccessfulScanProps | string) => {
    const raw = String((data as any)?.code ?? (data as any)?.rawData ?? (data as any)?.data ?? data ?? "").trim();
    if (!raw) return;
    const meterIdPattern = /^MTR-[A-Za-z0-9-]+$/i;
    if (!meterIdPattern.test(raw)) return;
    const meterId = raw;
    setScanVisible(false);
    if (!metersById.get(meterId)) {
      notify("Unknown meter", `No meter found for id: ${meterId}`);
      return;
    }
    setFormMeterId(meterId);
    setFormValue("");
    setFormDate(todayStr());
    setTimeout(() => readingInputRef.current?.focus?.(), 150);
  };
  const openScanner = () => {
    setScannerKey((k) => k + 1);
    setScanVisible(true);
    Keyboard.dismiss();
  };

  /* ---------- UI ---------- */
  return (
    <View style={styles.screen}>
      {/* connectivity banner */}
      <View style={[styles.infoBar, online ? styles.infoOnline : styles.infoOffline]}>
        <Text style={styles.infoText}>{online ? "Online" : "Offline"}</Text>
        <TouchableOpacity style={styles.historyBtn} onPress={() => setHistoryVisible(true)}>
          <Text style={styles.historyBtnText}>Offline History ({scans.length})</Text>
        </TouchableOpacity>
      </View>

      {/* meters card */}
      <View style={styles.card}>
        {/* header */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Meter Readings</Text>
          {canWrite && (
            <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}>
              <Text style={styles.btnText}>+ Create Reading</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* toolbar: search + Filters */}
        <View style={styles.filtersBar}>
          <View style={[styles.searchWrap, { flex: 1 }]}>
            <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
            <TextInput
              value={meterQuery}
              onChangeText={setMeterQuery}
              placeholder="Search meters by ID, SN, stall, status…"
              placeholderTextColor="#9aa5b1"
              style={styles.search}
            />
          </View>
          <TouchableOpacity style={styles.btnGhost} onPress={() => setFiltersVisible(true)}>
            <Ionicons name="options-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
            <Text style={styles.btnGhostText}>Filters</Text>
          </TouchableOpacity>
        </View>

        {/* Building chips */}
        <View style={{ marginTop: 6, marginBottom: 10 }}>
          <View style={styles.buildingHeaderRow}>
            <Text style={styles.dropdownLabel}>Building</Text>
          </View>

          {isMobile ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRowHorizontal}>
              {buildingChipOptions.map((opt) => (
                <Chip
                  key={opt.value || "all"}
                  label={opt.label}
                  active={buildingFilter === opt.value}
                  onPress={() => setBuildingFilter(opt.value)}
                />
              ))}
            </ScrollView>
          ) : (
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
          )}
        </View>

        {/* LIST */}
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={metersVisible}
            keyExtractor={(m) => m.meter_id}
            style={{ flex: 1 }}
            contentContainerStyle={metersVisible.length === 0 ? { paddingVertical: 24 } : { paddingBottom: 12 }}
            ListEmptyComponent={<Text style={styles.empty}>No meters found.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setSelectedMeterId(item.meter_id);
                  setQuery("");
                  setPage(1);
                  setReadingsModalVisible(true);
                }}
                style={styles.row}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.rowTitle}>
                    <Text style={styles.meterLink}>{item.meter_id}</Text> • {item.meter_type.toUpperCase()}
                  </Text>
                  <Text style={styles.rowMeta}>
                    SN: {item.meter_sn} · Mult: {item.meter_mult} · Stall: {item.stall_id}
                  </Text>
                  <Text style={styles.rowMetaSmall}>Status: {item.meter_status.toUpperCase()}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      {/* FILTERS modal */}
      <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.modalTitle}>Filters & Sort</Text>
            <View style={styles.modalDivider} />

            <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>Type</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "All", val: "" },
                { label: "Electric", val: "electric" },
                { label: "Water", val: "water" },
                { label: "LPG", val: "lpg" },
              ].map(({ label, val }) => (
                <Chip key={label} label={label} active={typeFilter === (val as any)} onPress={() => setTypeFilter(val as any)} />
              ))}
            </View>

            <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Sort by</Text>
            <View style={styles.chipsRow}>
              {[
                { label: "Newest", val: "date_desc" },
                { label: "Oldest", val: "date_asc" },
                { label: "ID ↑", val: "id_asc" },
                { label: "ID ↓", val: "id_desc" },
              ].map(({ label, val }) => (
                <Chip key={val} label={label} active={sortBy === (val as any)} onPress={() => setSortBy(val as any)} />
              ))}
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => {
                  setMeterQuery("");
                  setBuildingFilter(isAdmin ? "" : userBuildingId || "");
                  setTypeFilter("");
                  setSortBy("date_desc");
                  setFiltersVisible(false);
                }}
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

      {/* MOBILE building picker */}
      <Modal visible={buildingPickerVisible} transparent animationType="fade" onRequestClose={() => setBuildingPickerVisible(false)}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
            <View
              style={[
                styles.modalCard,
                Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.9) },
              ]}
            >
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Select Building</Text>
                <TouchableOpacity onPress={() => setBuildingPickerVisible(false)}>
                  <Ionicons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>
              <View style={styles.modalDivider} />
              <View style={styles.select}>
                <Picker
                  selectedValue={buildingFilter}
                  onValueChange={(v) => setBuildingFilter(String(v))}
                  mode={Platform.OS === "android" ? "dropdown" : undefined}
                >
                  {buildingChipOptions.map((opt) => (
                    <Picker.Item key={opt.value || "all"} label={opt.label} value={opt.value} />
                  ))}
                </Picker>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.smallBtn, styles.ghostBtn]} onPress={() => setBuildingPickerVisible(false)}>
                  <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* CREATE modal */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View
            style={[
              styles.modalCard,
              Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.85) },
            ]}
          >
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Create Reading</Text>
              <View style={styles.rowWrap}>
                <Dropdown
                  label="Meter"
                  value={formMeterId}
                  onChange={setFormMeterId}
                  options={meters.map((m) => ({
                    label: `${m.meter_id} • ${m.meter_type} • ${m.meter_sn}`,
                    value: m.meter_id,
                  }))}
                />
                <TouchableOpacity style={styles.scanBtn} onPress={openScanner}>
                  <Text style={styles.scanBtnText}>Scan QR to select</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Reading Value</Text>
                  <TextInput
                    ref={readingInputRef}
                    style={styles.input}
                    keyboardType="numeric"
                    value={formValue}
                    onChangeText={setFormValue}
                    placeholder="Reading value"
                  />
                </View>
                <DatePickerField label="Date read" value={formDate} onChange={setFormDate} />
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Remarks (optional)</Text>
                <TextInput
                  style={[styles.input, { minHeight: 44 }]}
                  value={formRemarks}
                  onChangeText={setFormRemarks}
                  placeholder="Notes for this reading"
                />
              </View>

              <View style={{ marginTop: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.dropdownLabel}>Image (required)</Text>
                  <TouchableOpacity onPress={() => setImgToolVisible(true)}>
                    <Text style={{ color: "#1d4ed8", fontWeight: "800" }}>Open Image ⇄ Base64</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 44 }]}
                  value={formImage}
                  onChangeText={setFormImage}
                  placeholder="Paste base64 / data URL / hex"
                />
                {/* Base64 → Image preview */}
                {formImage.trim() ? (
                  <View style={{ marginTop: 8, alignItems: "flex-start" }}>
                    <Image
                      source={{ uri: toDataUrl(formImage) }}
                      style={{ width: 200, height: 200, borderRadius: 8, backgroundColor: "#f1f5f9" }}
                      resizeMode="contain"
                    />
                    {Platform.OS === "web" && (
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.ghostBtn, { marginTop: 8 }]}
                        onPress={() => {
                          const a = document.createElement("a");
                          a.href = toDataUrl(formImage);
                          a.download = "reading-image";
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}
                      >
                        <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Download image</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                <Text style={styles.helpTxtSmall}>
                  Tip: You can paste raw base64 (…AA==) or a full data URL. A preview will show automatically.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setCreateVisible(false)}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{online ? "Save Reading" : "Save Offline"}</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* READINGS modal (paginated) */}
      <ReadingsModal
        visible={readingsModalVisible}
        onClose={() => {
          setReadingsModalVisible(false);
          setSelectedMeterId("");
          setQuery("");
          setPage(1);
        }}
        selectedMeterId={selectedMeterId}
        query={query}
        setQuery={setQuery}
        sortBy={sortBy}
        setSortBy={setSortBy}
        readingsForSelected={(() => {
          if (!selectedMeterId) return [];
          const typed = readings.filter((r) => r.meter_id === selectedMeterId);
          const searched = query.trim()
            ? typed.filter(
                (r) =>
                  r.reading_id.toLowerCase().includes(query.toLowerCase()) ||
                  r.lastread_date.toLowerCase().includes(query.toLowerCase()) ||
                  String(r.reading_value).toLowerCase().includes(query.toLowerCase())
              )
            : typed;
          const arr = [...searched];
          switch (sortBy) {
            case "date_asc":
              arr.sort((a, b) => a.lastread_date.localeCompare(b.lastread_date) || readNum(a.reading_id) - readNum(b.reading_id));
              break;
            case "id_asc":
              arr.sort((a, b) => readNum(a.reading_id) - readNum(b.reading_id));
              break;
            case "id_desc":
              arr.sort((a, b) => readNum(b.reading_id) - readNum(a.reading_id));
              break;
            case "date_desc":
            default:
              arr.sort((a, b) => b.lastread_date.localeCompare(a.lastread_date) || readNum(b.reading_id) - readNum(a.reading_id));
          }
          return arr;
        })()}
        page={page}
        setPage={setPage}
        metersById={metersById}
        submitting={submitting}
        onDelete={onDelete}
        openEdit={openEdit}
        busy={busy}
        readingBase={readingBase} // pass detected base to modal
      />

      {/* EDIT modal */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View
            style={[
              styles.modalCard,
              Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.85) },
            ]}
          >
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Update {editRow?.reading_id}</Text>
              <Dropdown
                label="Meter"
                value={editMeterId}
                onChange={setEditMeterId}
                options={meters.map((m) => ({
                  label: `${m.meter_id} • ${m.meter_type} • ${m.meter_sn}`,
                  value: m.meter_id,
                }))}
              />
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Reading Value</Text>
                  <TextInput style={styles.input} value={editValue} onChangeText={setEditValue} keyboardType="numeric" placeholder="Reading value" />
                </View>
                <DatePickerField label="Date read" value={editDate} onChange={setEditDate} />
              </View>

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Remarks (optional)</Text>
                <TextInput style={[styles.input, { minHeight: 44 }]} value={editRemarks} onChangeText={setEditRemarks} placeholder="Notes for this reading" />
              </View>

              <View style={{ marginTop: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={styles.dropdownLabel}>New Image (optional)</Text>
                  <TouchableOpacity onPress={() => setImgToolVisible(true)}>
                    <Text style={{ color: "#1d4ed8", fontWeight: "800" }}>Open Image ⇄ Base64</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 44 }]}
                  value={editImage}
                  onChangeText={setEditImage}
                  placeholder="Paste base64 / data URL / hex to replace"
                />
                {/* Base64 → Image preview (edit) */}
                {editImage.trim() ? (
                  <View style={{ marginTop: 8, alignItems: "flex-start" }}>
                    <Image
                      source={{ uri: toDataUrl(editImage) }}
                      style={{ width: 200, height: 200, borderRadius: 8, backgroundColor: "#f1f5f9" }}
                      resizeMode="contain"
                    />
                    {Platform.OS === "web" && (
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.ghostBtn, { marginTop: 8 }]}
                        onPress={() => {
                          const a = document.createElement("a");
                          a.href = toDataUrl(editImage);
                          a.download = "reading-image";
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}
                      >
                        <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Download image</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
                <Text style={styles.helpTxtSmall}>Leave blank to keep the current image.</Text>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}>
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save changes</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* QR SCANNER */}
      <Modal
        visible={scanVisible}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setScanVisible(false)}
      >
        <View style={styles.scannerScreen}>
          <View style={styles.scannerFill}>
            <QRCodeScanner
              key={scannerKey}
              core={{ onSuccessfulScan: onScan }}
              scanning={{ cooldownDuration: 1200 }}
              uiControls={{ showControls: true, showTorchButton: true, showStatus: true }}
            />
          </View>
          <SafeAreaView style={styles.scanTopBar} pointerEvents="box-none">
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close scanner"
              onPress={() => setScanVisible(false)}
              style={styles.closeFab}
              hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}
            >
              <Text style={styles.closeFabText}>×</Text>
            </TouchableOpacity>
          </SafeAreaView>
          {Platform.OS === "web" ? (
            <Text style={[styles.scanInfo, styles.scanTopInfo]}>
              Camera access requires HTTPS in the browser. If the camera does not start, please use
              the dropdown instead.
            </Text>
          ) : null}
          <SafeAreaView style={styles.scanFooter} pointerEvents="box-none">
            <Text style={styles.scanHint}>
              Point your camera at a meter QR code to quick-edit its latest reading or pre-fill the
              form.
            </Text>
            <TouchableOpacity style={[styles.btn, styles.scanCloseBtn]} onPress={() => setScanVisible(false)}>
              <Text style={styles.btnText}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>

      {/* OFFLINE HISTORY */}
      <HistoryModal
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        scans={filteredScans}
        approveAll={() => approveAll(token)}
        markPending={markPending}
        approveOne={(id: string) => approveOne(id, token)}
        removeScan={removeScan}
        online={online}
      />

      {/* IMAGE ⇄ BASE64 TOOL */}
      <ImageBase64Tool
        visible={imgToolVisible}
        onClose={() => setImgToolVisible(false)}
        onUseBase64={(b64) => {
          if (editVisible) setEditImage(b64);
          else setFormImage(b64);
          setImgToolVisible(false);
        }}
      />
    </View>
  );
}

/* ---------- small components ---------- */
function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}>
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text>
    </TouchableOpacity>
  );
}
function PageBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.pageBtn, disabled && styles.pageBtnDisabled]} disabled={disabled} onPress={onPress}>
      <Text style={styles.pageBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}
function Dropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <View style={{ marginTop: 8, flex: 1 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={value} onValueChange={(itemValue) => onChange(String(itemValue))} style={styles.picker}>
          {options.map((opt) => (
            <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
}
function DatePickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [y, m, d] = (value || todayStr()).split("-").map((n: string) => parseInt(n, 10));
  const [year, setYear] = useState(y || new Date().getFullYear());
  const [month, setMonth] = useState((m || new Date().getMonth() + 1) as number);
  const [day, setDay] = useState(d || new Date().getDate());
  useEffect(() => {
    const [py, pm, pd] = (value || todayStr()).split("-").map((n: string) => parseInt(n, 10));
    if (py && pm && pd) {
      setYear(py);
      setMonth(pm);
      setDay(pd);
    }
  }, [value]);
  const commit = () => {
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onChange(`${year}-${mm}-${dd}`);
    setOpen(false);
  };
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <TouchableOpacity style={[styles.input, styles.dateButton]} onPress={() => setOpen(true)}>
        <Text style={styles.dateButtonText}>{value || todayStr()}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.dateModalCard}>
            <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Pick a date</Text>
            <View style={styles.datePickersRow}>
              <View style={styles.datePickerCol}>
                <Text style={styles.dropdownLabel}>Year</Text>
                <View style={styles.pickerWrapper}>
                  <Picker selectedValue={year} onValueChange={(v) => setYear(Number(v))}>
                    {Array.from({ length: 80 }).map((_, i) => {
                      const yr = 1980 + i;
                      return <Picker.Item key={yr} label={String(yr)} value={yr} />;
                    })}
                  </Picker>
                </View>
              </View>
              <View style={styles.datePickerCol}>
                <Text style={styles.dropdownLabel}>Month</Text>
                <View style={styles.pickerWrapper}>
                  <Picker selectedValue={month} onValueChange={(v) => setMonth(Number(v))}>
                    {Array.from({ length: 12 }).map((_, i) => (
                      <Picker.Item key={i + 1} label={String(i + 1)} value={i + 1} />
                    ))}
                  </Picker>
                </View>
              </View>
              <View style={styles.datePickerCol}>
                <Text style={styles.dropdownLabel}>Day</Text>
                <View style={styles.pickerWrapper}>
                  <Picker selectedValue={day} onValueChange={(v) => setDay(Number(v))}>
                    {Array.from({ length: 31 }).map((_, i) => (
                      <Picker.Item key={i + 1} label={String(i + 1)} value={i + 1} />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>
            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setOpen(false)}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={commit}>
                <Text style={styles.btnText}>Use date</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
function ReadingsModal({
  visible,
  onClose,
  selectedMeterId,
  query,
  setQuery,
  sortBy,
  setSortBy,
  readingsForSelected,
  page,
  setPage,
  metersById,
  submitting,
  onDelete,
  openEdit,
  busy,
  readingBase, // NEW: detected base from parent
}: any) {
  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const total = readingsForSelected.length;
  const totalPages = Math.max(1, Math.ceil(total / 30));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * 30;
  const pageData = readingsForSelected.slice(start, start + 30);

  const openImage = (id: string) => {
    const url = `${BASE_API}${readingBase}/${encodeURIComponent(id)}/image`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url).catch(() => notify("Open failed", "Could not open image on this device."));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
        <View
          style={[
            styles.modalCardWide,
            Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.9) },
          ]}
        >
          <FlatList
            data={pageData}
            keyExtractor={(item) => item.reading_id}
            contentContainerStyle={{ paddingBottom: 12 }}
            ListEmptyComponent={<Text style={styles.empty}>No readings for this meter.</Text>}
            renderItem={({ item }) => (
              <View style={[styles.listRow, isMobile && styles.listRowMobile]}>
                <View style={{ flex: 1 }}>
                  {isMobile ? (
                    <>
                      <Text style={styles.rowTitle}>
                        <Text style={styles.meterLink}>{item.reading_id}</Text> • <Text>{item.lastread_date}</Text>
                      </Text>
                      <Text style={styles.rowSub}>Value: {fmtValue(item.reading_value)}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.rowTitle}>{item.reading_id}</Text>
                      <Text style={styles.rowSub}>
                        {item.lastread_date} • Value: {fmtValue(item.reading_value)}
                      </Text>
                    </>
                  )}
                  <Text style={styles.rowSubSmall}>Updated {formatDateTime(item.last_updated)} by {item.updated_by}</Text>
                </View>

                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => openEdit(item)}>
                  <Text style={styles.actionBtnGhostText}>Update</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => openImage(item.reading_id)}>
                  <Text style={styles.actionBtnGhostText}>View Image</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={() => onDelete(item)}>
                  {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Delete</Text>}
                </TouchableOpacity>
              </View>
            )}
            ListHeaderComponent={
              <>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={styles.modalTitle}>
                    Readings for <Text style={styles.meterLink}>{selectedMeterId || "—"}</Text>
                  </Text>
                  <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}>
                    <Text style={styles.btnGhostText}>Close</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.searchWrap, { marginTop: 8 }]}>
                  <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
                  <TextInput
                    style={styles.search}
                    placeholder="Search readings (ID, date, value…)"
                    value={query}
                    onChangeText={(v) => {
                      setQuery(v);
                      setPage(1);
                    }}
                  />
                </View>

                <Text style={[styles.dropdownLabel, { marginTop: 8 }]}>Sort readings</Text>
                <View style={styles.chipsRow}>
                  {[
                    { label: "Newest", val: "date_desc" },
                    { label: "Oldest", val: "date_asc" },
                    { label: "ID ↑", val: "id_asc" },
                    { label: "ID ↓", val: "id_desc" },
                  ].map(({ label, val }) => (
                    <Chip
                      key={val}
                      label={label}
                      active={sortBy === (val as any)}
                      onPress={() => {
                        setSortBy(val as any);
                        setPage(1);
                      }}
                    />
                  ))}
                </View>
              </>
            }
            ListFooterComponent={
              <>
                <View style={styles.pageBar}>
                  <Text style={styles.pageInfo}>
                    Page {safePage} of {totalPages} • {total} item{total === 1 ? "" : "s"}
                  </Text>
                  <View style={styles.pageBtns}>
                    <PageBtn label="First" disabled={safePage === 1} onPress={() => setPage(1)} />
                    <PageBtn label="Prev" disabled={safePage === 1} onPress={() => setPage(safePage - 1)} />
                    <PageBtn label="Next" disabled={safePage >= totalPages} onPress={() => setPage(safePage + 1)} />
                    <PageBtn label="Last" disabled={safePage >= totalPages} onPress={() => setPage(totalPages)} />
                  </View>
                </View>
              </>
            }
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function HistoryModal({ visible, onClose, scans, approveAll, markPending, approveOne, removeScan, online }: any) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
        <View
          style={[
            styles.modalCardWide,
            Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.9) },
          ]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Offline History</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={[styles.actionBtn, scans.length ? null : styles.actionBtnDisabled]}
                disabled={!scans.length}
                onPress={approveAll}
              >
                <Text style={styles.actionBtnText}>Approve All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={onClose}>
                <Text style={styles.actionBtnGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
          <FlatList
            data={scans}
            keyExtractor={(it) => it.id}
            ListEmptyComponent={<Text style={styles.empty}>No items in this tab.</Text>}
            style={{ marginTop: 8 }}
            contentContainerStyle={{ paddingBottom: 12 }}
            renderItem={({ item }) => (
              <View style={styles.historyRow}>
                <View style={styles.rowLeft}>
                  <Text style={styles.rowTitle}>{item.meter_id}</Text>
                  <Text style={styles.rowSub}>
                    Value: {Number(item.reading_value).toFixed(2)} • Date: {item.lastread_date}
                  </Text>
                  <Text style={styles.rowSubSmall}>Saved: {new Date(item.createdAt).toLocaleString()}</Text>
                  {!!item.remarks && <Text style={styles.rowSubSmall}>Remarks: {item.remarks}</Text>}
                  <View style={styles.badgesRow}>
                    {item.status === "pending" && <Text style={[styles.statusBadge, styles.statusPending]}>Pending</Text>}
                    {item.status === "failed" && <Text style={[styles.statusBadge, styles.statusFailed]}>Failed</Text>}
                    {item.status === "approved" && <Text style={[styles.statusBadge, styles.statusApproved]}>Approved</Text>}
                    {!!item.error && (
                      <Text style={[styles.statusBadge, styles.statusWarn]} numberOfLines={1}>
                        Error: {item.error}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={() => markPending(item.id)}>
                    <Text style={styles.smallBtnGhostText}>Mark Pending</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallBtn]} onPress={() => approveOne(item.id)}>
                    <Text style={styles.smallBtnText}>{online ? "Approve" : "Queue"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.smallBtn, styles.smallBtnDanger]} onPress={() => removeScan(item.id)}>
                    <Text style={styles.smallBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------- Image ⇄ Base64 Tool ---------- */
function ImageBase64Tool({
  visible,
  onClose,
  onUseBase64,
}: {
  visible: boolean;
  onClose: () => void;
  onUseBase64: (b64: string) => void;
}) {
  const [input, setInput] = React.useState<string>("");
  const [mime, setMime] = React.useState<string>("image/jpeg");
  const [base64, setBase64] = React.useState<string>("");
  const [dataUrl, setDataUrl] = React.useState<string>("");

  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const openFilePicker = () => {
    if (Platform.OS === "web") fileRef.current?.click?.();
  };
  const onPickFile = (e: any) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      setInput(result);
      const b64 = extractBase64(result);
      setBase64(b64);
      setMime(f.type || "image/jpeg");
      setDataUrl(`data:${f.type || "image/jpeg"};base64,${b64}`);
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  function extractBase64(s: string) {
    const str = (s || "").trim();
    if (str.startsWith("data:")) {
      const comma = str.indexOf(",");
      return comma >= 0 ? str.slice(comma + 1) : "";
    }
    return str.replace(/\s+/g, "");
  }
  function buildDataUrl(b64: string, m: string) {
    const clean = (b64 || "").replace(/\s+/g, "");
    const mm = (m || "image/jpeg").trim() || "image/jpeg";
    return `data:${mm};base64,${clean}`;
  }

  const decodeInput = () => {
    const b64 = extractBase64(input);
    if (!b64) {
      notify("Invalid input", "Please paste a valid base64 or data URL.");
      return;
    }
    setBase64(b64);
    setDataUrl(buildDataUrl(b64, mime));
  };

  const copyBase64ToClipboard = async () => {
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(base64);
        notify("Copied", "Base64 copied to clipboard.");
      } else {
        notify("Tip", "On native, long-press the text to copy.");
      }
    } catch {
      notify("Copy failed", "You can still select the text manually.");
    }
  };

  const downloadImage = () => {
    if (Platform.OS !== "web" || !dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "image";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
        <View style={styles.modalCardWide}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Image ⇄ Base64 Tool</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={onClose}>
                <Text style={styles.actionBtnGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          {Platform.OS === "web" && (
            <>
              <input ref={fileRef as any} type="file" accept="image/*" style={{ display: "none" }} onChange={onPickFile} />
              <TouchableOpacity style={[styles.btn, { alignSelf: "flex-start", marginBottom: 8 }]} onPress={openFilePicker}>
                <Text style={styles.btnText}>Pick image (web)</Text>
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.dropdownLabel}>MIME type (for data URL)</Text>
          <View style={styles.pickerWrapper}>
            <Picker selectedValue={mime} onValueChange={(v) => setMime(String(v))}>
              {["image/jpeg", "image/png", "image/webp"].map((m) => (
                <Picker.Item key={m} label={m} value={m} />
              ))}
            </Picker>
          </View>

          <Text style={[styles.dropdownLabel, { marginTop: 8 }]}>
            Paste Base64 or Data URL (left) → Decode / Preview → Copy/Use (right)
          </Text>
          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
            <TextInput
              multiline
              value={input}
              onChangeText={setInput}
              placeholder="Paste base64 (…AA==) or data URL (data:image/png;base64,…) here"
              style={[styles.input, { minHeight: 120, flex: 1 }]}
            />
            <View style={{ flex: 1, minWidth: 280 }}>
              <TouchableOpacity style={[styles.smallBtn, styles.ghostBtn]} onPress={decodeInput}>
                <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Decode / Preview</Text>
              </TouchableOpacity>

              {dataUrl ? (
                <View style={{ marginTop: 8, alignItems: "center" }}>
                  <Image
                    source={{ uri: dataUrl }}
                    style={{ width: 240, height: 240, resizeMode: "contain", backgroundColor: "#f8fafc", borderRadius: 10 }}
                  />
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                    {Platform.OS === "web" && (
                      <TouchableOpacity style={[styles.smallBtn, styles.ghostBtn]} onPress={downloadImage}>
                        <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Download</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.smallBtn]} onPress={() => onUseBase64(base64)}>
                      <Text style={styles.smallBtnText}>Use in Form</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={styles.helpTxtSmall}>No preview yet.</Text>
              )}
            </View>
          </View>

          <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Raw Base64</Text>
          <View style={{ gap: 8 }}>
            <TextInput
              multiline
              value={base64}
              onChangeText={setBase64}
              placeholder="This will contain just the base64 (no data URL prefix)."
              style={[styles.input, { minHeight: 120 }]}
            />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <TouchableOpacity style={[styles.smallBtn, styles.ghostBtn]} onPress={copyBase64ToClipboard}>
                <Text style={[styles.smallBtnText, styles.ghostBtnText]}>Copy Base64</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn]}
                onPress={() => {
                  const url = buildDataUrl(base64, mime);
                  setDataUrl(url);
                  setInput(url);
                }}
              >
                <Text style={styles.smallBtnText}>Make Data URL</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.smallBtn]} onPress={() => onUseBase64(base64)}>
                <Text style={styles.smallBtnText}>Use in Form</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", alignItems: "center", padding: 16 },
  modalCardWide: { backgroundColor: "#fff", padding: 16, borderRadius: 16, width: "100%", maxWidth: 960, height: "95%" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  pageBar: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  pageInfo: { color: "#334e68", fontWeight: "600" },
  pageBtns: { flexDirection: "row", gap: 6, alignItems: "center" },
  listRow: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  listRowMobile: { flexDirection: "column", alignItems: "flex-start", gap: 8 },
  rowTitle: { fontWeight: "700", color: "#0f172a" },
  rowSub: { fontSize: 14, color: "#64748b" },
  rowSubSmall: { fontSize: 12, color: "#94a3b8" },
  meterLink: { color: "#2563eb", textDecorationLine: "underline" },
  actionBtn: { height: 36, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2563eb" },
  actionBtnGhost: { backgroundColor: "#e0ecff" },
  actionBtnDanger: { backgroundColor: "#ef4444" },
  actionBtnText: { fontWeight: "700", color: "#fff" },
  actionBtnGhostText: { color: "#1d4ed8", fontWeight: "700" },
  actionBtnDisabled: { opacity: 0.5, backgroundColor: "#e2e8f0" },
  pageBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0", backgroundColor: "#fff" },
  pageBtnText: { fontSize: 14, fontWeight: "700", color: "#102a43" },
  pageBtnDisabled: { opacity: 0.5 },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f1f5f9", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: "#e2e8f0" },
  search: { flex: 1, fontSize: 14, color: "#0b1f33" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },
  loader: { paddingVertical: 24, alignItems: "center" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipsRowHorizontal: { paddingRight: 4, gap: 8, alignItems: "center" },
  chip: { borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "#f8fafc", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: "#e0ecff", borderColor: "#93c5fd" },
  chipText: { fontWeight: "700" },
  chipTextActive: { color: "#1d4ed8" },
  chipTextIdle: { color: "#334155" },
  screen: { flex: 1, minHeight: 0, padding: 12, backgroundColor: "#f8fafc" },
  infoBar: { padding: 10, borderRadius: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  infoOnline: { backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#10b98155" },
  infoOffline: { backgroundColor: "#fff7ed", borderWidth: 1, borderColor: "#f59e0b55" },
  infoText: { fontWeight: "800", color: "#111827" },
  historyBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#082cac" },
  historyBtnText: { color: "#fff", fontWeight: "800" },
  card: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    ...(Platform.select({ web: { boxShadow: "0 10px 30px rgba(2,6,23,0.06)" as any }, default: { elevation: 2 } }) as any),
  },
  cardHeader: { marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cardTitle: { fontSize: 18, fontWeight: "900", color: "#0f172a" },
  btn: { backgroundColor: "#2563eb", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    flexDirection: "row",
    alignItems: "center",
  },
  btnGhostText: { color: "#394e6a", fontWeight: "700" },
  filtersBar: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" },
  buildingHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  row: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
  },
  rowMeta: { color: "#334155", marginTop: 6 },
  rowMetaSmall: { color: "#94a3b8", marginTop: 2, fontSize: 12 },
  overlay: { flex: 1, backgroundColor: "rgba(2,6,23,0.45)", justifyContent: "center", alignItems: "center", padding: 16 },
  modalCard: { backgroundColor: "#fff", padding: 16, borderRadius: 16, width: "100%", maxWidth: 480, ...(Platform.select({ web: { boxShadow: "0 14px 36px rgba(2,6,23,0.25)" as any }, default: { elevation: 4 } }) as any) },
  modalHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalDivider: { height: 1, backgroundColor: "#edf2f7", marginVertical: 8 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  smallBtn: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  smallBtnText: { fontSize: 13, fontWeight: "800" },
  ghostBtn: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  ghostBtnText: { color: "#1f2937" },
  dropdownLabel: { fontWeight: "800", color: "#0f172a", marginBottom: 8, textTransform: "none" },
  pickerWrapper: { borderWidth: 1, borderColor: "#d9e2ec", borderRadius: 10, overflow: "hidden", backgroundColor: "#fff" },
  picker: { height: 50 },
  dateButton: { minWidth: 160, justifyContent: "center" },
  dateButtonText: { color: "#102a43" },
  dateModalCard: { backgroundColor: "#fff", padding: 16, borderRadius: 16, width: "100%", maxWidth: 520 },
  datePickersRow: { flexDirection: "row", gap: 12 },
  datePickerCol: { flex: 1 },
  input: { borderWidth: 1, borderColor: "#d9e2ec", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", color: "#102a43", marginTop: 6, minWidth: 160 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  headerActions: { flexDirection: "row", gap: 8 },
  centerText: { textAlign: "center", width: "100%", color: "#082cac", fontWeight: "900", fontSize: 15, marginLeft: 75 },
  historyRow: { borderWidth: 1, borderColor: "#edf2f7", borderRadius: 12, backgroundColor: "#fff", ...(Platform.select({ web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any }, default: { elevation: 1 } }) as any), padding: 12, marginTop: 10, flexDirection: "row", alignItems: "stretch", gap: 12 },
  rowLeft: { flex: 1, gap: 4 },
  rowRight: { justifyContent: "center", alignItems: "flex-end", gap: 6, minWidth: 110 },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  statusBadge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, fontSize: 12, overflow: "hidden" },
  statusPending: { backgroundColor: "#fff7ed", color: "#9a3412", borderWidth: 1, borderColor: "#f59e0b55" },
  statusFailed: { backgroundColor: "#fef2f2", color: "#7f1d1d", borderWidth: 1, borderColor: "#ef444455" },
  statusApproved: { backgroundColor: "#ecfdf5", color: "#065f46", borderWidth: 1, borderColor: "#10b98155" },
  statusWarn: { backgroundColor: "#fefce8", color: "#713f12", borderWidth: 1, borderColor: "#facc1555" },
  badge: { backgroundColor: "#bfbfbfff", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  scannerScreen: { flex: 1, backgroundColor: "#000" },
  scannerFill: { flex: 1, justifyContent: "center", alignItems: "center" },
  scanTopBar: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "flex-end", padding: 16 },
  closeFab: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.8)", alignItems: "center", justifyContent: "center" },
  closeFabText: { fontSize: 24, fontWeight: "800", color: "#111" },
  scanInfo: { color: "#fff", textAlign: "center", padding: 8 },
  scanTopInfo: { backgroundColor: "rgba(0,0,0,0.6)" },
  scanFooter: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center" },
  scanHint: { color: "#fff", marginBottom: 8, textAlign: "center" },
  scanCloseBtn: { backgroundColor: "#dc2626" },
  select: {
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  rowWrap: { flexDirection: "row", alignItems: "flex-end", gap: 10, flexWrap: "wrap" },
  scanBtn: {
    height: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#e0ecff",
    borderWidth: 1,
    borderColor: "#93c5fd",
    justifyContent: "center",
    alignItems: "center",
  },
  scanBtnText: { fontWeight: "800", color: "#1d4ed8" },
  smallBtnGhost: {
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnDanger: {
    backgroundColor: "#ef4444",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  smallBtnGhostText: { color: "#1f2937", fontWeight: "800", fontSize: 13 },
  helpTxtSmall: { color: "#6b7280", fontSize: 12, marginTop: 4 },
  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  promptCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "100%",
    maxWidth: 480,
    ...(Platform.select({
      web: { boxShadow: "0 14px 36px rgba(2,6,23,0.25)" } as any,
      default: { elevation: 4 },
    }) as any),
  },
  chipIdle: {},
});