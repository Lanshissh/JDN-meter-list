// app/(tabs)/billing.tsx - Mobile Optimized Version
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View, useWindowDimensions, Modal,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { Picker } from "@react-native-picker/picker";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";
import RateOfChangePanel from "../../components/billing/RateOfChangePanel";

/* ========================= Types ========================= */
type BillingRow = {
  stall_no: string | null; stall_sn: string | null; tenant_id: string | null;
  tenant_sn: string | null; tenant_name: string | null; meter_no: string | null;
  meter_id: string; mult: number; reading_previous: number; reading_present: number;
  consumed_kwh: number; prev_consumed_kwh: number | null; rate_of_change_pct: number | null;
  utility_rate: number | null; markup_rate: number | null; system_rate: number | null;
  vat_rate: number | null; vat_amount?: number | null; whtax_code: string | null;
  whtax_rate?: number | null; whtax_amount?: number | null; tax_code: string | null;
  for_penalty: boolean; total_amount: number; meter_type: string | null;
  wt_rate?: number | null; wt?: number | null;
  billing?: { wt?: number | null; vat?: number | null; base?: number | null };
  totals?: { wt?: number | null };
};

type BillingTenant = { tenant_id: string | null; tenant_sn: string | null; tenant_name: string | null; rows: BillingRow[] };
type BillingTotals = { total_consumed_kwh: number; total_amount: number };
type BuildingBillingResponse = {
  building_billing_id?: string; building_id: string; building_name: string | null;
  period: { start: string; end: string }; tenants: BillingTenant[]; totals: BillingTotals;
  generated_at: string; penalty_rate_pct: number; saved_header?: any;
};
type StoredBilling = {
  building_billing_id: string; building_id: string; building_name: string | null;
  period: { start: string; end: string }; totals: { total_consumed_kwh: number; total_amount: number };
  penalty_rate_pct: number; generated_at: string | null; payload?: any;
};
type BuildingOption = { building_id: string; building_name: string | null };

/* ========================= Helpers ========================= */
const notify = (title: string, message?: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.alert) {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else { Alert.alert(title, message); }
};

const isYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: any) => v == null || v === "" || isNaN(Number(v)) ? null : Number(v);

const fmt = (v: number | string | null | undefined, d = 2) => {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n)) : String(v);
};

const formatCurrency = (v: number | null | undefined) => {
  if (v == null || isNaN(Number(v))) return "—";
  try { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v)); }
  catch { return `₱${Number(v).toFixed(2)}`; }
};

const php10For = (r: BillingRow): number | null => {
  if (r.consumed_kwh == null || r.utility_rate == null) return null;
  const base = Number(r.consumed_kwh) * Number(r.utility_rate);
  return Number.isFinite(base) ? base : null;
};

const vatFor = (r: BillingRow): number | null => {
  if (r.vat_rate == null) return null;
  const base = php10For(r);
  if (base == null) return null;
  const v = base * Number(r.vat_rate);
  return Number.isFinite(v) ? v : null;
};

const wtaxFor = (r: BillingRow): number => {
  if (r.wt != null && !isNaN(Number(r.wt)) && Number(r.wt) > 0) return Number(r.wt);
  if (r.billing?.wt != null && !isNaN(Number(r.billing.wt)) && Number(r.billing.wt) > 0) return Number(r.billing.wt);
  if (r.totals?.wt != null && !isNaN(Number(r.totals.wt)) && Number(r.totals.wt) > 0) return Number(r.totals.wt);
  const base = php10For(r);
  if (base != null) {
    const vatRate = r.vat_rate || 0;
    const vat = base * vatRate;
    let wtRate = r.wt_rate != null && r.wt_rate > 0 ? r.wt_rate : (r.whtax_rate != null && r.whtax_rate > 0 ? r.whtax_rate : null);
    if (wtRate != null && vat > 0) return vat * wtRate;
  }
  return 0;
};

const forceWtaxCalculation = (r: BillingRow): number => {
  const base = Number(r.consumed_kwh || 0) * Number(r.utility_rate || 0);
  if (base > 0) {
    const vatRate = r.vat_rate || 0.12;
    const vat = base * vatRate;
    const wtRate = r.wt_rate || r.whtax_rate || 0.02;
    return vat * wtRate;
  }
  return 0;
};

const pctFmt = (v: number | null | undefined) => v == null ? "" : `${v.toFixed(0)}%`;

function saveCsv(filename: string, csv: string) {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.URL) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  } else { notify("CSV created", "Use Share/Downloads feature on your device."); }
}

const makeBillingCsv = (payload: BuildingBillingResponse) => {
  const headers = ["STALL NO.","TENANTS / VENDORS","METER NO.","MULT","READING PREVIOUS","READING PRESENT","CONSUMED KwHr","Php/kwh","WTAX","VAT","TOTAL","CONSUMED KwHr (Last Month)","Rate of change","TAX CODE","WHTAX CODE","MEMO","FOR PENALTY"];
  const allRows: BillingRow[] = (payload.tenants || []).flatMap((t) => t.rows || []);
  const lines: string[] = [headers.join(",")];
  for (const r of allRows) {
    const tenantLabel = [r.tenant_sn, r.tenant_name].filter(Boolean).join(" ").trim();
    const php10 = php10For(r); const vat = vatFor(r);
    let wtax = wtaxFor(r); if (wtax === 0) wtax = forceWtaxCalculation(r);
    const row = [r.stall_sn ?? r.stall_no ?? "",tenantLabel,r.meter_no ?? "",r.mult ?? "",r.reading_previous ?? "",r.reading_present ?? "",r.consumed_kwh ?? "",php10 != null ? php10.toFixed(2) : "",wtax.toFixed(2),vat != null ? vat.toFixed(2) : "",r.total_amount ?? "",r.prev_consumed_kwh ?? "",pctFmt(r.rate_of_change_pct),r.tax_code ?? "",r.whtax_code ?? "","",r.for_penalty ? "TRUE" : "FALSE"];
    lines.push(row.map((v) => { const s = String(v ?? ""); return `"${s.replace(/"/g, '""')}"`; }).join(","));
  }
  const filename = `billing_${payload.building_id}_${payload.period.start}_${payload.period.end}.csv`;
  return { filename, csv: lines.join("\n") };
};

/* ========================= Calendar Date Picker ========================= */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function CalendarDatePicker({ label, value, onChangeText, placeholder, icon = 'calendar', isMobile = false }: { label: string; value: string; onChangeText: (date: string) => void; placeholder?: string; icon?: keyof typeof Ionicons.glyphMap; isMobile?: boolean }) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [viewDate, setViewDate] = useState(() => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00') : new Date());
  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return placeholder || 'Select date';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear(), month = date.getMonth();
    const firstDay = new Date(year, month, 1), lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate(), startingDayOfWeek = firstDay.getDay();
    const days: Array<{ date: number | null; isCurrentMonth: boolean; fullDate: Date | null }> = [];
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) days.push({ date: prevMonthLastDay - i, isCurrentMonth: false, fullDate: new Date(year, month - 1, prevMonthLastDay - i) });
    for (let i = 1; i <= daysInMonth; i++) days.push({ date: i, isCurrentMonth: true, fullDate: new Date(year, month, i) });
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) days.push({ date: i, isCurrentMonth: false, fullDate: new Date(year, month + 1, i) });
    return days;
  };
  const handleDateSelect = (date: Date) => {
    const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, '0'), day = String(date.getDate()).padStart(2, '0');
    onChangeText(`${year}-${month}-${day}`); setShowCalendar(false);
  };
  const isSelectedDate = (date: Date | null) => { if (!date || !value) return false; const s = new Date(value + 'T12:00:00'); return date.getDate() === s.getDate() && date.getMonth() === s.getMonth() && date.getFullYear() === s.getFullYear(); };
  const isToday = (date: Date | null) => { if (!date) return false; const t = new Date(); return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear(); };
  const days = getDaysInMonth(viewDate);

  return (
    <View style={calendarStyles.container}>
      <Text style={calendarStyles.label}>{label}</Text>
      <TouchableOpacity style={calendarStyles.inputContainer} onPress={() => setShowCalendar(true)}>
        <Ionicons name={icon} size={16} color="#64748B" style={calendarStyles.icon} />
        <Text style={[calendarStyles.inputText, !value && calendarStyles.placeholder]}>{formatDisplayDate(value)}</Text>
        <Ionicons name="chevron-down" size={16} color="#64748B" />
      </TouchableOpacity>
      <Modal visible={showCalendar} transparent animationType="fade" onRequestClose={() => setShowCalendar(false)}>
        <TouchableOpacity style={calendarStyles.modalOverlay} activeOpacity={1} onPress={() => setShowCalendar(false)}>
          <TouchableOpacity style={[calendarStyles.calendarContainer, isMobile && { width: '95%', maxWidth: 340 }]} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={calendarStyles.calendarHeader}>
              <Text style={calendarStyles.monthYear}>{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</Text>
              <View style={calendarStyles.headerButtons}>
                <TouchableOpacity style={calendarStyles.navButton} onPress={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}><Ionicons name="chevron-back" size={20} color="#374151" /></TouchableOpacity>
                <TouchableOpacity style={calendarStyles.navButton} onPress={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}><Ionicons name="chevron-forward" size={20} color="#374151" /></TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={calendarStyles.todayButton} onPress={() => { const t = new Date(); setViewDate(t); handleDateSelect(t); }}><Ionicons name="today" size={14} color="#2563EB" /><Text style={calendarStyles.todayText}>Today</Text></TouchableOpacity>
            <View style={calendarStyles.dayHeaders}>{DAYS.map((day) => <Text key={day} style={[calendarStyles.dayHeader, isMobile && { width: 36 }]}>{day}</Text>)}</View>
            <View style={calendarStyles.calendarGrid}>
              {days.map((day, index) => (
                <TouchableOpacity key={index} style={[calendarStyles.dayCell, isMobile && { width: 36, height: 36 }, !day.isCurrentMonth && calendarStyles.dayCellInactive, isSelectedDate(day.fullDate) && calendarStyles.dayCellSelected, isToday(day.fullDate) && !isSelectedDate(day.fullDate) && calendarStyles.dayCellToday]} onPress={() => day.fullDate && handleDateSelect(day.fullDate)} disabled={!day.fullDate}>
                  <Text style={[calendarStyles.dayText, !day.isCurrentMonth && calendarStyles.dayTextInactive, isSelectedDate(day.fullDate) && calendarStyles.dayTextSelected, isToday(day.fullDate) && !isSelectedDate(day.fullDate) && calendarStyles.dayTextToday]}>{day.date}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={calendarStyles.calendarFooter}><TouchableOpacity style={calendarStyles.cancelButton} onPress={() => setShowCalendar(false)}><Text style={calendarStyles.cancelButtonText}>Cancel</Text></TouchableOpacity></View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const calendarStyles = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 12, fontWeight: "600", color: "#64748B", marginBottom: 6 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 12, paddingVertical: 12 },
  icon: { marginRight: 8 },
  inputText: { flex: 1, fontSize: 14, color: '#0F172A' },
  placeholder: { color: '#94A3B8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center' },
  calendarContainer: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, width: 340, maxWidth: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  monthYear: { fontSize: 18, fontWeight: '600', color: '#0F172A' },
  headerButtons: { flexDirection: 'row', gap: 4 },
  navButton: { padding: 8, borderRadius: 6, backgroundColor: '#F8FAFC' },
  todayButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: '#EFF6FF', marginBottom: 16, gap: 6 },
  todayText: { fontSize: 13, fontWeight: '500', color: '#2563EB' },
  dayHeaders: { flexDirection: 'row', marginBottom: 8 },
  dayHeader: { width: 40, textAlign: 'center', fontSize: 12, fontWeight: '600', color: '#64748B' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  dayCellInactive: { opacity: 0.4 },
  dayCellSelected: { backgroundColor: '#2563EB' },
  dayCellToday: { borderWidth: 1, borderColor: '#2563EB' },
  dayText: { fontSize: 14, color: '#374151' },
  dayTextInactive: { color: '#94A3B8' },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '600' },
  dayTextToday: { color: '#2563EB', fontWeight: '600' },
  calendarFooter: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F1F5F9', alignItems: 'flex-end' },
  cancelButton: { paddingVertical: 8, paddingHorizontal: 16 },
  cancelButtonText: { fontSize: 14, fontWeight: '500', color: '#64748B' },
});

/* ========================= Mobile Row Card Component ========================= */
function MobileRowCard({ row, index }: { row: BillingRow; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity style={[mobileStyles.rowCard, index % 2 === 0 && mobileStyles.rowCardEven]} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
      <View style={mobileStyles.rowCardHeader}>
        <View style={mobileStyles.rowCardMain}>
          <Text style={mobileStyles.rowCardStall}>{row.stall_sn || row.stall_no || "—"}</Text>
          <Text style={mobileStyles.rowCardMeter}>{row.meter_no || row.meter_id}</Text>
        </View>
        <View style={mobileStyles.rowCardRight}>
          <Text style={mobileStyles.rowCardAmount}>{formatCurrency(row.total_amount)}</Text>
          <View style={mobileStyles.rowCardKwh}><Text style={mobileStyles.rowCardKwhText}>{fmt(row.consumed_kwh, 0)} kWh</Text></View>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#94A3B8" />
      </View>
      {expanded && (
        <View style={mobileStyles.rowCardDetails}>
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Meter Type</Text><View style={mobileStyles.meterBadge}><Text style={mobileStyles.meterBadgeText}>{(row.meter_type || "").toUpperCase()}</Text></View></View>
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Multiplier</Text><Text style={mobileStyles.detailValue}>×{fmt(row.mult, 0)}</Text></View>
          <View style={mobileStyles.divider} />
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Previous Reading</Text><Text style={mobileStyles.detailValue}>{fmt(row.reading_previous, 0)}</Text></View>
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Current Reading</Text><Text style={mobileStyles.detailValue}>{fmt(row.reading_present, 0)}</Text></View>
          <View style={mobileStyles.divider} />
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Previous Consumption</Text><Text style={mobileStyles.detailValue}>{row.prev_consumed_kwh ? `${fmt(row.prev_consumed_kwh, 0)} kWh` : "—"}</Text></View>
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Rate of Change</Text><Text style={[mobileStyles.detailValue, row.rate_of_change_pct && row.rate_of_change_pct > 0 ? mobileStyles.rocPositive : mobileStyles.rocNegative]}>{row.rate_of_change_pct == null ? "—" : `${fmt(row.rate_of_change_pct, 0)}%`}</Text></View>
          <View style={mobileStyles.divider} />
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>System Rate</Text><Text style={mobileStyles.detailValue}>{row.system_rate == null ? "—" : fmt(row.system_rate, 4)}</Text></View>
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>VAT Rate</Text><Text style={mobileStyles.detailValue}>{row.vat_rate == null ? "—" : `${fmt((row.vat_rate as number) * 100, 1)}%`}</Text></View>
          {row.whtax_code && <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>WHT Code</Text><Text style={mobileStyles.detailValue}>{row.whtax_code}</Text></View>}
          <View style={mobileStyles.detailRow}><Text style={mobileStyles.detailLabel}>Penalty</Text><View style={[mobileStyles.penaltyBadge, row.for_penalty ? mobileStyles.penaltyYes : mobileStyles.penaltyNo]}><Text style={[mobileStyles.penaltyText, row.for_penalty ? mobileStyles.penaltyTextYes : mobileStyles.penaltyTextNo]}>{row.for_penalty ? "YES" : "NO"}</Text></View></View>
        </View>
      )}
    </TouchableOpacity>
  );
}

/* ========================= Component ========================= */
export default function BillingScreen() {
  const { token, user } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const isSmallMobile = width < 400;

  const roles: string[] = Array.isArray(user?.user_roles) ? user!.user_roles : [];
  const isAdmin = roles.includes("admin");
  const isBiller = roles.includes("biller");
  const noAccess = !isAdmin && !isBiller;

  const headerToken = token && /^Bearer\s/i.test(token.trim()) ? token.trim() : token ? `Bearer ${token.trim()}` : "";
  const api = useMemo(() => axios.create({ baseURL: BASE_API, timeout: 20000, headers: headerToken ? { Authorization: headerToken } : {} }), [headerToken]);

  const [buildingId, setBuildingId] = useState("");
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [startDate, setStartDate] = useState<string>(() => { const d = new Date(); const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1; return `${y}-${String(m + 1).padStart(2, "0")}-21`; });
  const [endDate, setEndDate] = useState<string>(() => today());
  const [penaltyRate, setPenaltyRate] = useState<string>("0");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [payload, setPayload] = useState<BuildingBillingResponse | null>(null);
  const [storedBillings, setStoredBillings] = useState<Record<string, StoredBilling>>({});
  const [error, setError] = useState<string>("");
  const [viewTab, setViewTab] = useState<"billing" | "roc">("billing");
  const [modeTab, setModeTab] = useState<"generate" | "stored">("generate");

  const canRun = !!buildingId && isYMD(startDate) && isYMD(endDate) && !!token && !busy;

  useEffect(() => {
    const loadBuildings = async () => {
      if (!token) return;
      try { const res = await api.get<BuildingOption[]>("/buildings"); setBuildings(Array.isArray(res.data) ? res.data : []); }
      catch (e) { console.error("Fetch buildings for billing failed:", e); }
    };
    loadBuildings();
  }, [api, token]);

  const fetchStoredBillings = async () => {
    if (!token) return; setBusy(true); setError("");
    try { const res = await api.get<Record<string, StoredBilling>>("/billings/buildings"); setStoredBillings(res.data || {}); }
    catch (e: any) { const msg = e?.response?.data?.error ?? e?.message ?? "Unable to fetch stored billings."; setError(msg); notify("Fetch failed", msg); }
    finally { setBusy(false); }
  };

  const fetchStoredBilling = async (buildingBillingId: string) => {
    if (!token) return; setBusy(true); setError("");
    try { const res = await api.get<BuildingBillingResponse>(`/billings/${buildingBillingId}`); setPayload(res.data); setModeTab("generate"); }
    catch (e: any) { const msg = e?.response?.data?.error ?? e?.message ?? "Unable to fetch billing."; setError(msg); notify("Fetch failed", msg); }
    finally { setBusy(false); }
  };

  const onCreateBilling = async () => {
    if (!token) return notify("Not logged in", "Please sign in first.");
    if (!buildingId.trim()) return notify("Missing building", "Select a building.");
    if (!isYMD(startDate) || !isYMD(endDate)) return notify("Invalid dates", "Use YYYY-MM-DD.");
    const penaltyNum = num(penaltyRate);
    if (penaltyNum == null || penaltyNum < 0) return notify("Invalid penalty", "Enter a valid percentage.");
    setCreating(true); setError("");
    try {
      const res = await api.post<BuildingBillingResponse>(`/billings/buildings/${encodeURIComponent(buildingId.trim())}/period-start/${encodeURIComponent(startDate)}/period-end/${encodeURIComponent(endDate)}`, {}, { params: { penalty_rate: penaltyNum } });
      setPayload(res.data); fetchStoredBillings(); notify("Success", "Billing created and saved successfully.");
    } catch (e: any) { const msg = e?.response?.data?.error ?? e?.message ?? "Unable to create building billing."; setError(msg); notify("Request failed", msg); }
    finally { setCreating(false); }
  };

  const onExportCurrentCsv = () => { if (!payload) return; const { filename, csv } = makeBillingCsv(payload); saveCsv(filename, csv); };

  const onDownloadStoredCsv = async (billing: StoredBilling) => {
    if (!token) return;
    if (!billing.payload) { await fetchStoredBilling(billing.building_billing_id); if (!payload) return; const { filename, csv } = makeBillingCsv(payload); saveCsv(filename, csv); return; }
    try { setBusy(true); const { filename, csv } = makeBillingCsv(billing.payload); saveCsv(filename, csv); }
    catch (e: any) { notify("Download failed", e?.message ?? "Unable to download billing report."); }
    finally { setBusy(false); }
  };

  if (noAccess) {
    return (
      <View style={styles.noAccessContainer}>
        <Ionicons name="lock-closed-outline" size={40} color="#94A3B8" />
        <Text style={styles.noAccessTitle}>Access denied</Text>
        <Text style={styles.noAccessText}>You do not have permission to access the Billing module.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, isMobile && mobileStyles.header]}>
        <Text style={[styles.title, isMobile && mobileStyles.title]}>Billing & Statements</Text>
        <Text style={[styles.subtitle, isMobile && mobileStyles.subtitle]}>{isMobile ? "Generate billing and export CSV" : "Generate per-building billing, export CSV, and manage stored billings."}</Text>
      </View>

      {/* Tabs */}
      <View style={[styles.tabContainer, isMobile && mobileStyles.tabContainer]}>
        <TouchableOpacity style={[styles.tab, viewTab === "billing" && styles.tabActive, isMobile && mobileStyles.tab]} onPress={() => setViewTab("billing")}>
          <Ionicons name="document-text-outline" size={isMobile ? 18 : 16} color={viewTab === "billing" ? "#2563EB" : "#64748B"} />
          <Text style={[styles.tabText, viewTab === "billing" && styles.tabTextActive, isMobile && mobileStyles.tabText]}>Billing</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, viewTab === "roc" && styles.tabActive, isMobile && mobileStyles.tab]} onPress={() => setViewTab("roc")}>
          <Ionicons name="trending-up-outline" size={isMobile ? 18 : 16} color={viewTab === "roc" ? "#2563EB" : "#64748B"} />
          <Text style={[styles.tabText, viewTab === "roc" && styles.tabTextActive, isMobile && mobileStyles.tabText]}>ROC</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.content, isMobile && mobileStyles.content]}>
        {viewTab === "billing" ? (
          <View>
            {/* Mode Toggle */}
            <View style={[styles.modeToggle, isMobile && mobileStyles.modeToggle]}>
              <TouchableOpacity style={[styles.modeTab, modeTab === "generate" && styles.modeTabActive]} onPress={() => setModeTab("generate")}>
                <Text style={[styles.modeTabText, modeTab === "generate" && styles.modeTabTextActive]}>{isMobile ? "Generate" : "Generate Billing"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modeTab, modeTab === "stored" && styles.modeTabActive]} onPress={() => { setModeTab("stored"); fetchStoredBillings(); }}>
                <Text style={[styles.modeTabText, modeTab === "stored" && styles.modeTabTextActive]}>{isMobile ? "Stored" : "Stored Billings"}</Text>
              </TouchableOpacity>
            </View>

            {modeTab === "generate" ? (
              <>
                {/* Input Card */}
                <View style={[styles.inputCard, isMobile && mobileStyles.inputCard]}>
                  <View style={styles.cardHeader}>
                    <Ionicons name="calculator" size={20} color="#2563EB" />
                    <Text style={styles.cardTitle}>{isMobile ? "Parameters" : "Billing Parameters"}</Text>
                  </View>

                  {isMobile ? (
                    /* Mobile Layout - Clean Stacked Form */
                    <View style={mobileStyles.formContainer}>
                      {/* Building Select */}
                      <View style={mobileStyles.formGroup}>
                        <Text style={mobileStyles.formLabel}>Building *</Text>
                        <View style={mobileStyles.formInputWrapper}>
                          <Ionicons name="business" size={18} color="#64748B" style={mobileStyles.formIcon} />
                          {buildings.length > 0 ? (
                            <Picker 
                              selectedValue={buildingId} 
                              onValueChange={(v) => setBuildingId(String(v))} 
                              style={mobileStyles.formPicker}
                              mode={Platform.OS === "android" ? "dropdown" : undefined}
                            >
                              <Picker.Item label="Select building…" value="" />
                              {buildings.map((b) => (
                                <Picker.Item 
                                  key={b.building_id} 
                                  label={b.building_name ? `${b.building_name}` : b.building_id} 
                                  value={b.building_id} 
                                />
                              ))}
                            </Picker>
                          ) : (
                            <TextInput 
                              value={buildingId} 
                              onChangeText={setBuildingId} 
                              placeholder="Enter building ID" 
                              style={mobileStyles.formTextInput} 
                              autoCapitalize="characters" 
                              autoCorrect={false} 
                            />
                          )}
                        </View>
                      </View>

                      {/* Date Range Row */}
                      <View style={mobileStyles.dateRow}>
                        <View style={mobileStyles.dateField}>
                          <CalendarDatePicker 
                            label="Start Date *" 
                            value={startDate} 
                            onChangeText={setStartDate} 
                            placeholder="Select start" 
                            icon="calendar" 
                            isMobile={isMobile} 
                          />
                        </View>
                        <View style={mobileStyles.dateField}>
                          <CalendarDatePicker 
                            label="End Date *" 
                            value={endDate} 
                            onChangeText={setEndDate} 
                            placeholder="Select end" 
                            icon="calendar" 
                            isMobile={isMobile} 
                          />
                        </View>
                      </View>

                      {/* Penalty Rate */}
                      <View style={mobileStyles.formGroup}>
                        <Text style={mobileStyles.formLabel}>Penalty Rate (%) *</Text>
                        <View style={mobileStyles.formInputWrapper}>
                          <Ionicons name="alert-circle" size={18} color="#64748B" style={mobileStyles.formIcon} />
                          <TextInput 
                            value={penaltyRate} 
                            onChangeText={setPenaltyRate} 
                            placeholder="0" 
                            style={mobileStyles.formTextInput} 
                            keyboardType="numeric" 
                          />
                          <Text style={mobileStyles.formSuffix}>%</Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    /* Desktop Layout */
                    <View style={styles.inputGrid}>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Building *</Text>
                        <View style={styles.inputWrapper}>
                          <Ionicons name="business" size={16} color="#64748B" style={styles.inputIcon} />
                          {buildings.length > 0 ? (
                            <Picker selectedValue={buildingId} onValueChange={(v) => setBuildingId(String(v))} style={styles.picker} mode={Platform.OS === "android" ? "dropdown" : undefined}>
                              <Picker.Item label="Select building…" value="" />
                              {buildings.map((b) => <Picker.Item key={b.building_id} label={b.building_name ? `${b.building_name} (${b.building_id})` : b.building_id} value={b.building_id} />)}
                            </Picker>
                          ) : <TextInput value={buildingId} onChangeText={setBuildingId} placeholder="BLDG-001" style={styles.textInput} autoCapitalize="characters" autoCorrect={false} />}
                        </View>
                      </View>
                      <View style={styles.inputGroup}>
                        <CalendarDatePicker label="Start Date *" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" icon="calendar" isMobile={false} />
                      </View>
                      <View style={styles.inputGroup}>
                        <CalendarDatePicker label="End Date *" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" icon="calendar" isMobile={false} />
                      </View>
                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Penalty Rate (%) *</Text>
                        <View style={styles.inputWrapper}>
                          <Ionicons name="alert-circle" size={16} color="#64748B" style={styles.inputIcon} />
                          <TextInput value={penaltyRate} onChangeText={setPenaltyRate} placeholder="0" style={styles.textInput} keyboardType="numeric" />
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Action Buttons */}
                  {isMobile ? (
                    <View style={mobileStyles.actionRow}>
                      <TouchableOpacity 
                        style={[styles.primaryButton, mobileStyles.primaryButton, !canRun && styles.buttonDisabled]} 
                        onPress={onCreateBilling} 
                        disabled={!canRun || creating}
                      >
                        {creating ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="save" size={18} color="#FFFFFF" />}
                        <Text style={styles.primaryButtonText}>{creating ? "Creating..." : "Create Billing"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.secondaryButton, mobileStyles.secondaryButton, !payload && styles.buttonDisabled]} 
                        onPress={onExportCurrentCsv} 
                        disabled={!payload}
                      >
                        <Ionicons name="download" size={18} color="#2563EB" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <TouchableOpacity style={[styles.primaryButton, !canRun && styles.buttonDisabled]} onPress={onCreateBilling} disabled={!canRun || creating}>
                        {creating ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="save" size={16} color="#FFFFFF" />}
                        <Text style={styles.primaryButtonText}>{creating ? "Creating..." : "Create & Save Billing"}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.secondaryButton, !payload && styles.buttonDisabled]} onPress={onExportCurrentCsv} disabled={!payload}>
                        <Ionicons name="download" size={16} color="#2563EB" />
                        <Text style={styles.secondaryButtonText}>Export CSV</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {error ? <View style={styles.errorCard}><Ionicons name="warning" size={20} color="#DC2626" /><View style={styles.errorContent}><Text style={styles.errorTitle}>Request Failed</Text><Text style={styles.errorText}>{error}</Text></View></View> : null}
                </View>

                {/* Billing Summary */}
                {payload ? (
                  <View style={[styles.billingCard, isMobile && mobileStyles.billingCard]}>
                    <View style={styles.cardHeader}>
                      <Ionicons name="business" size={20} color="#2563EB" />
                      <Text style={styles.cardTitle}>Summary</Text>
                      {payload.building_billing_id && !isMobile && <Text style={styles.billingId}>ID: {payload.building_billing_id}</Text>}
                    </View>
                    <View style={[styles.summaryGrid, isMobile && mobileStyles.summaryGrid]}>
                      <View style={[styles.summaryItem, isMobile && mobileStyles.summaryItem]}><Text style={styles.summaryLabel}>Building</Text><Text style={[styles.summaryValue, isMobile && { fontSize: 13 }]}>{payload.building_id}{payload.building_name ? ` • ${payload.building_name}` : ""}</Text></View>
                      <View style={[styles.summaryItem, isMobile && mobileStyles.summaryItem]}><Text style={styles.summaryLabel}>Period</Text><Text style={[styles.summaryValue, isMobile && { fontSize: 13 }]}>{payload.period.start} → {payload.period.end}</Text></View>
                      <View style={[styles.summaryItem, isMobile && mobileStyles.summaryItem]}><Text style={styles.summaryLabel}>Consumption</Text><Text style={[styles.summaryValue, isMobile && { fontSize: 13 }]}>{fmt(payload.totals.total_consumed_kwh, 4)} kWh</Text></View>
                      <View style={[styles.summaryItem, isMobile && mobileStyles.summaryItem]}><Text style={styles.summaryLabel}>Total Amount</Text><Text style={[styles.summaryValue, styles.amountValue, isMobile && { fontSize: 15 }]}>{formatCurrency(payload.totals.total_amount)}</Text></View>
                    </View>
                    <Text style={styles.generatedAt}>Generated at {new Date(payload.generated_at).toLocaleString()}</Text>
                  </View>
                ) : (
                  <View style={[styles.placeholderCard, isMobile && mobileStyles.placeholderCard]}>
                    <Ionicons name="document-text" size={isMobile ? 40 : 48} color="#CBD5E1" />
                    <Text style={styles.placeholderTitle}>No Billing Data</Text>
                    <Text style={styles.placeholderText}>{isMobile ? "Create billing to see results" : "Enter building details and create billing to see results"}</Text>
                  </View>
                )}

                {/* Tenant Details */}
                {payload && (
                  <View style={{ marginTop: 16, gap: 16 }}>
                    {payload.tenants.map((tenant, tenantIndex) => (
                      <View key={tenant.tenant_id || `tenant-${tenantIndex}`} style={[styles.tenantCard, isMobile && mobileStyles.tenantCard]}>
                        <View style={styles.tenantHeader}>
                          <Ionicons name="person" size={18} color="#374151" />
                          <View style={styles.tenantInfo}>
                            <Text style={[styles.tenantName, isMobile && { fontSize: 14 }]}>{tenant.tenant_name || tenant.tenant_id || "Unassigned Tenant"}</Text>
                            {tenant.tenant_sn && <Text style={styles.tenantId}>{tenant.tenant_sn}</Text>}
                          </View>
                        </View>

                        {/* Mobile: Card-based layout */}
                        {isMobile ? (
                          <View style={mobileStyles.rowCardContainer}>
                            {tenant.rows.map((row, rowIndex) => <MobileRowCard key={`${row.meter_id}-${rowIndex}`} row={row} index={rowIndex} />)}
                          </View>
                        ) : (
                          /* Desktop: Table layout */
                          <View style={styles.compactTable}>
                            <View style={styles.compactTableHeader}>
                              <View style={[styles.compactCell, styles.compactCellHeader, { flex: 2 }]}><Text style={styles.compactHeaderText}>Stall/Meter</Text></View>
                              <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1.5 }]}><Text style={styles.compactHeaderText}>Readings</Text></View>
                              <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1 }]}><Text style={styles.compactHeaderText}>Consumption</Text></View>
                              <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1 }]}><Text style={styles.compactHeaderText}>ROC</Text></View>
                              <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1.5 }]}><Text style={styles.compactHeaderText}>Rates & Taxes</Text></View>
                              <View style={[styles.compactCell, styles.compactCellHeader, { flex: 1 }]}><Text style={styles.compactHeaderText}>Amount</Text></View>
                            </View>
                            {tenant.rows.map((row, rowIndex) => (
                              <View key={`${row.meter_id}-${rowIndex}`} style={[styles.compactTableRow, rowIndex % 2 === 0 && styles.compactTableRowEven]}>
                                <View style={[styles.compactCell, { flex: 2 }]}>
                                  <Text style={styles.compactCellPrimary}>{row.stall_sn || row.stall_no || "—"}</Text>
                                  <Text style={styles.compactCellSecondary}>{row.meter_no || row.meter_id}</Text>
                                  <View style={styles.meterTypeBadge}><Text style={styles.meterTypeText}>{(row.meter_type || "").toUpperCase()}</Text><Text style={styles.multiplierText}>×{fmt(row.mult, 0)}</Text></View>
                                </View>
                                <View style={[styles.compactCell, { flex: 1.5 }]}>
                                  <View style={styles.readingPair}><Text style={styles.readingLabel}>Prev:</Text><Text style={styles.readingValue}>{fmt(row.reading_previous, 0)}</Text></View>
                                  <View style={styles.readingPair}><Text style={styles.readingLabel}>Curr:</Text><Text style={styles.readingValue}>{fmt(row.reading_present, 0)}</Text></View>
                                </View>
                                <View style={[styles.compactCell, { flex: 1 }]}><Text style={styles.consumptionValue}>{fmt(row.consumed_kwh, 0)} kWh</Text>{row.prev_consumed_kwh && <Text style={styles.previousConsumption}>Prev: {fmt(row.prev_consumed_kwh, 0)}</Text>}</View>
                                <View style={[styles.compactCell, { flex: 1 }]}><Text style={[styles.rocValue, row.rate_of_change_pct && row.rate_of_change_pct > 0 ? styles.rocPositive : styles.rocNegative]}>{row.rate_of_change_pct == null ? "—" : `${fmt(row.rate_of_change_pct, 0)}%`}</Text></View>
                                <View style={[styles.compactCell, { flex: 1.5 }]}><View style={styles.ratesContainer}><Text style={styles.rateText}>System: {row.system_rate == null ? "—" : fmt(row.system_rate, 4)}</Text><Text style={styles.rateText}>VAT: {row.vat_rate == null ? "—" : `${fmt((row.vat_rate as number) * 100, 1)}%`}</Text>{row.whtax_code && <Text style={styles.rateText}>WHT: {row.whtax_code}</Text>}<Text style={[styles.penaltyBadge, row.for_penalty ? styles.penaltyYes : styles.penaltyNo]}>{row.for_penalty ? "PENALTY" : "NO PENALTY"}</Text></View></View>
                                <View style={[styles.compactCell, { flex: 1 }]}><Text style={styles.amountText}>{formatCurrency(row.total_amount)}</Text></View>
                              </View>
                            ))}
                          </View>
                        )}

                        <View style={[styles.tenantTotal, isMobile && mobileStyles.tenantTotal]}>
                          <Text style={styles.tenantTotalLabel}>Tenant Total:</Text>
                          <Text style={[styles.tenantTotalAmount, isMobile && { fontSize: 15 }]}>{formatCurrency(tenant.rows.reduce((sum, row) => sum + row.total_amount, 0))}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              /* Stored Billings */
              <View style={[styles.storedBillingsCard, isMobile && mobileStyles.storedBillingsCard]}>
                <View style={styles.cardHeader}>
                  <Ionicons name="archive" size={20} color="#2563EB" />
                  <Text style={styles.cardTitle}>Stored Billings</Text>
                  <TouchableOpacity onPress={fetchStoredBillings} style={styles.refreshButton}><Ionicons name="refresh" size={16} color="#64748B" /></TouchableOpacity>
                </View>
                {busy ? <ActivityIndicator size="large" color="#2563EB" style={styles.loader} /> : Object.keys(storedBillings).length === 0 ? (
                  <View style={styles.placeholderCard}><Ionicons name="archive-outline" size={48} color="#CBD5E1" /><Text style={styles.placeholderTitle}>No Stored Billings</Text><Text style={styles.placeholderText}>Generate new billings to see them stored here</Text></View>
                ) : (
                  <View style={styles.billingList}>
                    {Object.values(storedBillings).map((billing) => (
                      <TouchableOpacity key={billing.building_billing_id} style={[styles.billingItem, isMobile && mobileStyles.billingItem]} onPress={() => fetchStoredBilling(billing.building_billing_id)}>
                        <View style={styles.billingInfo}>
                          <Text style={[styles.billingTitle, isMobile && { fontSize: 13 }]}>{billing.building_id}{billing.building_name ? ` • ${billing.building_name}` : ""}</Text>
                          <Text style={styles.billingPeriod}>{billing.period.start} → {billing.period.end}</Text>
                          <Text style={styles.billingTotals}>{fmt(billing.totals.total_consumed_kwh, 4)} kWh • {formatCurrency(billing.totals.total_amount)}</Text>
                        </View>
                        <TouchableOpacity style={styles.downloadButton} onPress={() => onDownloadStoredCsv(billing)}><Ionicons name="download-outline" size={16} color="#2563EB" /><Text style={styles.downloadButtonText}>CSV</Text></TouchableOpacity>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        ) : <View style={styles.rocSection}><RateOfChangePanel /></View>}
      </View>
    </ScrollView>
  );
}

/* ========================= Desktop Styles ========================= */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  noAccessContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#EFF6FF", gap: 12 },
  noAccessTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  noAccessText: { fontSize: 14, color: "#6B7280", textAlign: "center", maxWidth: 320 },
  header: { backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingHorizontal: 24, paddingVertical: 20 },
  title: { fontSize: 28, fontWeight: "700", color: "#0F172A", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#64748B", lineHeight: 24 },
  tabContainer: { flexDirection: "row", backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", paddingHorizontal: 24 },
  tab: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 2, borderBottomColor: "transparent", gap: 8 },
  tabActive: { borderBottomColor: "#2563EB" },
  tabText: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  tabTextActive: { color: "#2563EB" },
  content: { padding: 24, maxWidth: 1200, width: "100%", alignSelf: "center" },
  rocSection: { padding: 24 },
  modeToggle: { flexDirection: "row", backgroundColor: "#FFFFFF", borderRadius: 12, padding: 4, marginBottom: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  modeTab: { flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, alignItems: "center" },
  modeTabActive: { backgroundColor: "#2563EB" },
  modeTabText: { fontSize: 14, fontWeight: "600", color: "#64748B" },
  modeTabTextActive: { color: "#FFFFFF" },
  inputCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 24, marginBottom: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 4 },
  billingCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 24, marginBottom: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 4 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 12 },
  cardTitle: { fontSize: 18, fontWeight: "600", color: "#0F172A" },
  billingId: { marginLeft: "auto", fontSize: 12, color: "#64748B" },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 12 },
  summaryItem: { flexBasis: "48%", flexGrow: 1 },
  summaryLabel: { fontSize: 12, fontWeight: "600", color: "#64748B", marginBottom: 4 },
  summaryValue: { fontSize: 14, fontWeight: "600", color: "#0F172A" },
  amountValue: { color: "#16A34A" },
  generatedAt: { fontSize: 12, color: "#94A3B8" },
  inputGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginBottom: 16 },
  inputGroup: { flexBasis: "48%", flexGrow: 1 },
  inputLabel: { fontSize: 12, fontWeight: "600", color: "#64748B", marginBottom: 6 },
  inputWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", borderRadius: 12, borderWidth: 1, borderColor: "#E2E8F0", paddingHorizontal: 12, paddingVertical: 10 },
  inputIcon: { marginRight: 8 },
  textInput: { flex: 1, fontSize: 14, paddingVertical: 10, color: "#0F172A" },
  picker: { flex: 1, height: 40, color: "#0F172A" },
  actionRow: { flexDirection: "row", justifyContent: "flex-start", gap: 12, marginTop: 8 },
  primaryButton: { flexDirection: "row", alignItems: "center", backgroundColor: "#2563EB", paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, gap: 8 },
  primaryButtonText: { fontSize: 14, fontWeight: "600", color: "#FFFFFF" },
  secondaryButton: { flexDirection: "row", alignItems: "center", backgroundColor: "#EFF6FF", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, gap: 6 },
  secondaryButtonText: { fontSize: 14, fontWeight: "600", color: "#2563EB" },
  buttonDisabled: { opacity: 0.5 },
  errorCard: { marginTop: 16, flexDirection: "row", alignItems: "flex-start", gap: 10, backgroundColor: "#FEF2F2", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FECACA" },
  errorContent: { flex: 1 },
  errorTitle: { fontSize: 14, fontWeight: "600", color: "#B91C1C", marginBottom: 2 },
  errorText: { fontSize: 13, color: "#B91C1C" },
  storedBillingsCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 24, marginBottom: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 4 },
  refreshButton: { marginLeft: "auto", padding: 6, borderRadius: 999, backgroundColor: "#F8FAFC" },
  loader: { marginTop: 24 },
  placeholderCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 48, alignItems: "center", justifyContent: "center", marginTop: 16 },
  placeholderTitle: { fontSize: 18, fontWeight: "600", color: "#0F172A", marginTop: 12, marginBottom: 4 },
  placeholderText: { fontSize: 14, color: "#64748B", textAlign: "center" },
  billingList: { marginTop: 12, gap: 8 },
  billingItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#F9FAFB" },
  billingInfo: { flex: 1 },
  billingTitle: { fontSize: 14, fontWeight: "600", color: "#0F172A" },
  billingPeriod: { fontSize: 12, color: "#64748B" },
  billingTotals: { fontSize: 12, color: "#0F172A", marginTop: 2 },
  downloadButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: "#DBEAFE", backgroundColor: "#EFF6FF" },
  downloadButtonText: { fontSize: 12, fontWeight: "600", color: "#2563EB" },
  tenantCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  tenantHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  tenantInfo: { flexDirection: "column" },
  tenantName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  tenantId: { fontSize: 12, color: "#6B7280" },
  compactTable: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, overflow: "hidden" },
  compactTableHeader: { flexDirection: "row", backgroundColor: "#F3F4F6" },
  compactHeaderText: { fontSize: 11, fontWeight: "600", color: "#4B5563" },
  compactTableRow: { flexDirection: "row", backgroundColor: "#FFFFFF" },
  compactTableRowEven: { backgroundColor: "#F9FAFB" },
  compactCell: { paddingHorizontal: 12, paddingVertical: 8, borderRightWidth: 1, borderRightColor: "#E5E7EB" },
  compactCellHeader: { paddingVertical: 10 },
  compactCellPrimary: { fontSize: 13, fontWeight: "600", color: "#111827" },
  compactCellSecondary: { fontSize: 11, color: "#6B7280" },
  meterTypeBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  meterTypeText: { fontSize: 10, fontWeight: "600", color: "#FFFFFF", backgroundColor: "#4F46E5", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  multiplierText: { fontSize: 11, color: "#64748B" },
  readingPair: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  readingLabel: { fontSize: 11, color: "#6B7280" },
  readingValue: { fontSize: 13, fontWeight: "600", color: "#111827" },
  consumptionValue: { fontSize: 13, fontWeight: "600", color: "#111827" },
  previousConsumption: { fontSize: 11, color: "#6B7280" },
  rocValue: { fontSize: 13, fontWeight: "700" },
  rocPositive: { color: "#16A34A" },
  rocNegative: { color: "#DC2626" },
  ratesContainer: { gap: 2 },
  rateText: { fontSize: 11, color: "#4B5563" },
  penaltyBadge: { marginTop: 4, alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 10, fontWeight: "700", overflow: "hidden" },
  penaltyYes: { backgroundColor: "#FEE2E2", color: "#DC2626" },
  penaltyNo: { backgroundColor: "#DCFCE7", color: "#16A34A" },
  amountText: { fontSize: 13, fontWeight: "700", color: "#111827" },
  tenantTotal: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  tenantTotalLabel: { fontSize: 13, fontWeight: "600", color: "#4B5563" },
  tenantTotalAmount: { fontSize: 13, fontWeight: "700", color: "#111827" },
});

/* ========================= Mobile Styles ========================= */
const mobileStyles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 16 },
  title: { fontSize: 22, marginBottom: 4 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  tabContainer: { paddingHorizontal: 8 },
  tab: { paddingHorizontal: 12, paddingVertical: 12, flex: 1, justifyContent: "center" },
  tabText: { fontSize: 13 },
  content: { padding: 16 },
  modeToggle: { marginBottom: 16 },
  inputCard: { padding: 16, borderRadius: 12 },
  
  /* Clean Mobile Form Styles */
  formContainer: { gap: 16 },
  formGroup: { gap: 6 },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 2 },
  formInputWrapper: { 
    flexDirection: "row", 
    alignItems: "center", 
    backgroundColor: "#F8FAFC", 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: "#E2E8F0", 
    paddingHorizontal: 14, 
    minHeight: 48 
  },
  formIcon: { marginRight: 10 },
  formTextInput: { flex: 1, fontSize: 15, color: "#0F172A", paddingVertical: 12 },
  formPicker: { flex: 1, height: 48, color: "#0F172A", marginLeft: -8 },
  formSuffix: { fontSize: 14, color: "#64748B", marginLeft: 4 },
  dateRow: { flexDirection: "row", gap: 12 },
  dateField: { flex: 1 },
  
  /* Action Buttons */
  actionRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  primaryButton: { flex: 1, justifyContent: "center", paddingVertical: 14 },
  secondaryButton: { flex: 0, paddingHorizontal: 20, paddingVertical: 14 },
  
  /* Cards */
  billingCard: { padding: 16, borderRadius: 12 },
  summaryGrid: { flexDirection: "column", gap: 12 },
  summaryItem: { flexBasis: "100%", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  placeholderCard: { padding: 32 },
  storedBillingsCard: { padding: 16, borderRadius: 12 },
  billingItem: { flexDirection: "column", alignItems: "stretch", gap: 8 },
  tenantCard: { padding: 12, borderRadius: 12 },
  tenantTotal: { paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB" },
  
  /* Row Cards */
  rowCardContainer: { gap: 8 },
  rowCard: { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", overflow: "hidden" },
  rowCardEven: { backgroundColor: "#F9FAFB" },
  rowCardHeader: { flexDirection: "row", alignItems: "center", padding: 12, gap: 12 },
  rowCardMain: { flex: 1 },
  rowCardStall: { fontSize: 14, fontWeight: "600", color: "#111827" },
  rowCardMeter: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  rowCardRight: { alignItems: "flex-end" },
  rowCardAmount: { fontSize: 15, fontWeight: "700", color: "#111827" },
  rowCardKwh: { backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginTop: 4 },
  rowCardKwhText: { fontSize: 11, fontWeight: "600", color: "#2563EB" },
  rowCardDetails: { padding: 12, paddingTop: 0, borderTopWidth: 1, borderTopColor: "#E5E7EB", backgroundColor: "#FAFAFA" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  detailLabel: { fontSize: 12, color: "#6B7280" },
  detailValue: { fontSize: 13, fontWeight: "500", color: "#111827" },
  divider: { height: 1, backgroundColor: "#E5E7EB", marginVertical: 6 },
  meterBadge: { backgroundColor: "#4F46E5", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  meterBadgeText: { fontSize: 10, fontWeight: "600", color: "#FFFFFF" },
  penaltyBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  penaltyYes: { backgroundColor: "#FEE2E2" },
  penaltyNo: { backgroundColor: "#DCFCE7" },
  penaltyText: { fontSize: 11, fontWeight: "600" },
  penaltyTextYes: { color: "#DC2626" },
  penaltyTextNo: { color: "#16A34A" },
  rocPositive: { color: "#16A34A" },
  rocNegative: { color: "#DC2626" },
});