import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  useWindowDimensions,
  Modal,
  Platform,
  Image,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

type Submission = {
  id: number;
  device_id?: number | null;
  device_serial?: string | null;
  device_name?: string | null;

  reader_user_id: string;
  meter_id: string;

  reading_value: number;
  reading_date: string;

  remarks?: string | null;
  image_base64?: string | null;

  submitted_at: string;
  status: "pending" | "approved" | "rejected" | string;

  approved_by?: string | null;
  approved_at?: string | null;
};

type Building = {
  building_id: string;
  building_name?: string | null;
};

type StallRow = {
  stall_id: string;
  building_id: string;
};

type MeterRow = {
  meter_id: string;
  stall_id?: string | null;
  building_id?: string | null;
};

type ReadingRow = {
  meter_id: string;
  reading_value: number;
  lastread_date: string;
};

function notify(title: string, message?: string) {
  if (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    (window as any).alert
  ) {
    (window as any).alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

function confirmAction(
  title: string,
  message: string,
  onYes: () => void,
  yesText = "Yes",
  noText = "Cancel",
) {
  // ✅ Web: use native confirm (Alert.alert can be flaky on web)
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const ok = window.confirm(`${title}\n\n${message}`);
    if (ok) onYes();
    return;
  }

  // ✅ Mobile: Alert.alert
  Alert.alert(title, message, [
    { text: noText, style: "cancel" },
    { text: yesText, style: "default", onPress: onYes },
  ]);
}

function toText(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function pickMessage(data: any) {
  return (
    data?.error ||
    data?.message ||
    data?.hint ||
    (typeof data === "string" ? data : null)
  );
}

function explainAxiosError(e: any, fallback: string) {
  const status = e?.response?.status;
  const serverMsg = pickMessage(e?.response?.data);
  const msg = serverMsg || e?.message || fallback;

  if (status === 401) {
    return `${toText(
      msg,
    )}\n\nHint: Your session may be expired. Try logging in again.`;
  }
  if (status === 403) {
    return `${toText(
      msg,
    )}\n\nHint: You need (role: admin/operator/biller) AND access module: offline_submissions OR meter_readings.`;
  }

  const body = e?.response?.data ? `\n\nResponse:\n${toText(e.response.data)}` : "";
  return `${toText(msg)}${body}`;
}

const dateOf = (s?: string) => (s ? Date.parse(s) || 0 : 0);

function b64UrlToUtf8(b64url: string): string {
  let b64 = String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";

  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < b64.length; i++) {
    const c = b64[i];
    if (c === "=") break;
    const v = chars.indexOf(c);
    if (v < 0) continue;

    buffer = (buffer << 6) | v;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      const byte = (buffer >> bits) & 0xff;
      output += String.fromCharCode(byte);
    }
  }

  try {
    return decodeURIComponent(
      output
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
  } catch {
    return output;
  }
}

function parseJwtPayload(token: string | null | undefined): any | null {
  if (!token) return null;
  const raw = String(token).trim().replace(/^Bearer\s+/i, "");
  const parts = raw.split(".");
  if (parts.length < 2) return null;

  try {
    const jsonStr = b64UrlToUtf8(parts[1]);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

function fmtNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}

function pctDelta(curr: number, prev: number) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

function asImageUri(base64?: string | null): string | null {
  if (!base64) return null;
  const b = String(base64).trim();
  if (!b) return null;
  if (/^data:image\//i.test(b)) return b;
  return `data:image/jpeg;base64,${b}`;
}

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

export default function OfflineSubmissionsPanel() {
  const { token, hasRole, hasAccess } = useAuth();

  const isAdmin = hasRole("admin");
  const isOperator = hasRole("operator");
  const isBiller = hasRole("biller");

  const roleOk = isAdmin || isOperator || isBiller;
  const accessOk = isAdmin || hasAccess("offline_submissions", "meter_readings");
  const canUse = roleOk && accessOk;

  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const api = useMemo(() => {
    const auth =
      token && String(token).trim()
        ? {
            Authorization: /^Bearer\s/i.test(String(token).trim())
              ? String(token).trim()
              : `Bearer ${String(token).trim()}`,
          }
        : {};
    return axios.create({
      baseURL: BASE_API,
      timeout: 25000,
      headers: auth,
    });
  }, [token]);

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [items, setItems] = useState<Submission[]>([]);
  const [error, setError] = useState<string>("");

  // lookups
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [meterToBuilding, setMeterToBuilding] = useState<Map<string, string>>(
    () => new Map(),
  );

  // filters
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  type SortMode = "newest" | "oldest";
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filtersVisible, setFiltersVisible] = useState(false);

  // approver info
  const me = useMemo(() => parseJwtPayload(token), [token]);
  const approverId = me?.user_id ? String(me.user_id) : "";
  const approverName = me?.user_fullname ? String(me.user_fullname) : "";

  // previous reading index (for 20% warning)
  const READING_ENDPOINTS = [
    "/meter_reading",
    "/readings",
    "/meter-readings",
    "/meterreadings",
  ];
  const [readingBase, setReadingBase] = useState<string | null>(
    READING_ENDPOINTS[0],
  );
  const [readingsByMeter, setReadingsByMeter] = useState<
    Map<string, Array<{ value: number; date: string }>>
  >(() => new Map());

  async function detectReadingEndpoint() {
    for (const p of READING_ENDPOINTS) {
      try {
        const res = await api.get(p, { validateStatus: () => true });
        const ok =
          res.status >= 200 && res.status < 400 && Array.isArray(res.data);
        if (ok) {
          setReadingBase(p);
          return p;
        }
      } catch {}
    }
    setReadingBase(null);
    return null;
  }

  function buildReadingIndex(rows: any[]) {
    const index = new Map<string, Array<{ value: number; date: string }>>();
    for (const r of rows || []) {
      const mid = String((r as any)?.meter_id ?? "").trim();
      const dt = String((r as any)?.lastread_date ?? "").trim();
      const val = Number((r as any)?.reading_value);
      if (!mid || !dt || !Number.isFinite(val)) continue;

      const arr = index.get(mid) || [];
      arr.push({ value: val, date: dt });
      index.set(mid, arr);
    }

    for (const [mid, arr] of index.entries()) {
      arr.sort((a, b) => dateOf(b.date) - dateOf(a.date));
      index.set(mid, arr);
    }

    return index;
  }

  async function fetchReadingIndex() {
    if (!token) return;

    const base = readingBase || (await detectReadingEndpoint());
    if (!base) {
      setReadingsByMeter(new Map());
      return;
    }

    try {
      const res = await api.get<ReadingRow[]>(base);
      const rows = Array.isArray(res.data) ? res.data : [];
      setReadingsByMeter(buildReadingIndex(rows as any));
    } catch {
      setReadingsByMeter(new Map());
    }
  }

  function getPrevReading(meterId: string, readingDate: string) {
    const list = readingsByMeter.get(String(meterId)) || [];
    const cutoff = dateOf(readingDate);
    if (!cutoff) return null;

    for (const r of list) {
      if (dateOf(r.date) < cutoff) return r;
    }
    return list.length ? list[0] : null;
  }

  // image modal + hover (web)
  const [imagePreview, setImagePreview] = useState<{
    visible: boolean;
    uri: string | null;
    title: string;
  }>({ visible: false, uri: null, title: "" });

  const [hoverPreview, setHoverPreview] = useState<{
    visible: boolean;
    uri: string | null;
    x: number;
    y: number;
  }>({ visible: false, uri: null, x: 0, y: 0 });

  const hoverHideTimer = useRef<any>(null);
  const clearHoverHideTimer = () => {
    if (hoverHideTimer.current) {
      clearTimeout(hoverHideTimer.current);
      hoverHideTimer.current = null;
    }
  };

  const showHoverPreview = (uri: string, x: number, y: number) => {
    if (Platform.OS !== "web") return;
    clearHoverHideTimer();

    const vw =
      typeof window !== "undefined" && window?.innerWidth
        ? window.innerWidth
        : 9999;
    const vh =
      typeof window !== "undefined" && window?.innerHeight
        ? window.innerHeight
        : 9999;

    const popW = 220;
    const popH = 220;
    const pad = 12;

    const nx = Math.min(Math.max(x + pad, pad), vw - popW - pad);
    const ny = Math.min(Math.max(y + pad, pad), vh - popH - pad);

    setHoverPreview({ visible: true, uri, x: nx, y: ny });
  };

  const scheduleHideHoverPreview = () => {
    if (Platform.OS !== "web") return;
    clearHoverHideTimer();
    hoverHideTimer.current = setTimeout(() => {
      setHoverPreview({ visible: false, uri: null, x: 0, y: 0 });
    }, 80);
  };

  const openImageModal = (item: Submission) => {
    const uri = asImageUri(item.image_base64);
    if (!uri) return;

    setImagePreview({
      visible: true,
      uri,
      title: `Meter ${toText(item.meter_id)} • #${item.id}`,
    });
  };

  const closeImageModal = () => {
    setImagePreview({ visible: false, uri: null, title: "" });
  };

  // data loaders
  const fetchPending = async () => {
    if (!token) return;

    try {
      setBusy(true);
      setError("");

      const res = await api.get("/offlineExport/pending");
      const submissions = res.data?.submissions;

      if (Array.isArray(submissions)) {
        setItems(submissions);
      } else {
        setItems([]);
        setError(toText(pickMessage(res.data) || "Unexpected server response."));
      }
    } catch (e: any) {
      setItems([]);
      setError(explainAxiosError(e, "Failed to load pending submissions."));
    } finally {
      setBusy(false);
    }
  };

  const fetchLookups = async () => {
    if (!token) return;

    try {
      const [bRes, sRes, mRes] = await Promise.all([
        api.get<Building[]>("/buildings"),
        api.get<StallRow[]>("/stalls"),
        api.get<MeterRow[]>("/meters"),
      ]);

      const bList = Array.isArray(bRes.data) ? bRes.data : [];
      setBuildings(bList);

      const stalls = Array.isArray(sRes.data) ? sRes.data : [];
      const meters = Array.isArray(mRes.data) ? mRes.data : [];

      const stallToBuilding = new Map<string, string>();
      for (const s of stalls) {
        if (s?.stall_id && s?.building_id) {
          stallToBuilding.set(String(s.stall_id), String(s.building_id));
        }
      }

      const mtb = new Map<string, string>();
      for (const m of meters) {
        const mid = String((m as any)?.meter_id ?? "");
        if (!mid) continue;

        const direct = (m as any)?.building_id
          ? String((m as any).building_id)
          : "";
        const stallId = (m as any)?.stall_id ? String((m as any).stall_id) : "";

        const bid =
          direct || (stallId ? stallToBuilding.get(stallId) : "") || "";
        if (bid) mtb.set(mid, bid);
      }

      setMeterToBuilding(mtb);
    } catch {
      // ignore lookup errors
    }
  };

  useEffect(() => {
    if (token && canUse) {
      (async () => {
        await Promise.all([fetchPending(), fetchLookups(), fetchReadingIndex()]);
      })();
    } else {
      setBusy(false);
      setItems([]);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canUse]);

  useEffect(() => {
    return () => clearHoverHideTimer();
  }, []);

  const buildingLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of buildings) {
      map.set(b.building_id, b.building_name || b.building_id);
    }
    return map;
  }, [buildings]);

  const filtered = useMemo(() => {
    let list = items;
    if (buildingFilter) {
      list = list.filter(
        (it) => meterToBuilding.get(String(it.meter_id)) === buildingFilter,
      );
    }
    return list;
  }, [items, buildingFilter, meterToBuilding]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortMode === "oldest") {
      arr.sort((a, b) => dateOf(a.submitted_at) - dateOf(b.submitted_at));
    } else {
      arr.sort((a, b) => dateOf(b.submitted_at) - dateOf(a.submitted_at));
    }
    return arr;
  }, [filtered, sortMode]);

  // ✅ guard against double-taps + approve-all overlaps
  const inFlightIds = useRef<Set<number>>(new Set());

  const approveOne = async (id: number, opts?: { silent?: boolean; skipRefresh?: boolean }) => {
    if (inFlightIds.current.has(id)) return { ok: false, skipped: true };
    inFlightIds.current.add(id);

    try {
      const res = await api.post(`/offlineExport/approve/${id}`);
      const mrId = res?.data?.reading_id != null ? String(res.data.reading_id) : "";

      if (!opts?.silent) {
        notify(
          "Approved ✅",
          mrId
            ? `Saved as ${mrId}\n\nThis offline submission will now appear in Meter Readings as a normal MR-* entry (with [OFFLINE] in remarks).`
            : "Saved to meter_reading.",
        );
      }

      if (!opts?.skipRefresh) {
        await Promise.all([fetchPending(), fetchReadingIndex()]);
      }

      return { ok: true, mrId };
    } catch (e: any) {
      const msg = explainAxiosError(e, "Approve failed.");
      if (!opts?.silent) notify("Approve failed", msg);
      return { ok: false, error: msg };
    } finally {
      inFlightIds.current.delete(id);
    }
  };

  const rejectOne = async (id: number) => {
    if (inFlightIds.current.has(id)) return;
    inFlightIds.current.add(id);

    try {
      await api.post(`/offlineExport/reject/${id}`);
      await fetchPending();
      notify("Rejected", "Offline submission has been rejected.");
    } catch (e: any) {
      const msg = explainAxiosError(e, "Reject failed.");
      notify("Reject failed", msg);
    } finally {
      inFlightIds.current.delete(id);
    }
  };

  // ✅ Approve All (current filtered list)
  const [approveAllBusy, setApproveAllBusy] = useState(false);
  const [approveAllProgress, setApproveAllProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  const approveAll = async () => {
    if (!buildingFilter) {
      notify("Select a building", "Please select a building first.");
      return;
    }
    const ids = sorted.map((x) => x.id);
    if (ids.length === 0) {
      notify("Nothing to approve", "No pending submissions in this building.");
      return;
    }
    if (approveAllBusy || submitting) return;

    setApproveAllBusy(true);
    setSubmitting(true);
    setApproveAllProgress({ done: 0, total: ids.length });

    const failures: Array<{ id: number; error: string }> = [];

    // sequential (safer for DB + avoids spamming)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const r = await approveOne(id, { silent: true, skipRefresh: true });
      if (!r.ok && !r.skipped) {
        failures.push({ id, error: (r as any)?.error || "Unknown error" });
      }
      setApproveAllProgress({ done: i + 1, total: ids.length });
    }

    // refresh once at the end
    await Promise.all([fetchPending(), fetchReadingIndex()]);

    const okCount = ids.length - failures.length;

    if (failures.length === 0) {
      notify(
        "Approve All ✅",
        `Approved ${okCount}/${ids.length} submissions for ${
          buildingLabel.get(buildingFilter) || buildingFilter
        }.`,
      );
    } else {
      // keep message short, include first few
      const firstFew = failures.slice(0, 5).map((f) => `#${f.id}`).join(", ");
      notify(
        "Approve All (partial)",
        `Approved ${okCount}/${ids.length}.\nFailed: ${failures.length}\n\nFailed IDs: ${firstFew}${
          failures.length > 5 ? ", …" : ""
        }\n\nTip: Try approving the failed ones individually to see the exact error.`,
      );
    }

    setSubmitting(false);
    setApproveAllBusy(false);
    setApproveAllProgress({ done: 0, total: 0 });
  };

  // permissions gate
  if (!roleOk || !accessOk) {
    const missingRole = !roleOk;
    const missingAccess = !accessOk;

    return (
      <View style={styles.selectBuildingEmpty}>
        <Ionicons name="lock-closed-outline" size={44} color="#cbd5e1" />
        <Text style={styles.emptyTitle}>Forbidden: Insufficient permissions</Text>

        {missingRole && (
          <Text style={styles.emptyText}>
            Your role is not allowed here. Required role: admin / operator / biller.
          </Text>
        )}

        {missingAccess && (
          <Text style={styles.emptyText}>
            Your account is missing access. Required access: offline_submissions OR
            meter_readings.
          </Text>
        )}

        <Text style={[styles.emptyText, { marginTop: 6 }]}>
          Try logging out and logging in again after the admin updates your access.
        </Text>
      </View>
    );
  }

  const approveAllDisabled =
    submitting || approveAllBusy || busy || !buildingFilter || sorted.length === 0;

  return (
    <View style={styles.page}>
      {/* ✅ Hover preview (WEB only) */}
      {Platform.OS === "web" && hoverPreview.visible && !!hoverPreview.uri && (
        <View
          pointerEvents="none"
          style={[
            styles.hoverPopover,
            {
              left: hoverPreview.x,
              top: hoverPreview.y,
            } as any,
          ]}
        >
          <Image
            source={{ uri: hoverPreview.uri }}
            resizeMode="contain"
            style={styles.hoverPopoverImg}
          />
        </View>
      )}

      <View style={styles.grid}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Offline Submissions</Text>

            <View style={styles.headerActions}>
              {/* ✅ Approve All */}
              <TouchableOpacity
                style={[styles.btnGreen, approveAllDisabled && styles.btnDisabled]}
                onPress={() =>
                  confirmAction(
                    "Approve ALL?",
                    `This will approve ALL pending submissions currently shown.\n\nBuilding: ${
                      buildingLabel.get(buildingFilter) || buildingFilter || "—"
                    }\nCount: ${sorted.length}\n\nApprover: ${
                      approverId || "—"
                    }${approverName ? ` (${approverName})` : ""}`,
                    approveAll,
                    "Approve All",
                  )
                }
                disabled={approveAllDisabled}
              >
                <Text style={styles.btnText}>
                  {approveAllBusy
                    ? `Approving ${approveAllProgress.done}/${approveAllProgress.total}…`
                    : `Approve All (${sorted.length})`}
                </Text>
              </TouchableOpacity>

              {/* Refresh */}
              <TouchableOpacity
                style={[styles.btn, submitting && styles.btnDisabled]}
                onPress={() => {
                  fetchPending();
                  fetchLookups();
                  fetchReadingIndex();
                }}
                disabled={submitting}
              >
                <Text style={styles.btnText}>
                  {submitting ? "Refreshing…" : "Refresh"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {!!error && <Text style={styles.err}>{toText(error)}</Text>}

          <View style={styles.filtersBar}>
            <View style={[styles.searchWrap, { flex: 1 }]}>
              <Ionicons
                name="information-circle-outline"
                size={16}
                color="#94a3b8"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.searchHint}>
                Approve / reject pending offline readings
              </Text>
            </View>

            <TouchableOpacity
              style={styles.btnGhost}
              onPress={() => setFiltersVisible(true)}
            >
              <Ionicons
                name="options-outline"
                size={16}
                color="#394e6a"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.btnGhostText}>Filters</Text>
            </TouchableOpacity>
          </View>

          <View style={{ marginTop: 6, marginBottom: 15 }}>
            <View style={styles.buildingHeaderRow}>
              <Text style={styles.dropdownLabel}>Building</Text>
            </View>

            {isMobile ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRowHorizontal}
              >
                {buildings.map((b) => (
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
                {buildings.map((b) => (
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

          {busy ? (
            <View style={styles.loader}>
              <ActivityIndicator />
            </View>
          ) : !buildingFilter ? (
            <View style={styles.selectBuildingEmpty}>
              <Ionicons name="business-outline" size={44} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>Select a building</Text>
              <Text style={styles.emptyText}>
                Choose a building above to show pending submissions.
              </Text>
            </View>
          ) : (
            <FlatList
              data={sorted}
              keyExtractor={(x) => String(x.id)}
              style={{ flex: 1 }}
              contentContainerStyle={
                sorted.length === 0 ? styles.emptyPad : { paddingBottom: 24 }
              }
              refreshing={busy || submitting}
              onRefresh={() => {
                fetchPending();
                fetchLookups();
                fetchReadingIndex();
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="albums-outline" size={42} color="#cbd5e1" />
                  <Text style={styles.emptyTitle}>No submissions</Text>
                  <Text style={styles.emptyText}>
                    No pending offline submissions for{" "}
                    {buildingLabel.get(buildingFilter) || buildingFilter}.
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const bid = meterToBuilding.get(String(item.meter_id)) || "";
                const bName = bid ? buildingLabel.get(bid) || bid : "—";

                const prev = getPrevReading(
                  String(item.meter_id),
                  String(item.reading_date),
                );
                const prevValue = prev ? prev.value : null;
                const prevDate = prev ? prev.date : null;

                const currValue = Number(item.reading_value);
                const deltaPct =
                  prevValue !== null && Number.isFinite(currValue)
                    ? pctDelta(currValue, Number(prevValue))
                    : null;

                const isWarn = deltaPct !== null && Math.abs(deltaPct) >= 20;
                const deltaLabel =
                  deltaPct === null
                    ? ""
                    : `${deltaPct >= 0 ? "+" : ""}${Math.round(deltaPct)}%`;

                const uri = asImageUri(item.image_base64);
                const hasImage = !!uri;

                const webHoverHandlers =
                  Platform.OS === "web" && uri
                    ? {
                        onMouseMove: (e: any) => {
                          showHoverPreview(uri, e?.clientX ?? 0, e?.clientY ?? 0);
                        },
                        onMouseLeave: () => scheduleHideHoverPreview(),
                      }
                    : {};

                return (
                  <View style={[styles.row, isMobile && styles.rowMobile]}>
                    <View style={styles.rowMain}>
                      <View style={styles.titleRow}>
                        <Text style={styles.rowTitle}>
                          Meter {toText(item.meter_id)}{" "}
                          <Text style={styles.rowSub}>(#{item.id})</Text>
                        </Text>

                        {isWarn && (
                          <View style={styles.warnBadge}>
                            <Ionicons
                              name="warning-outline"
                              size={14}
                              color="#fff"
                            />
                            <Text style={styles.warnBadgeText}>
                              {deltaLabel}
                            </Text>
                          </View>
                        )}
                      </View>

                      <Text style={styles.rowMeta}>
                        Building: {bName} • Current Reading:{" "}
                        {fmtNum(item.reading_value)} • Date:{" "}
                        {toText(item.reading_date)}
                      </Text>

                      <Text style={styles.rowMetaSmall}>
                        Previous Reading:{" "}
                        {prevValue !== null ? fmtNum(prevValue) : "—"}
                        {prevDate
                          ? ` • Previous Date: ${toText(prevDate).slice(0, 10)}`
                          : ""}
                      </Text>

                      <Text style={styles.rowMetaSmall}>
                        Reader: {toText(item.reader_user_id)}
                        {item.device_serial
                          ? ` • Device: ${toText(item.device_serial)}${
                              item.device_name
                                ? ` (${toText(item.device_name)})`
                                : ""
                            }`
                          : ""}
                      </Text>

                      <Text style={styles.rowMetaSmall}>
                        Submitted:{" "}
                        {item.submitted_at
                          ? new Date(item.submitted_at).toLocaleString()
                          : "—"}
                        {item.remarks
                          ? ` • Remarks: ${toText(item.remarks)}`
                          : ""}
                      </Text>

                      {!!approverId && (
                        <Text style={styles.rowMetaSmall}>
                          Approver (you): {approverId}
                          {approverName ? ` • ${approverName}` : ""}
                        </Text>
                      )}

                      {hasImage ? (
                        <TouchableOpacity
                          onPress={() => openImageModal(item)}
                          activeOpacity={0.8}
                          {...(webHoverHandlers as any)}
                          onPressIn={() => clearHoverHideTimer()}
                          onPressOut={() => scheduleHideHoverPreview()}
                          style={styles.imageRow}
                        >
                          <Ionicons
                            name="image-outline"
                            size={16}
                            color="#2563eb"
                          />
                          <Text style={[styles.rowMetaSmall, styles.tapToView]}>
                            {Platform.OS === "web"
                              ? "Image: ✅ Hover to preview • Click to zoom"
                              : "Image: ✅ Tap to view"}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.rowMetaSmall}>Image: — None</Text>
                      )}
                    </View>

                    {/* ✅ Approve / Reject */}
                    {isMobile ? (
                      <View style={styles.rowActionsMobile}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionEdit]}
                          onPress={() =>
                            confirmAction(
                              "Approve reading?",
                              `This will save the reading to meter_reading as MR-###.\n\nApprover: ${
                                approverId || "—"
                              }${
                                approverName ? ` (${approverName})` : ""
                              }`,
                              async () => {
                                setSubmitting(true);
                                const r = await approveOne(item.id);
                                setSubmitting(false);
                                return r;
                              },
                              "Approve",
                            )
                          }
                          disabled={submitting || approveAllBusy}
                        >
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={16}
                            color="#1f2937"
                          />
                          <Text
                            style={[styles.actionText, styles.actionEditText]}
                          >
                            Approve
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionDelete]}
                          onPress={() =>
                            confirmAction(
                              "Reject reading?",
                              `This will mark the offline submission as rejected.\n\nApprover: ${
                                approverId || "—"
                              }${
                                approverName ? ` (${approverName})` : ""
                              }`,
                              async () => {
                                setSubmitting(true);
                                await rejectOne(item.id);
                                setSubmitting(false);
                              },
                              "Reject",
                            )
                          }
                          disabled={submitting || approveAllBusy}
                        >
                          <Ionicons
                            name="close-circle-outline"
                            size={16}
                            color="#fff"
                          />
                          <Text
                            style={[
                              styles.actionText,
                              styles.actionDeleteText,
                            ]}
                          >
                            Reject
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.rowActions}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionEdit]}
                          onPress={() =>
                            confirmAction(
                              "Approve reading?",
                              `This will save the reading to meter_reading as MR-###.\n\nApprover: ${
                                approverId || "—"
                              }${
                                approverName ? ` (${approverName})` : ""
                              }`,
                              async () => {
                                setSubmitting(true);
                                const r = await approveOne(item.id);
                                setSubmitting(false);
                                return r;
                              },
                              "Approve",
                            )
                          }
                          disabled={submitting || approveAllBusy}
                        >
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={16}
                            color="#1f2937"
                          />
                          <Text
                            style={[styles.actionText, styles.actionEditText]}
                          >
                            Approve
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionDelete]}
                          onPress={() =>
                            confirmAction(
                              "Reject reading?",
                              `This will mark the offline submission as rejected.\n\nApprover: ${
                                approverId || "—"
                              }${
                                approverName ? ` (${approverName})` : ""
                              }`,
                              async () => {
                                setSubmitting(true);
                                await rejectOne(item.id);
                                setSubmitting(false);
                              },
                              "Reject",
                            )
                          }
                          disabled={submitting || approveAllBusy}
                        >
                          <Ionicons
                            name="close-circle-outline"
                            size={16}
                            color="#fff"
                          />
                          <Text
                            style={[
                              styles.actionText,
                              styles.actionDeleteText,
                            ]}
                          >
                            Reject
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>

        {/* Filters modal */}
        <Modal
          visible={filtersVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setFiltersVisible(false)}
        >
          <View style={styles.promptOverlay}>
            <View style={styles.promptCard}>
              <Text style={styles.modalTitle}>Filters & Sort</Text>
              <View style={styles.modalDivider} />

              <Text style={styles.dropdownLabel}>Sort by</Text>
              <View style={styles.chipsRow}>
                <Chip
                  label="Newest"
                  active={sortMode === "newest"}
                  onPress={() => setSortMode("newest")}
                />
                <Chip
                  label="Oldest"
                  active={sortMode === "oldest"}
                  onPress={() => setSortMode("oldest")}
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.btn}
                  onPress={() => setFiltersVisible(false)}
                >
                  <Text style={styles.btnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Image zoom modal */}
        <Modal
          visible={imagePreview.visible}
          transparent
          animationType="fade"
          onRequestClose={closeImageModal}
        >
          <View style={styles.imgOverlay}>
            <View style={styles.imgCard}>
              <View style={styles.imgHeader}>
                <Text style={styles.imgTitle} numberOfLines={1}>
                  {imagePreview.title}
                </Text>

                <TouchableOpacity
                  onPress={closeImageModal}
                  style={styles.imgClose}
                >
                  <Ionicons name="close" size={18} color="#0f172a" />
                </TouchableOpacity>
              </View>

              <View style={styles.imgDivider} />

              {imagePreview.uri ? (
                <Image
                  source={{ uri: imagePreview.uri }}
                  resizeMode="contain"
                  style={styles.img}
                />
              ) : (
                <View style={styles.imgEmpty}>
                  <Ionicons name="image-outline" size={34} color="#cbd5e1" />
                  <Text style={styles.imgEmptyText}>No image</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
    flexWrap: "wrap",
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },

  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnGreen: {
    backgroundColor: "#16a34a",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: "#fff", fontWeight: "800" },

  err: { color: "#c62828", marginBottom: 10 },

  filtersBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
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
  searchHint: {
    flex: 1,
    color: "#64748b",
    fontWeight: "700",
    fontSize: 12,
  },

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

  loader: { paddingVertical: 24, alignItems: "center", justifyContent: "center" },

  buildingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  dropdownLabel: { fontSize: 12, fontWeight: "800", color: "#64748b" },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipsRowHorizontal: { paddingRight: 4, gap: 8, alignItems: "center" },

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

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    paddingHorizontal: 10,
    gap: 6,
  },
  emptyPad: { paddingBottom: 24 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0f172a",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    textAlign: "center",
    maxWidth: 420,
  },

  selectBuildingEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
    gap: 8,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fff",
    marginBottom: 10,
  },
  rowMobile: { flexDirection: "column" },
  rowMain: { flex: 1, minWidth: 0 },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  warnBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#dc2626",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  warnBadgeText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  rowTitle: { fontSize: 15, fontWeight: "800", color: "#0f172a", marginBottom: 4 },
  rowSub: { color: "#64748b", fontWeight: "800", fontSize: 12 },

  rowMeta: { fontSize: 12, fontWeight: "800", color: "#334155", marginBottom: 4 },
  rowMetaSmall: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
    marginBottom: 3,
  },

  imageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    alignSelf: "flex-start",
  },
  tapToView: {
    textDecorationLine: "underline",
    ...(Platform.select({ web: { cursor: "pointer" as any } }) as any),
  },

  rowActions: { flexDirection: "column", alignItems: "flex-end", gap: 10 },
  rowActionsMobile: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 112,
    justifyContent: "center",
  },
  actionText: { fontWeight: "900", fontSize: 12 },

  actionEdit: { backgroundColor: "#e2e8f0", borderColor: "#cbd5e1" },
  actionEditText: { color: "#0f172a" },

  actionDelete: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  actionDeleteText: { color: "#fff" },

  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },
  promptCard: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  modalDivider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 10 },
  modalActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },

  hoverPopover: {
    position: "fixed" as any,
    width: 220,
    height: 220,
    borderRadius: 12,
    padding: 6,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    zIndex: 9999,
    ...(Platform.select({
      web: { boxShadow: "0 16px 50px rgba(15, 23, 42, 0.22)" } as any,
    }) as any),
  },
  hoverPopoverImg: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
  },

  imgOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  imgCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 900,
    padding: 12,
    ...(Platform.select({
      web: { boxShadow: "0 18px 60px rgba(15, 23, 42, 0.28)" } as any,
      default: { elevation: 4 },
    }) as any),
  },
  imgHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  imgTitle: { fontSize: 14, fontWeight: "900", color: "#0f172a", flex: 1 },
  imgClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    ...(Platform.select({ web: { cursor: "pointer" as any } }) as any),
  },
  imgDivider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 10 },
  img: {
    width: "100%",
    height: 420,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  imgEmpty: {
    width: "100%",
    height: 260,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  imgEmptyText: { color: "#94a3b8", fontWeight: "800" },
});