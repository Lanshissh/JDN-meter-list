import {
  OnSuccessfulScanProps,
  QRCodeScanner,
} from "@masumdev/rn-qrcode-scanner";
import NetInfo from "@react-native-community/netinfo";
import { Picker } from "@react-native-picker/picker";
import axios from "axios";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  LogBox,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BASE_API } from "../../constants/api";
import { useScanHistory } from "../../contexts/ScanHistoryContext";

LogBox.ignoreLogs(["VirtualizedLists should never be nested"]);

// --- helpers (alerts + error text) ---
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
const todayStr = () => new Date().toISOString().slice(0, 10);

// tiny jwt payload decoder
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
        .join(""),
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// --- types ---
export type Reading = {
  reading_id: string;
  meter_id: string;
  reading_value: number;
  read_by: string;
  lastread_date: string; // YYYY-MM-DD
  last_updated: string; // ISO
  updated_by: string;
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

// number formatting
function fmtValue(n: number | string | null | undefined, unit?: string) {
  if (n == null) return "—";
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (!isFinite(v)) return String(n);
  const formatted = Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
  return unit ? `${formatted} ${unit}` : formatted;
}

export default function MeterReadingPanel({ token }: { token: string | null }) {
  // auth + api
  const jwt = useMemo(() => decodeJwtPayload(token), [token]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");
  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token],
  );
  const api = useMemo(
    () =>
      axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }),
    [authHeader],
  );

  // connectivity (used also for UI banner)
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const sub = NetInfo.addEventListener((s) =>
      setIsConnected(!!s.isConnected),
    );
    NetInfo.fetch().then((s) => setIsConnected(!!s.isConnected));
    return () => sub && sub();
  }, []);

  // offline scan history context
  const {
    scans,
    queueScan,
    removeScan,
    approveOne,
    approveAll,
    markPending,
    isConnected: ctxConnected,
  } = useScanHistory();
  const online = isConnected ?? ctxConnected ?? false;

  // filters + data
  const [typeFilter, setTypeFilter] = useState<
    "" | "electric" | "water" | "lpg"
  >("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<
    "date_desc" | "date_asc" | "id_desc" | "id_asc"
  >("date_desc");

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // searches
  const [meterQuery, setMeterQuery] = useState("");
  const [query, setQuery] = useState("");

  // selected meter / modals
  const [selectedMeterId, setSelectedMeterId] = useState("");
  const [readingsModalVisible, setReadingsModalVisible] = useState(false);

  // pagination in readings modal
  const PAGE_SIZE = 30;
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [selectedMeterId]);

  // create modal
  const [createVisible, setCreateVisible] = useState(false);
  const [formMeterId, setFormMeterId] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState<string>(todayStr());

  // edit modal
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Reading | null>(null);
  const [editMeterId, setEditMeterId] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editDate, setEditDate] = useState("");

  // scanner
  const [scanVisible, setScanVisible] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);
  const readingInputRef = useRef<TextInput>(null);

  // offline history modal
  const [historyVisible, setHistoryVisible] = useState(false);

  const [historyTab, setHistoryTab] = useState<
    "all" | "pending" | "failed" | "approved"
  >("all");
  const filteredScans = useMemo(() => {
    if (historyTab === "all") return scans;
    return scans.filter((s) => s.status === historyTab);
  }, [scans, historyTab]);

  // numeric ID comparer
  const readNum = (id: string) => {
    const m = /^MR-(\d+)/i.exec(id || "");
    return m ? parseInt(m[1], 10) : 0;
  };

  // load data
  useEffect(() => {
    loadAll();
  }, [token]);
  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in to manage meter readings.");
      return;
    }
    try {
      setBusy(true);
      const [rRes, mRes, sRes] = await Promise.all([
        api.get<Reading[]>("/readings"),
        api.get<Meter[]>("/meters"),
        api.get<Stall[]>("/stalls"),
      ]);
      setReadings(rRes.data || []);
      setMeters(mRes.data || []);
      setStalls(sRes.data || []);
      if (!formMeterId && mRes.data?.length)
        setFormMeterId(mRes.data[0].meter_id);
      if (isAdmin) {
        try {
          const bRes = await api.get<Building[]>("/buildings");
          setBuildings(bRes.data || []);
        } catch {
          setBuildings([]);
        }
      }
    } catch (err: any) {
      console.error("[READINGS LOAD]", err?.response?.data || err?.message);
      notify(
        "Load failed",
        errorText(err, "Please check your connection and permissions."),
      );
    } finally {
      setBusy(false);
    }
  };

  // keep create form meter in sync when picking a meter
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
    const base = [{ label: "All Buildings", value: "" }];
    if (userBuildingId)
      return base.concat([{ label: userBuildingId, value: userBuildingId }]);
    const ids = Array.from(
      new Set(stalls.map((s) => s.building_id).filter(Boolean) as string[]),
    ).sort();
    return base.concat(ids.map((id) => ({ label: id, value: id })));
  }, [isAdmin, buildings, stalls, userBuildingId]);

  const metersVisible = useMemo(() => {
    let list = meters;
    if (typeFilter)
      list = list.filter(
        (m) => (m.meter_type || "").toLowerCase() === typeFilter,
      );
    if (buildingFilter)
      list = list.filter(
        (m) => stallToBuilding.get(m.stall_id || "") === buildingFilter,
      );
    const q = meterQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        [m.meter_id, m.meter_sn, m.stall_id, m.meter_status, m.meter_type]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    const mtrNum = (id: string) => {
      const m = /^MTR-(\d+)/i.exec(id || "");
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    return [...list].sort(
      (a, b) =>
        mtrNum(a.meter_id) - mtrNum(b.meter_id) ||
        a.meter_id.localeCompare(b.meter_id),
    );
  }, [meters, typeFilter, buildingFilter, meterQuery, stallToBuilding]);

  const readingsForSelected = useMemo(() => {
    if (!selectedMeterId) return [];
    const typed = readings.filter((r) => r.meter_id === selectedMeterId);
    const searched = query.trim()
      ? typed.filter(
          (r) =>
            r.reading_id.toLowerCase().includes(query.toLowerCase()) ||
            r.lastread_date.toLowerCase().includes(query.toLowerCase()) ||
            String(r.reading_value).toLowerCase().includes(query.toLowerCase()),
        )
      : typed;
    const arr = [...searched];
    switch (sortBy) {
      case "date_asc":
        arr.sort(
          (a, b) =>
            a.lastread_date.localeCompare(b.lastread_date) ||
            readNum(a.reading_id) - readNum(b.reading_id),
        );
        break;
      case "id_asc":
        arr.sort((a, b) => readNum(a.reading_id) - readNum(b.reading_id));
        break;
      case "id_desc":
        arr.sort((a, b) => readNum(b.reading_id) - readNum(a.reading_id));
        break;
      case "date_desc":
      default:
        arr.sort(
          (a, b) =>
            b.lastread_date.localeCompare(a.lastread_date) ||
            readNum(b.reading_id) - readNum(a.reading_id),
        );
    }
    return arr;
  }, [readings, selectedMeterId, query, sortBy]);

  const onCreate = async () => {
    if (!formMeterId || !formValue) {
      notify("Missing info", "Please select a meter and enter a reading.");
      return;
    }
    const valueNum = parseFloat(formValue);
    if (Number.isNaN(valueNum)) {
      notify("Invalid value", "Reading must be a number.");
      return;
    }

    // If offline, queue it locally for later approval
    if (!online) {
      await queueScan({
        meter_id: formMeterId,
        reading_value: valueNum,
        lastread_date: formDate || todayStr(),
      });
      setFormValue("");
      setFormDate(todayStr());
      setCreateVisible(false);
      notify(
        "Saved offline",
        "The reading was added to Offline History. Approve it when you have internet.",
      );
      return;
    }

    // If online, POST as usual
    try {
      setSubmitting(true);
      await api.post("/readings", {
        meter_id: formMeterId,
        reading_value: valueNum,
        lastread_date: formDate || todayStr(),
      });
      setFormValue("");
      setFormDate(todayStr());
      setCreateVisible(false);
      await loadAll();
      notify("Success", "Meter reading recorded.");
    } catch (err: any) {
      console.error("[CREATE READING]", err?.response?.data || err?.message);
      notify("Create failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // DELETE
  const onDelete = async (row?: Reading) => {
    const target = row ?? editRow;
    if (!target) return;
    const ok = await new Promise<boolean>((res) =>
      Alert.alert(
        "Delete reading?",
        `Are you sure you want to delete ${target.reading_id}? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => res(false) },
          { text: "Delete", style: "destructive", onPress: () => res(true) },
        ],
      ),
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/readings/${encodeURIComponent(target.reading_id)}`);
      setEditVisible(false);
      await loadAll();
      notify("Deleted", `${target.reading_id} removed.`);
    } catch (err: any) {
      console.error("[DELETE READING]", err?.response?.data || err?.message);
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // UPDATE
  const openEdit = (row: Reading) => {
    setEditRow(row);
    setEditMeterId(row.meter_id);
    setEditValue(String(row.reading_value));
    setEditDate(row.lastread_date);
    setEditVisible(true);
  };
  const onUpdate = async () => {
    if (!editRow) return;
    try {
      setSubmitting(true);
      await api.put(`/readings/${encodeURIComponent(editRow.reading_id)}`, {
        meter_id: editMeterId,
        reading_value: editValue === "" ? undefined : parseFloat(editValue),
        lastread_date: editDate,
      });
      setEditVisible(false);
      await loadAll();
      notify("Updated", "Reading updated successfully.");
    } catch (err: any) {
      console.error("[UPDATE READING]", err?.response?.data || err?.message);
      notify("Update failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  // QR scanning
  const onScan = (data: OnSuccessfulScanProps | string) => {
    const raw = String(
      (data as any)?.code ??
        (data as any)?.rawData ??
        (data as any)?.data ??
        data ??
        "",
    ).trim();
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

  // --- render ---
  return (
    <View style={styles.grid}>
      {/* connectivity banner + offline history button */}
      <View
        style={[
          styles.infoBar,
          online ? styles.infoOnline : styles.infoOffline,
        ]}
      >
        <Text style={styles.infoText}>{online ? "Online" : "Offline"}</Text>
        <TouchableOpacity
          style={styles.historyBtn}
          onPress={() => setHistoryVisible(true)}
        >
          <Text style={styles.historyBtnText}>
            Offline History ({scans.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* meters card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Meters</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => setCreateVisible(true)}
          >
            <Text style={styles.btnText}>+ Create Reading</Text>
          </TouchableOpacity>
        </View>

        {/* filters */}
        <View style={styles.filtersBar}>
          <View style={styles.filterCol}>
            <Text style={styles.dropdownLabel}>Filter by Building</Text>
            <View style={styles.chipsRow}>
              {buildingChipOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value || "all"}
                  style={[
                    styles.chip,
                    buildingFilter === opt.value && styles.chipActive,
                  ]}
                  onPress={() => setBuildingFilter(opt.value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      buildingFilter === opt.value && styles.chipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={[styles.filterCol, styles.stackCol]}>
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.dropdownLabel}>Filter by Type</Text>
              <View style={styles.chipsRow}>
                {[
                  { label: "ALL", val: "" },
                  { label: "ELECTRIC", val: "electric" },
                  { label: "WATER", val: "water" },
                  { label: "GAS", val: "lpg" },
                ].map(({ label, val }) => (
                  <TouchableOpacity
                    key={label}
                    style={[
                      styles.chip,
                      typeFilter === (val as any) && styles.chipActive,
                    ]}
                    onPress={() => setTypeFilter(val as any)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        typeFilter === (val as any) && styles.chipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View>
              <Text style={styles.dropdownLabel}>Sort readings</Text>
              <View style={styles.chipsRow}>
                {[
                  { label: "Newest", val: "date_desc" },
                  { label: "Oldest", val: "date_asc" },
                  { label: "ID ↑", val: "id_asc" },
                  { label: "ID ↓", val: "id_desc" },
                ].map(({ label, val }) => (
                  <TouchableOpacity
                    key={val}
                    style={[
                      styles.chip,
                      sortBy === (val as any) && styles.chipActive,
                    ]}
                    onPress={() => setSortBy(val as any)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        sortBy === (val as any) && styles.chipTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {(typeFilter !== "" || buildingFilter !== "") && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                setTypeFilter("");
                setBuildingFilter("");
              }}
            >
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* search meters */}
        <TextInput
          style={styles.search}
          placeholder="Search meters by ID, SN, stall, status…"
          value={meterQuery}
          onChangeText={setMeterQuery}
        />

        {/* list */}
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={metersVisible}
            keyExtractor={(m) => m.meter_id}
            style={{ maxHeight: 360, marginTop: 4 }}
            nestedScrollEnabled
            ListEmptyComponent={
              <Text style={styles.empty}>No meters found.</Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  setSelectedMeterId(item.meter_id);
                  setQuery("");
                  setPage(1);
                  setReadingsModalVisible(true);
                }}
                style={styles.listRow}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    <Text style={styles.meterLink}>{item.meter_id}</Text> •{" "}
                    {item.meter_type.toUpperCase()}
                  </Text>
                  <Text style={styles.rowSub}>
                    SN: {item.meter_sn} • Stall: {item.stall_id} •{" "}
                    {item.meter_status}
                  </Text>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>View</Text>
                </View>
              </TouchableOpacity>
            )}
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
          <View
            style={[
              styles.modalCard,
              Platform.OS !== "web" && {
                maxHeight: Math.round(Dimensions.get("window").height * 0.85),
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
            >
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
                <DatePickerField
                  label="Date read"
                  value={formDate}
                  onChange={setFormDate}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={() => setCreateVisible(false)}
                >
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, submitting && styles.btnDisabled]}
                  onPress={onCreate}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>
                      {online ? "Save Reading" : "Save Offline"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* READINGS modal (wide + paginated) */}
      <Modal
        visible={readingsModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setReadingsModalVisible(false);
          setSelectedMeterId("");
          setQuery("");
          setPage(1);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View
            style={[
              styles.modalCardWide,
              Platform.OS !== "web" && {
                maxHeight: Math.round(Dimensions.get("window").height * 0.9),
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text style={styles.modalTitle}>
                  Readings for{" "}
                  <Text style={styles.meterLink}>{selectedMeterId || "—"}</Text>
                </Text>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={() => {
                    setReadingsModalVisible(false);
                    setSelectedMeterId("");
                    setQuery("");
                    setPage(1);
                  }}
                >
                  <Text style={styles.btnGhostText}>Close</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={[styles.search, { marginTop: 8 }]}
                placeholder="Search readings (ID, date, value…)"
                value={query}
                onChangeText={(v) => {
                  setQuery(v);
                  setPage(1);
                }}
              />

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>Sort readings</Text>
                <View style={styles.chipsRow}>
                  {[
                    { label: "Newest", val: "date_desc" },
                    { label: "Oldest", val: "date_asc" },
                    { label: "ID ↑", val: "id_asc" },
                    { label: "ID ↓", val: "id_desc" },
                  ].map(({ label, val }) => (
                    <TouchableOpacity
                      key={val}
                      style={[
                        styles.chip,
                        sortBy === (val as any) && styles.chipActive,
                      ]}
                      onPress={() => {
                        setSortBy(val as any);
                        setPage(1);
                      }}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          sortBy === (val as any) && styles.chipTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {(() => {
                const total = readingsForSelected.length;
                const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
                const safePage = Math.min(page, totalPages);
                const start = (safePage - 1) * PAGE_SIZE;
                const pageData = readingsForSelected.slice(
                  start,
                  start + PAGE_SIZE,
                );

                return (
                  <>
                    <View style={styles.pageBar}>
                      <Text style={styles.pageInfo}>
                        Page {safePage} of {totalPages} • {total} item
                        {total === 1 ? "" : "s"}
                      </Text>
                      <View style={styles.pageBtns}>
                        <PageBtn
                          label="First"
                          disabled={safePage === 1}
                          onPress={() => setPage(1)}
                        />
                        <PageBtn
                          label="Prev"
                          disabled={safePage === 1}
                          onPress={() => setPage(safePage - 1)}
                        />
                        <PageBtn
                          label="Next"
                          disabled={safePage >= totalPages}
                          onPress={() => setPage(safePage + 1)}
                        />
                        <PageBtn
                          label="Last"
                          disabled={safePage >= totalPages}
                          onPress={() => setPage(totalPages)}
                        />
                      </View>
                    </View>

                    {busy ? (
                      <View style={styles.loader}>
                        <ActivityIndicator />
                      </View>
                    ) : (
                      <FlatList
                        data={pageData}
                        keyExtractor={(item) => item.reading_id}
                        ListEmptyComponent={
                          <Text style={styles.empty}>
                            No readings for this meter.
                          </Text>
                        }
                        renderItem={({ item }) => (
                          <View style={styles.listRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.rowTitle}>
                                {item.reading_id} •{" "}
                                <Text style={styles.meterLink}>
                                  {item.meter_id}
                                </Text>
                              </Text>
                              {(() => {
                                const mType = metersById.get(
                                  item.meter_id,
                                )?.meter_type;
                                const unit =
                                  mType === "electric"
                                    ? ""
                                    : mType === "water"
                                      ? ""
                                      : mType === "lpg"
                                        ? ""
                                        : undefined;
                                return (
                                  <Text
                                    style={[styles.rowSub, styles.centerText]}
                                  >
                                    {item.lastread_date} • Value:{" "}
                                    {fmtValue(item.reading_value, unit)}
                                  </Text>
                                );
                              })()}
                              <Text style={styles.rowSub}>
                                Updated {formatDateTime(item.last_updated)} by{" "}
                                {item.updated_by}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={styles.link}
                              onPress={() => openEdit(item)}
                            >
                              <Text style={styles.linkText}>Update</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.link, { marginLeft: 8 }]}
                              onPress={() => onDelete(item)}
                              disabled={submitting}
                            >
                              {submitting ? (
                                <ActivityIndicator color="#fff" />
                              ) : (
                                <Text
                                  style={[
                                    styles.linkText,
                                    { color: "#e53935" },
                                  ]}
                                >
                                  Delete
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        )}
                        style={{ maxHeight: 520, marginTop: 6 }}
                        nestedScrollEnabled
                      />
                    )}

                    <View style={[styles.pageBar, { marginTop: 10 }]}>
                      <Text style={styles.pageInfo}>
                        Page {safePage} of {totalPages}
                      </Text>
                      <View style={styles.pageBtns}>
                        <PageBtn
                          label="First"
                          disabled={safePage === 1}
                          onPress={() => setPage(1)}
                        />
                        <PageBtn
                          label="Prev"
                          disabled={safePage === 1}
                          onPress={() => setPage(safePage - 1)}
                        />
                        <PageBtn
                          label="Next"
                          disabled={safePage >= totalPages}
                          onPress={() => setPage(safePage + 1)}
                        />
                        <PageBtn
                          label="Last"
                          disabled={safePage >= totalPages}
                          onPress={() => setPage(totalPages)}
                        />
                      </View>
                    </View>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* EDIT modal */}
      <Modal
        visible={editVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View
            style={[
              styles.modalCard,
              Platform.OS !== "web" && {
                maxHeight: Math.round(Dimensions.get("window").height * 0.85),
              },
            ]}
          >
            <ScrollView
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.modalTitle}>Edit {editRow?.reading_id}</Text>

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
                  <TextInput
                    style={styles.input}
                    value={editValue}
                    onChangeText={setEditValue}
                    keyboardType="numeric"
                    placeholder="Reading value"
                  />
                </View>
                <DatePickerField
                  label="Date read"
                  value={editDate}
                  onChange={setEditDate}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
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
                    <Text style={styles.btnText}>Save changes</Text>
                  )}
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
              uiControls={{
                showControls: true,
                showTorchButton: true,
                showStatus: true,
              }}
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
              Camera access requires HTTPS in the browser. If the camera does
              not start, please use the dropdown instead.
            </Text>
          ) : null}

          <SafeAreaView style={styles.scanFooter} pointerEvents="box-none">
            <Text style={styles.scanHint}>
              Point your camera at a meter QR code to quick-edit its latest
              reading or pre-fill the form.
            </Text>
            <TouchableOpacity
              style={[styles.btn, styles.scanCloseBtn]}
              onPress={() => setScanVisible(false)}
            >
              <Text style={styles.btnText}>Close</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>

      {/* --- OFFLINE HISTORY MODAL (reworked UI) --- */}
      <Modal
        visible={historyVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setHistoryVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalWrap}
        >
          <View
            style={[
              styles.modalCardWide,
              Platform.OS !== "web" && {
                maxHeight: Math.round(Dimensions.get("window").height * 0.9),
              },
            ]}
          >
            {/* Header / Actions */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Offline History</Text>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    filteredScans.length ? null : styles.actionBtnDisabled,
                  ]}
                  disabled={!filteredScans.length}
                  onPress={() => approveAll(token)}
                >
                  <Text style={styles.actionBtnText}>Approve All</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnGhost]}
                  onPress={() => setHistoryVisible(false)}
                >
                  <Text style={styles.actionBtnGhostText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Tabs */}
            <View style={styles.tabsRow}>
              {[
                { key: "all", label: `All (${scans.length})` },
                {
                  key: "pending",
                  label: `Pending (${scans.filter((s) => s.status === "pending").length})`,
                },
                {
                  key: "failed",
                  label: `Failed (${scans.filter((s) => s.status === "failed").length})`,
                },
                {
                  key: "approved",
                  label: `Approved (${scans.filter((s) => s.status === "approved").length})`,
                },
              ].map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[
                    styles.tab,
                    historyTab === (t.key as any) && styles.tabActive,
                  ]}
                  onPress={() => setHistoryTab(t.key as any)}
                >
                  <Text
                    style={[
                      styles.tabText,
                      historyTab === (t.key as any) && styles.tabTextActive,
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* List */}
            <FlatList
              data={filteredScans}
              keyExtractor={(it) => it.id}
              ListEmptyComponent={
                <Text style={styles.empty}>No items in this tab.</Text>
              }
              style={{ marginTop: 8 }}
              contentContainerStyle={{ paddingBottom: 12 }}
              renderItem={({ item }) => (
                <View style={styles.historyRow}>
                  <View style={styles.rowLeft}>
                    <Text style={styles.rowTitle}>{item.meter_id}</Text>
                    <Text style={styles.rowSub}>
                      Value: {item.reading_value.toFixed(2)} • Date:{" "}
                      {item.lastread_date}
                    </Text>
                    <Text style={styles.rowSubSmall}>
                      Saved: {new Date(item.createdAt).toLocaleString()}
                    </Text>

                    <View style={styles.badgesRow}>
                      {item.status === "pending" && (
                        <Text
                          style={[styles.statusBadge, styles.statusPending]}
                        >
                          Pending
                        </Text>
                      )}
                      {item.status === "failed" && (
                        <Text style={[styles.statusBadge, styles.statusFailed]}>
                          Failed
                        </Text>
                      )}
                      {item.status === "approved" && (
                        <Text
                          style={[styles.statusBadge, styles.statusApproved]}
                        >
                          Approved
                        </Text>
                      )}
                      {!!item.error && (
                        <Text
                          style={[styles.statusBadge, styles.statusWarn]}
                          numberOfLines={1}
                        >
                          Error: {item.error}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.rowRight}>
                    <TouchableOpacity
                      style={[styles.smallBtn, styles.smallBtnGhost]}
                      onPress={() => markPending(item.id)}
                    >
                      <Text style={styles.smallBtnGhostText}>Mark Pending</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallBtn]}
                      onPress={() => approveOne(item.id, token)}
                    >
                      <Text style={styles.smallBtnText}>
                        {online ? "Approve" : "Queue"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.smallBtn, styles.smallBtnDanger]}
                      onPress={() => removeScan(item.id)}
                    >
                      <Text style={styles.smallBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// small components
function PageBtn({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.pageBtn, disabled && styles.pageBtnDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
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
        <Picker
          selectedValue={value}
          onValueChange={(itemValue) => onChange(String(itemValue))}
          style={styles.picker}
        >
          {options.map((opt) => (
            <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

function DatePickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [y, m, d] = (value || todayStr())
    .split("-")
    .map((n: string) => parseInt(n, 10));
  const [year, setYear] = useState(y || new Date().getFullYear());
  const [month, setMonth] = useState(
    (m || new Date().getMonth() + 1) as number,
  );
  const [day, setDay] = useState(d || new Date().getDate());

  useEffect(() => {
    const [py, pm, pd] = (value || todayStr())
      .split("-")
      .map((n: string) => parseInt(n, 10));
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
      <TouchableOpacity
        style={[styles.input, styles.dateButton]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.dateButtonText}>{value || todayStr()}</Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.dateModalCard}>
            <Text style={[styles.modalTitle, { marginBottom: 8 }]}>
              Pick a date
            </Text>
            <View style={styles.datePickersRow}>
              <View style={styles.datePickerCol}>
                <Text style={styles.dropdownLabel}>Year</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={year}
                    onValueChange={(v) => setYear(Number(v))}
                  >
                    {Array.from({ length: 80 }).map((_, i) => {
                      const yr = 1980 + i;
                      return (
                        <Picker.Item key={yr} label={String(yr)} value={yr} />
                      );
                    })}
                  </Picker>
                </View>
              </View>
              <View style={styles.datePickerCol}>
                <Text style={styles.dropdownLabel}>Month</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={month}
                    onValueChange={(v) => setMonth(Number(v))}
                  >
                    {Array.from({ length: 12 }).map((_, i) => (
                      <Picker.Item
                        key={i + 1}
                        label={String(i + 1)}
                        value={i + 1}
                      />
                    ))}
                  </Picker>
                </View>
              </View>
              <View style={styles.datePickerCol}>
                <Text style={styles.dropdownLabel}>Day</Text>
                <View style={styles.pickerWrapper}>
                  <Picker
                    selectedValue={day}
                    onValueChange={(v) => setDay(Number(v))}
                  >
                    {Array.from({ length: 31 }).map((_, i) => (
                      <Picker.Item
                        key={i + 1}
                        label={String(i + 1)}
                        value={i + 1}
                      />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>

            <View style={[styles.modalActions, { marginTop: 16 }]}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setOpen(false)}
              >
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

function formatDateTime(dt: string) {
  try {
    const d = new Date(dt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return dt;
  }
}

// --- styles ---
const styles = StyleSheet.create({
  grid: { gap: 16 },

  // info bar
  infoBar: {
    padding: 10,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoOnline: {
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#10b98155",
  },
  infoOffline: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#f59e0b55",
  },
  infoText: { fontWeight: "800", color: "#111827" },
  historyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#1f4bd8",
  },
  historyBtnText: { color: "#fff", fontWeight: "800" },

  // card
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
  cardHeader: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#102a43" },

  // list rows
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
  rowSub: {
    fontSize: 13,
    color: "#2c3e50",
    textAlign: "left",
    fontWeight: "600",
    backgroundColor: "#ffffffff",
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginLeft: -9,
    borderRadius: 8,
  },
  centerText: {
    textAlign: "center",
    width: "100%",
    color: "#1f4bd8",
    fontWeight: "900",
    fontSize: 15,
    marginLeft: 75,
  },

  // buttons/links
  btn: {
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    paddingHorizontal: 14,
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  btnGhostText: { color: "#102a43", fontWeight: "700" },
  link: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#eef2ff",
  },
  linkText: { color: "#1f4bd8", fontWeight: "700" },

  // search
  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },

  // loader/empty
  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },

  // modals
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
    maxWidth: 480,
  },
  modalCardWide: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "95%",
    maxWidth: 960,
    height: "95%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43",
    marginBottom: 12,
  }, // <- modalTitle style

  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },

  /* Header */
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },

  headerActions: {
    flexDirection: "row",
    gap: 8,
  },

  actionBtn: {
    backgroundColor: "#1f4bd8",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  actionBtnText: { color: "#fff", fontWeight: "800" },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  actionBtnGhostText: { color: "#102a43", fontWeight: "800" },

  /* Tabs */
  tabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    backgroundColor: "#f7f9ff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6efff",
    padding: 8,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d9e2ec",
  },
  tabActive: {
    backgroundColor: "#1f4bd8",
    borderColor: "#1f4bd8",
  },
  tabText: { color: "#102a43", fontWeight: "800" },
  tabTextActive: { color: "#fff" },

  /* Rows */
  historyRow: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 12,
    backgroundColor: "#fff",
    ...Platform.select({
      web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any },
      default: { elevation: 1 },
    }),
    padding: 12,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
  },
  rowLeft: { flex: 1, gap: 4 },
  rowRight: {
    justifyContent: "center",
    alignItems: "flex-end",
    gap: 6,
    minWidth: 110,
  },

  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },

  statusBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    fontSize: 12,
    overflow: "hidden",
  },
  statusPending: {
    backgroundColor: "#fff7ed",
    color: "#9a3412",
    borderWidth: 1,
    borderColor: "#f59e0b55",
  },
  statusFailed: {
    backgroundColor: "#fef2f2",
    color: "#7f1d1d",
    borderWidth: 1,
    borderColor: "#ef444455",
  },
  statusApproved: {
    backgroundColor: "#ecfdf5",
    color: "#065f46",
    borderWidth: 1,
    borderColor: "#10b98155",
  },
  statusWarn: {
    backgroundColor: "#fefce8",
    color: "#713f12",
    borderWidth: 1,
    borderColor: "#facc1555",
  },

  rowSubSmall: { fontSize: 12, color: "#64748b" },

  /* Small actions */
  smallBtn: {
    backgroundColor: "#1f4bd8",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  smallBtnText: { color: "#fff", fontWeight: "800" },
  smallBtnDanger: { backgroundColor: "#e53935" },
  smallBtnGhost: { backgroundColor: "#eef2ff" },
  smallBtnGhostText: { color: "#1f4bd8", fontWeight: "800" },

  // dropdowns
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

  // datepicker
  dateButton: { minWidth: 160, justifyContent: "center" },
  dateButtonText: { color: "#102a43" },
  dateModalCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "100%",
    maxWidth: 520,
  },
  datePickersRow: { flexDirection: "row", gap: 12 },
  datePickerCol: { flex: 1 },

  // chips
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
  stackCol: { flexDirection: "column" },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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

  // scanner styles
  scanBtn: {
    marginTop: 35,
    backgroundColor: "#0ea5e9",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  scanBtnText: { color: "#fff", fontWeight: "700" },
  scannerScreen: { flex: 1, backgroundColor: "#000" },
  scannerFill: { ...StyleSheet.absoluteFillObject },
  scanTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
    alignItems: "flex-start",
  },
  closeFab: {
    marginTop: 52,
    marginLeft: 9,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.95)",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 6 },
      web: { boxShadow: "0 6px 16px rgba(0,0,0,0.25)" as any },
    }),
  },
  closeFabText: {
    color: "#111827",
    fontSize: 26,
    lineHeight: 26,
    fontWeight: "800",
  },
  scanTopInfo: { position: "absolute", top: 64, left: 16, right: 16 },
  scanInfo: { color: "#e5e7eb", textAlign: "center", marginBottom: 8 },
  scanHint: { color: "#e5e7eb", textAlign: "center", marginBottom: 12 },
  scanFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  scanCloseBtn: { alignSelf: "stretch" },

  // badges + links
  badge: {
    backgroundColor: "#e5e7eb",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignSelf: "center",
  },
  badgeActive: { backgroundColor: "#1f4bd8" },
  badgeText: { color: "#102a43", fontSize: 12 }, // <- badgeText style
  badgeTextActive: { color: "#fff", fontSize: 12 },
  meterLink: { color: "#1f4bd8", textDecorationLine: "underline" },

  // pagination
  pageBar: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pageInfo: { color: "#334e68", fontWeight: "600" },
  pageBtns: { flexDirection: "row", gap: 6, alignItems: "center" },
  pageBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#fff",
  },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { color: "#102a43", fontWeight: "700" },
  rowWrap: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },

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
});