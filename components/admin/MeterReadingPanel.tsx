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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import NetInfo from "@react-native-community/netinfo";
import { QRCodeScanner, OnSuccessfulScanProps } from "@masumdev/rn-qrcode-scanner";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { BASE_API } from "../../constants/api";
import { useScanHistory } from "../../contexts/ScanHistoryContext";

// ---------- helpers ----------
const todayStr = () => new Date().toISOString().slice(0, 10);
function notify(title: string, message?: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) window.alert(message ? `${title}\n\n${message}` : title); else Alert.alert(title, message);
}
function errorText(err: any, fallback = "Server error.") {
  const d = err?.response?.data; if (typeof d === "string") return d; if (d?.error) return String(d.error); if (d?.message) return String(d.message); if (err?.message) return String(err.message); try { return JSON.stringify(d ?? err); } catch { return fallback; }
}
function decodeJwtPayload(token: string | null): any | null {
  if (!token) return null; try { const part = token.split(".")[1] || ""; const base64 = part.replace(/-/g, "+").replace(/_/g, "/"); const padLen = (4 - (base64.length % 4)) % 4; const padded = base64 + "=".repeat(padLen); const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="; let str = ""; for (let i = 0; i < padded.length; i += 4) { const c1 = chars.indexOf(padded[i]); const c2 = chars.indexOf(padded[i + 1]); const c3 = chars.indexOf(padded[i + 2]); const c4 = chars.indexOf(padded[i + 3]); const n = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63); const b1 = (n >> 16) & 255, b2 = (n >> 8) & 255, b3 = n & 255; if (c3 === 64) str += String.fromCharCode(b1); else if (c4 === 64) str += String.fromCharCode(b1, b2); else str += String.fromCharCode(b1, b2, b3);} const json = decodeURIComponent(str.split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")); return JSON.parse(json);} catch { return null; }
}
function fmtValue(n: number | string | null | undefined, unit?: string) {
  if (n == null) return "—"; const v = typeof n === "string" ? parseFloat(n) : n; if (!isFinite(v)) return String(n); const formatted = Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(v); return unit ? `${formatted} ${unit}` : formatted;
}
function formatDateTime(dt: string) { try { const d = new Date(dt); const yyyy = d.getFullYear(); const mm = String(d.getMonth()+1).padStart(2,"0"); const dd = String(d.getDate()).padStart(2,"0"); const hh = String(d.getHours()).padStart(2,"0"); const mi = String(d.getMinutes()).padStart(2,"0"); return `${yyyy}-${mm}-${dd} ${hh}:${mi}`; } catch { return dt; } }

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    // Web: use the native confirm
    return Promise.resolve(!!window.confirm(`${title}\n\n${message}`));
  }
  // Mobile: use RN Alert
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}


// ---------- types ----------
export type Reading = { reading_id: string; meter_id: string; reading_value: number; read_by: string; lastread_date: string; last_updated: string; updated_by: string; };
export type Meter = { meter_id: string; meter_type: "electric"|"water"|"lpg"; meter_sn: string; meter_mult: number; stall_id: string; meter_status: "active"|"inactive"; last_updated: string; updated_by: string; };
type Stall = { stall_id: string; building_id?: string; stall_sn?: string };
type Building = { building_id: string; building_name: string };

export default function MeterReadingPanel({ token }: { token: string | null }) {
  // auth + api
  const jwt = useMemo(() => decodeJwtPayload(token), [token]);
  const isAdmin = String(jwt?.user_level || "").toLowerCase() === "admin";
  const userBuildingId = String(jwt?.building_id || "");
  const authHeader = useMemo(() => ({ Authorization: `Bearer ${token ?? ""}` }), [token]);
  const api = useMemo(() => axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }), [authHeader]);

  // connectivity
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  useEffect(() => { const sub = NetInfo.addEventListener((s) => setIsConnected(!!s.isConnected)); NetInfo.fetch().then((s) => setIsConnected(!!s.isConnected)); return () => sub && sub(); }, []);

  const { scans, queueScan, removeScan, approveOne, approveAll, markPending, isConnected: ctxConnected } = useScanHistory();
  const online = isConnected ?? ctxConnected ?? false;

  // filters + data
  const [typeFilter, setTypeFilter] = useState<""|"electric"|"water"|"lpg">("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<"date_desc"|"date_asc"|"id_desc"|"id_asc">("date_desc");
  const [filtersVisible, setFiltersVisible] = useState(false);

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
  const PAGE_SIZE = 30; const [page, setPage] = useState(1); useEffect(() => { setPage(1); }, [selectedMeterId]);

  const [createVisible, setCreateVisible] = useState(false);
  const [formMeterId, setFormMeterId] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState<string>(todayStr());
  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Reading | null>(null);
  const [editMeterId, setEditMeterId] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editDate, setEditDate] = useState("");
  const [scanVisible, setScanVisible] = useState(false); const [scannerKey, setScannerKey] = useState(0); const readingInputRef = useRef<TextInput>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyTab, setHistoryTab] = useState<"all"|"pending"|"failed"|"approved">("all");

  // derived
  const filteredScans = useMemo(() => historyTab === "all" ? scans : scans.filter((s) => s.status === historyTab), [scans, historyTab]);
  const readNum = (id: string) => { const m = /^MR-(\d+)/i.exec(id || ""); return m ? parseInt(m[1],10) : 0; };

  // load
  useEffect(() => { loadAll(); }, [token]);
  const loadAll = async () => {
    if (!token) { setBusy(false); notify("Not logged in","Please log in to manage meter readings."); return; }
    try { setBusy(true); const [rRes, mRes, sRes] = await Promise.all([api.get<Reading[]>("/readings"), api.get<Meter[]>("/meters"), api.get<Stall[]>("/stalls")]); setReadings(rRes.data || []); setMeters(mRes.data || []); setStalls(sRes.data || []); if (!formMeterId && mRes.data?.length) setFormMeterId(mRes.data[0].meter_id); if (isAdmin) { try { const bRes = await api.get<Building[]>("/buildings"); setBuildings(bRes.data || []);} catch { setBuildings([]);} } }
    catch (err:any) { notify("Load failed", errorText(err, "Please check your connection and permissions.")); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (selectedMeterId) setFormMeterId(selectedMeterId); }, [selectedMeterId]);

  const metersById = useMemo(() => { const map = new Map<string, Meter>(); meters.forEach((m) => map.set(m.meter_id, m)); return map; }, [meters]);
  const stallToBuilding = useMemo(() => { const m = new Map<string,string>(); stalls.forEach((s) => { if (s?.stall_id && s?.building_id) m.set(s.stall_id, s.building_id); }); return m; }, [stalls]);
  const buildingChipOptions = useMemo(() => {
    if (isAdmin && buildings.length) { return [{label:"All Buildings", value:""}, ...buildings.slice().sort((a,b)=>a.building_name.localeCompare(b.building_name)).map((b)=>({label:`${b.building_name} (${b.building_id})`, value:b.building_id}))]; }
    const base = [{label:"All Buildings", value:""}]; if (userBuildingId) return base.concat([{label:userBuildingId, value:userBuildingId}]); const ids = Array.from(new Set(stalls.map((s)=>s.building_id).filter(Boolean) as string[])).sort(); return base.concat(ids.map((id)=>({label:id, value:id})));
  }, [isAdmin, buildings, stalls, userBuildingId]);

  const metersVisible = useMemo(() => { let list = meters; if (typeFilter) list = list.filter((m)=> (m.meter_type||"").toLowerCase() === typeFilter); if (buildingFilter) list = list.filter((m)=> stallToBuilding.get(m.stall_id||"") === buildingFilter); const q = meterQuery.trim().toLowerCase(); if (q) list = list.filter((m)=> [m.meter_id,m.meter_sn,m.stall_id,m.meter_status,m.meter_type].filter(Boolean).some((v)=> String(v).toLowerCase().includes(q))); const mtrNum = (id:string)=>{ const m = /^MTR-(\d+)/i.exec(id||""); return m?parseInt(m[1],10):Number.MAX_SAFE_INTEGER; }; return [...list].sort((a,b)=> mtrNum(a.meter_id) - mtrNum(b.meter_id) || a.meter_id.localeCompare(b.meter_id)); }, [meters, typeFilter, buildingFilter, meterQuery, stallToBuilding]);

  const readingsForSelected = useMemo(() => { if (!selectedMeterId) return []; const typed = readings.filter((r)=> r.meter_id === selectedMeterId); const searched = query.trim()? typed.filter((r)=> r.reading_id.toLowerCase().includes(query.toLowerCase()) || r.lastread_date.toLowerCase().includes(query.toLowerCase()) || String(r.reading_value).toLowerCase().includes(query.toLowerCase())) : typed; const arr = [...searched]; switch (sortBy){ case "date_asc": arr.sort((a,b)=> a.lastread_date.localeCompare(b.lastread_date) || readNum(a.reading_id) - readNum(b.reading_id)); break; case "id_asc": arr.sort((a,b)=> readNum(a.reading_id) - readNum(b.reading_id)); break; case "id_desc": arr.sort((a,b)=> readNum(b.reading_id) - readNum(a.reading_id)); break; case "date_desc": default: arr.sort((a,b)=> b.lastread_date.localeCompare(a.lastread_date) || readNum(b.reading_id) - readNum(a.reading_id)); } return arr; }, [readings, selectedMeterId, query, sortBy]);

  // create/update/delete
  const onCreate = async () => {
    if (!formMeterId || !formValue) { notify("Missing info","Please select a meter and enter a reading."); return; }
    const valueNum = parseFloat(formValue); if (Number.isNaN(valueNum)) { notify("Invalid value","Reading must be a number."); return; }
    if (!online) { await queueScan({ meter_id: formMeterId, reading_value: valueNum, lastread_date: formDate || todayStr(), }); setFormValue(""); setFormDate(todayStr()); setCreateVisible(false); notify("Saved offline","The reading was added to Offline History. Approve it when you have internet."); return; }
    try { setSubmitting(true); await api.post("/readings", { meter_id: formMeterId, reading_value: valueNum, lastread_date: formDate || todayStr() }); setFormValue(""); setFormDate(todayStr()); setCreateVisible(false); await loadAll(); notify("Success","Meter reading recorded."); }
    catch (err:any) { notify("Create failed", errorText(err)); }
    finally { setSubmitting(false); }
  };
  const openEdit = (row: Reading) => { setEditRow(row); setEditMeterId(row.meter_id); setEditValue(String(row.reading_value)); setEditDate(row.lastread_date); setEditVisible(true); };
  const onUpdate = async () => { if (!editRow) return; try { setSubmitting(true); await api.put(`/readings/${encodeURIComponent(editRow.reading_id)}`, { meter_id: editMeterId, reading_value: editValue === "" ? undefined : parseFloat(editValue), lastread_date: editDate }); setEditVisible(false); await loadAll(); notify("Updated","Reading updated successfully."); } catch (err:any) { notify("Update failed", errorText(err)); } finally { setSubmitting(false); } };
  const onDelete = async (row?: Reading) => {
    const target = row ?? editRow;
    if (!target) return;

    const ok = await confirm(
      "Delete reading?",
      `Are you sure you want to delete ${target.reading_id}? This cannot be undone.`
    );
    if (!ok) return;

    try {
      setSubmitting(true);
      await api.delete(`/readings/${encodeURIComponent(target.reading_id)}`);
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
  const onScan = (data: OnSuccessfulScanProps | string) => { const raw = String((data as any)?.code ?? (data as any)?.rawData ?? (data as any)?.data ?? data ?? "").trim(); if (!raw) return; const meterIdPattern = /^MTR-[A-Za-z0-9-]+$/i; if (!meterIdPattern.test(raw)) return; const meterId = raw; setScanVisible(false); if (!metersById.get(meterId)) { notify("Unknown meter", `No meter found for id: ${meterId}`); return; } setFormMeterId(meterId); setFormValue(""); setFormDate(todayStr()); setTimeout(()=> readingInputRef.current?.focus?.(), 150); };
  const openScanner = () => { setScannerKey((k)=>k+1); setScanVisible(true); Keyboard.dismiss(); };

  // ---------- UI ----------
  return (
    <View style={styles.grid}>
      {/* connectivity banner */}
      <View style={[styles.infoBar, online ? styles.infoOnline : styles.infoOffline]}>
        <Text style={styles.infoText}>{online ? "Online" : "Offline"}</Text>
        <TouchableOpacity style={styles.historyBtn} onPress={() => setHistoryVisible(true)}>
          <Text style={styles.historyBtnText}>Offline History ({scans.length})</Text>
        </TouchableOpacity>
      </View>

      {/* Meters card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Meters</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setCreateVisible(true)}><Text style={styles.btnText}>+ Create Reading</Text></TouchableOpacity>
        </View>

        {/* Search + Filters button */}
        <View style={styles.topBar}>
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
            <Ionicons name="filter-outline" size={16} color="#394e6a" style={{ marginRight: 6 }} />
            <Text style={styles.btnGhostText}>Filters</Text>
          </TouchableOpacity>
        </View>

        {/* Filters Modal */}
        <Modal visible={filtersVisible} animationType="fade" transparent onRequestClose={() => setFiltersVisible(false)}>
          <View style={styles.promptOverlay}>
            <View style={styles.promptCard}>
              <Text style={styles.modalTitle}>Filters & Sort</Text>
              <View style={styles.modalDivider} />

              <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>Building</Text>
              <View style={styles.chipsRow}>
                {buildingChipOptions.map((opt) => (
                  <Chip key={opt.value || "all"} label={opt.label} active={buildingFilter === opt.value} onPress={() => setBuildingFilter(opt.value)} />
                ))}
              </View>

              <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Type</Text>
              <View style={styles.chipsRow}>
                {[{label:"All", val:""}, {label:"Electric", val:"electric"}, {label:"Water", val:"water"}, {label:"LPG", val:"lpg"}].map(({label,val}) => (
                  <Chip key={label} label={label} active={typeFilter === (val as any)} onPress={() => setTypeFilter(val as any)} />
                ))}
              </View>

              <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>Sort by</Text>
              <View style={styles.chipsRow}>
                {[{label:"Newest", val:"date_desc"},{label:"Oldest", val:"date_asc"},{label:"ID ↑", val:"id_asc"},{label:"ID ↓", val:"id_desc"}].map(({label,val}) => (
                  <Chip key={val} label={label} active={sortBy === (val as any)} onPress={() => setSortBy(val as any)} />
                ))}
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={() => { setMeterQuery(''); setBuildingFilter(''); setTypeFilter(''); setSortBy('date_desc'); setFiltersVisible(false); }}
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

        {/* list */}
        {busy ? (
          <View style={styles.loader}><ActivityIndicator /></View>
        ) : (
          <FlatList
            data={metersVisible}
            keyExtractor={(m)=>m.meter_id}
            style={{ flexGrow: 1, marginTop: 4 }}
            contentContainerStyle={{ paddingBottom: 8 }}
            nestedScrollEnabled
            ListEmptyComponent={<Text style={styles.empty}>No meters found.</Text>}
            renderItem={({ item }) => (            
          <TouchableOpacity onPress={() => { setSelectedMeterId(item.meter_id); setQuery(""); setPage(1); setReadingsModalVisible(true); }} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}><Text style={styles.meterLink}>{item.meter_id}</Text> • {item.meter_type.toUpperCase()}</Text>
                <Text style={styles.rowSub}>SN: {item.meter_sn} • Stall: {item.stall_id} • {item.meter_status}</Text>
              </View>
              <View style={styles.badge}><Text style={styles.badgeText}>View</Text></View>
            </TouchableOpacity>
          )} />
        )}
      </View>

      {/* CREATE modal */}
      <Modal visible={createVisible} animationType="slide" transparent onRequestClose={() => setCreateVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.85) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>Create Reading</Text>
              <View style={styles.rowWrap}>
                <Dropdown label="Meter" value={formMeterId} onChange={setFormMeterId} options={meters.map((m)=>({ label: `${m.meter_id} • ${m.meter_type} • ${m.meter_sn}`, value: m.meter_id }))} />
                <TouchableOpacity style={styles.scanBtn} onPress={openScanner}><Text style={styles.scanBtnText}>Scan QR to select</Text></TouchableOpacity>
              </View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Reading Value</Text>
                  <TextInput ref={readingInputRef} style={styles.input} keyboardType="numeric" value={formValue} onChangeText={setFormValue} placeholder="Reading value" />
                </View>
                <DatePickerField label="Date read" value={formDate} onChange={setFormDate} />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setCreateVisible(false)}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onCreate} disabled={submitting}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{online ? "Save Reading" : "Save Offline"}</Text>}</TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* READINGS modal (paginated) */}
      <ReadingsModal visible={readingsModalVisible} onClose={() => { setReadingsModalVisible(false); setSelectedMeterId(""); setQuery(""); setPage(1); }} selectedMeterId={selectedMeterId} query={query} setQuery={setQuery} sortBy={sortBy} setSortBy={setSortBy} readingsForSelected={readingsForSelected} page={page} setPage={setPage} metersById={metersById} submitting={submitting} onDelete={onDelete} openEdit={openEdit} busy={busy} />

      {/* EDIT modal */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={[styles.modalCard, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.85) }]}>
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Update {editRow?.reading_id}</Text>
              <Dropdown label="Meter" value={editMeterId} onChange={setEditMeterId} options={meters.map((m)=>({ label: `${m.meter_id} • ${m.meter_type} • ${m.meter_sn}`, value: m.meter_id }))} />
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Reading Value</Text>
                  <TextInput style={styles.input} value={editValue} onChangeText={setEditValue} keyboardType="numeric" placeholder="Reading value" />
                </View>
                <DatePickerField label="Date read" value={editDate} onChange={setEditDate} />
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setEditVisible(false)}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btn, submitting && styles.btnDisabled]} onPress={onUpdate} disabled={submitting}>{submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Save changes</Text>}</TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* QR SCANNER */}
      <Modal visible={scanVisible} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={() => setScanVisible(false)}>
        <View style={styles.scannerScreen}>
          <View style={styles.scannerFill}>
            <QRCodeScanner key={scannerKey} core={{ onSuccessfulScan: onScan }} scanning={{ cooldownDuration: 1200 }} uiControls={{ showControls: true, showTorchButton: true, showStatus: true }} />
          </View>
          <SafeAreaView style={styles.scanTopBar} pointerEvents="box-none">
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close scanner" onPress={() => setScanVisible(false)} style={styles.closeFab} hitSlop={{ top:10,left:10,right:10,bottom:10 }}>
              <Text style={styles.closeFabText}>×</Text>
            </TouchableOpacity>
          </SafeAreaView>
          {Platform.OS === "web" ? (<Text style={[styles.scanInfo, styles.scanTopInfo]}>Camera access requires HTTPS in the browser. If the camera does not start, please use the dropdown instead.</Text>) : null}
          <SafeAreaView style={styles.scanFooter} pointerEvents="box-none">
            <Text style={styles.scanHint}>Point your camera at a meter QR code to quick-edit its latest reading or pre-fill the form.</Text>
            <TouchableOpacity style={[styles.btn, styles.scanCloseBtn]} onPress={() => setScanVisible(false)}><Text style={styles.btnText}>Close</Text></TouchableOpacity>
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
    </View>
  );
}

// ---------- small components ----------
function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void; }) { return (<TouchableOpacity onPress={onPress} style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}><Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{label}</Text></TouchableOpacity>); }

function PageBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void; }) {
  return (<TouchableOpacity style={[styles.pageBtn, disabled && styles.pageBtnDisabled]} disabled={disabled} onPress={onPress}><Text style={styles.pageBtnText}>{label}</Text></TouchableOpacity>);
}

function Dropdown({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; }) {
  return (<View style={{ marginTop: 8, flex: 1 }}><Text style={styles.dropdownLabel}>{label}</Text><View style={styles.pickerWrapper}><Picker selectedValue={value} onValueChange={(itemValue) => onChange(String(itemValue))} style={styles.picker}>{options.map((opt) => (<Picker.Item key={opt.value} label={opt.label} value={opt.value} />))}</Picker></View></View>);
}

function DatePickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
  const [open, setOpen] = useState(false);
  const [y,m,d] = (value || todayStr()).split("-").map((n: string) => parseInt(n,10));
  const [year, setYear] = useState(y || new Date().getFullYear());
  const [month, setMonth] = useState((m || new Date().getMonth()+1) as number);
  const [day, setDay] = useState(d || new Date().getDate());
  useEffect(() => { const [py,pm,pd] = (value || todayStr()).split("-").map((n:string)=>parseInt(n,10)); if (py && pm && pd) { setYear(py); setMonth(pm); setDay(pd); } }, [value]);
  const commit = () => { const mm = String(month).padStart(2,"0"); const dd = String(day).padStart(2,"0"); onChange(`${year}-${mm}-${dd}`); setOpen(false); };
  return (<View style={{ marginTop: 8 }}><Text style={styles.dropdownLabel}>{label}</Text><TouchableOpacity style={[styles.input, styles.dateButton]} onPress={() => setOpen(true)}><Text style={styles.dateButtonText}>{value || todayStr()}</Text></TouchableOpacity><Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={styles.modalWrap}><View style={styles.dateModalCard}><Text style={[styles.modalTitle,{marginBottom:8}]}>Pick a date</Text><View style={styles.datePickersRow}><View style={styles.datePickerCol}><Text style={styles.dropdownLabel}>Year</Text><View style={styles.pickerWrapper}><Picker selectedValue={year} onValueChange={(v)=>setYear(Number(v))}>{Array.from({length:80}).map((_,i)=>{const yr=1980+i; return (<Picker.Item key={yr} label={String(yr)} value={yr} />);})}</Picker></View></View><View style={styles.datePickerCol}><Text style={styles.dropdownLabel}>Month</Text><View style={styles.pickerWrapper}><Picker selectedValue={month} onValueChange={(v)=>setMonth(Number(v))}>{Array.from({length:12}).map((_,i)=>(<Picker.Item key={i+1} label={String(i+1)} value={i+1} />))}</Picker></View></View><View style={styles.datePickerCol}><Text style={styles.dropdownLabel}>Day</Text><View style={styles.pickerWrapper}><Picker selectedValue={day} onValueChange={(v)=>setDay(Number(v))}>{Array.from({length:31}).map((_,i)=>(<Picker.Item key={i+1} label={String(i+1)} value={i+1} />))}</Picker></View></View></View><View style={[styles.modalActions,{marginTop:16}]}><TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={()=>setOpen(false)}><Text style={styles.btnGhostText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={styles.btn} onPress={commit}><Text style={styles.btnText}>Use date</Text></TouchableOpacity></View></View></View></Modal></View>);
}

function ReadingsModal({ visible, onClose, selectedMeterId, query, setQuery, sortBy, setSortBy, readingsForSelected, page, setPage, metersById, submitting, onDelete, openEdit, busy }: any) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
        <View style={[styles.modalCardWide, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.9) }]}>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection:"row", justifyContent:"space-between", alignItems:"center" }}>
              <Text style={styles.modalTitle}>Readings for <Text style={styles.meterLink}>{selectedMeterId || "—"}</Text></Text>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={onClose}><Text style={styles.btnGhostText}>Close</Text></TouchableOpacity>
            </View>

            <View style={[styles.searchWrap, { marginTop: 8 }]}>
              <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput style={styles.search} placeholder="Search readings (ID, date, value…)" value={query} onChangeText={(v)=>{ setQuery(v); setPage(1); }} />
            </View>

            <Text style={[styles.dropdownLabel,{marginTop:8}]}>Sort readings</Text>
            <View style={styles.chipsRow}>
              {[{label:"Newest",val:"date_desc"},{label:"Oldest",val:"date_asc"},{label:"ID ↑",val:"id_asc"},{label:"ID ↓",val:"id_desc"}].map(({label,val})=> (
                <Chip key={val} label={label} active={sortBy === (val as any)} onPress={()=>{ setSortBy(val as any); setPage(1); }} />
              ))}
            </View>

            {(() => { const total = readingsForSelected.length; const totalPages = Math.max(1, Math.ceil(total/30)); const safePage = Math.min(page, totalPages); const start = (safePage-1)*30; const pageData = readingsForSelected.slice(start, start+30);
              return (<>
                <View style={styles.pageBar}><Text style={styles.pageInfo}>Page {safePage} of {totalPages} • {total} item{total===1?"":"s"}</Text><View style={styles.pageBtns}><PageBtn label="First" disabled={safePage===1} onPress={()=>setPage(1)} /><PageBtn label="Prev" disabled={safePage===1} onPress={()=>setPage(safePage-1)} /><PageBtn label="Next" disabled={safePage>=totalPages} onPress={()=>setPage(safePage+1)} /><PageBtn label="Last" disabled={safePage>=totalPages} onPress={()=>setPage(totalPages)} /></View></View>
                {busy ? (<View style={styles.loader}><ActivityIndicator /></View>) : (
                  <FlatList data={pageData} keyExtractor={(item)=>item.reading_id} ListEmptyComponent={<Text style={styles.empty}>No readings for this meter.</Text>} renderItem={({ item }) => (
                    <View style={styles.listRow}>
                      <View style={{ flex:1 }}>
                        <Text style={styles.rowTitle}>{item.reading_id} • <Text style={styles.meterLink}>{item.meter_id}</Text></Text>
                        {(() => { const mType = metersById.get(item.meter_id)?.meter_type; const unit = mType === "electric" ? "" : mType === "water" ? "" : mType === "lpg" ? "" : undefined; return (<Text style={[styles.rowSub, styles.centerText]}>{item.lastread_date} • Value: {fmtValue(item.reading_value, unit)}</Text>); })()}
                        <Text style={styles.rowSub}>Updated {formatDateTime(item.last_updated)} by {item.updated_by}</Text>
                      </View>
                      <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={()=>openEdit(item)}>
                        <Text style={styles.actionBtnGhostText}>Update</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={()=>onDelete(item)} disabled={submitting}>
                        {submitting ? (<ActivityIndicator color="#fff" />) : (<Text style={styles.actionBtnText}>Delete</Text>)}
                      </TouchableOpacity>
                    </View>
                  )} style={{ maxHeight: 520, marginTop: 6 }} nestedScrollEnabled />
                )}
                <View style={[styles.pageBar,{marginTop:10}]}><Text style={styles.pageInfo}>Page {safePage} of {totalPages}</Text><View style={styles.pageBtns}><PageBtn label="First" disabled={safePage===1} onPress={()=>setPage(1)} /><PageBtn label="Prev" disabled={safePage===1} onPress={()=>setPage(safePage-1)} /><PageBtn label="Next" disabled={safePage>=totalPages} onPress={()=>setPage(safePage+1)} /><PageBtn label="Last" disabled={safePage>=totalPages} onPress={()=>setPage(totalPages)} /></View></View>
              </>); })()}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function HistoryModal({ visible, onClose, scans, approveAll, markPending, approveOne, removeScan, online }: any) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
        <View style={[styles.modalCardWide, Platform.OS !== "web" && { maxHeight: Math.round(Dimensions.get("window").height * 0.9) }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Offline History</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity style={[styles.actionBtn, scans.length ? null : styles.actionBtnDisabled]} disabled={!scans.length} onPress={approveAll}>
                <Text style={styles.actionBtnText}>Approve All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={onClose}>
                <Text style={styles.actionBtnGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
          <FlatList data={scans} keyExtractor={(it)=>it.id} ListEmptyComponent={<Text style={styles.empty}>No items in this tab.</Text>} style={{ marginTop: 8 }} contentContainerStyle={{ paddingBottom: 12 }} renderItem={({ item }) => (
            <View style={styles.historyRow}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowTitle}>{item.meter_id}</Text>
                <Text style={styles.rowSub}>Value: {item.reading_value.toFixed(2)} • Date: {item.lastread_date}</Text>
                <Text style={styles.rowSubSmall}>Saved: {new Date(item.createdAt).toLocaleString()}</Text>
                <View style={styles.badgesRow}>
                  {item.status === "pending" && (<Text style={[styles.statusBadge, styles.statusPending]}>Pending</Text>)}
                  {item.status === "failed" && (<Text style={[styles.statusBadge, styles.statusFailed]}>Failed</Text>)}
                  {item.status === "approved" && (<Text style={[styles.statusBadge, styles.statusApproved]}>Approved</Text>)}
                  {!!item.error && (<Text style={[styles.statusBadge, styles.statusWarn]} numberOfLines={1}>Error: {item.error}</Text>)}
                </View>
              </View>
              <View style={styles.rowRight}>
                <TouchableOpacity style={[styles.smallBtn, styles.smallBtnGhost]} onPress={() => markPending(item.id)}><Text style={styles.smallBtnGhostText}>Mark Pending</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn]} onPress={() => approveOne(item.id)}><Text style={styles.smallBtnText}>{online ? "Approve" : "Queue"}</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.smallBtn, styles.smallBtnDanger]} onPress={() => removeScan(item.id)}><Text style={styles.smallBtnText}>Delete</Text></TouchableOpacity>
              </View>
            </View>
          )} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- styles ----------
const styles = StyleSheet.create({
  grid: { flex: 1, gap: 16 },
  // info bar
  infoBar: { padding: 10, borderRadius: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  infoOnline: { backgroundColor: "#ecfdf5", borderWidth: 1, borderColor: "#10b98155" },
  infoOffline: { backgroundColor: "#fff7ed", borderWidth: 1, borderColor: "#f59e0b55" },
  infoText: { fontWeight: "800", color: "#111827" },
  historyBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#082cac" },
  historyBtnText: { color: "#fff", fontWeight: "800" },
  // card
  card: { flex: 1, minHeight: 0, borderWidth: 1, borderColor: "#edf2f7", borderRadius: 12, padding: 12, backgroundColor: "#fff", ...Platform.select({ web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any }, default: { elevation: 1 } }) as any },
  cardHeader: { marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#102a43" },
  topBar: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  // list rows
  listRow: { borderWidth: 1, borderColor: "#edf2f7", borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: "#fff", ...Platform.select({ web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any }, default: { elevation: 1 } }) as any, flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { fontWeight: "700", color: "#102a43" },
  rowSub: { fontSize: 13, color: "#2c3e50", textAlign: "left", fontWeight: "600", backgroundColor: "#ffffffff", paddingVertical: 2, paddingHorizontal: 8, marginLeft: -9, borderRadius: 8 },
  centerText: { textAlign: "center", width: "100%", color: "#082cac", fontWeight: "900", fontSize: 15, marginLeft: 75 },
  // buttons/links
  btn: { backgroundColor: "#082cac", paddingVertical: 12, borderRadius: 12, alignItems: "center", paddingHorizontal: 14 },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  btnGhostText: { color: "#394e6a", fontWeight: "700" },
  link: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: "#eef2ff" },
  linkText: { color: "#082cac", fontWeight: "700" },
  // search
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "#e2e8f0" },
  search: { flex: 1, fontSize: 14, color: "#0b1f33" },
  // loader/empty
  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },
  // modals
  modalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", paddingHorizontal: 16 },
  modalCard: { backgroundColor: "#fff", padding: 16, borderRadius: 16, width: "100%", maxWidth: 480 },
  modalCardWide: { backgroundColor: "#fff", padding: 16, borderRadius: 16, width: "95%", maxWidth: 960, height: "95%" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#102a43", marginBottom: 12 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  headerActions: { flexDirection: "row", gap: 8 },
  actionBtn: { backgroundColor: "#082cac", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  actionBtnText: { color: "#fff", fontWeight: "800" },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnGhost: { backgroundColor: "#edf2ff", borderWidth: 0 },
  actionBtnGhostText: { color: "#082cac", fontWeight: "800" },
  // history rows
  historyRow: { borderWidth: 1, borderColor: "#edf2f7", borderRadius: 12, backgroundColor: "#fff", ...Platform.select({ web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" as any }, default: { elevation: 1 } }) as any, padding: 12, marginTop: 10, flexDirection: "row", alignItems: "stretch", gap: 12 },
  rowLeft: { flex: 1, gap: 4 },
  rowRight: { justifyContent: "center", alignItems: "flex-end", gap: 6, minWidth: 110 },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  statusBadge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, fontSize: 12, overflow: "hidden" },
  statusPending: { backgroundColor: "#fff7ed", color: "#9a3412", borderWidth: 1, borderColor: "#f59e0b55" },
  statusFailed: { backgroundColor: "#fef2f2", color: "#7f1d1d", borderWidth: 1, borderColor: "#ef444455" },
  statusApproved: { backgroundColor: "#ecfdf5", color: "#065f46", borderWidth: 1, borderColor: "#10b98155" },
  statusWarn: { backgroundColor: "#fefce8", color: "#713f12", borderWidth: 1, borderColor: "#facc1555" },
  rowSubSmall: { fontSize: 12, color: "#64748b" },
  // small actions
  smallBtn: { backgroundColor: "#082cac", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, alignItems: "center" },
  smallBtnText: { color: "#fff", fontWeight: "800" },
  smallBtnDanger: { backgroundColor: "#e53935" },
  smallBtnGhost: { backgroundColor: "#eef2ff" },
  smallBtnGhostText: { color: "#082cac", fontWeight: "800" },
  // dropdowns
  pickerWrapper: { borderWidth: 1, borderColor: "#d9e2ec", borderRadius: 10, overflow: "hidden", backgroundColor: "#fff" },
  picker: { height: 50 },
  // datepicker
  dateButton: { minWidth: 160, justifyContent: "center" },
  dateButtonText: { color: "#102a43" },
  dateModalCard: { backgroundColor: "#fff", padding: 16, borderRadius: 16, width: "100%", maxWidth: 520 },
  datePickersRow: { flexDirection: "row", gap: 12 },
  datePickerCol: { flex: 1 },
  // filter chips + bar
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
  chipActive: { borderColor: "#082cac", backgroundColor: "#082cac" },
  chipText: { fontSize: 12 },
  chipTextIdle: { color: "#334e68" },
  chipTextActive: { color: "#fff" },
  // badges + links
  badge: {
    backgroundColor: "#bfbfbfff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  meterLink: { color: "#082cac", textDecorationLine: "underline" },
  // pagination
  pageBar: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  pageInfo: { color: "#334e68", fontWeight: "600" },
  pageBtns: { flexDirection: "row", gap: 6, alignItems: "center" },
  pageBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "#fff" },
  pageBtnDisabled: { opacity: 0.5 },
  pageBtnText: { color: "#102a43", fontWeight: "700" },
  rowWrap: { flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" },
  input: { borderWidth: 1, borderColor: "#d9e2ec", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#fff", color: "#102a43", marginTop: 6, minWidth: 160 },
  // scanner styles
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
  scanBtn: { backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#cbd5e1", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, alignSelf: "flex-start" },
  scanBtnText: { color: "#082cac", fontWeight: "800" },
  // Small prompt modal (for Filters)
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
  modalDivider: {
    height: 1,
    backgroundColor: "#edf2f7",
    marginVertical: 8,
  },
});