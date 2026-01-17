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
  Image as RNImage,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import NetInfo from "@react-native-community/netinfo";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { BASE_API } from "../../constants/api";
import { useScanHistory } from "../../contexts/ScanHistoryContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../../contexts/AuthContext";

const KEY_DEVICE_TOKEN = "device_token_v1";
const KEY_DEVICE_NAME = "device_name_v1";

async function getReaderDeviceToken(): Promise<string> {
  const t = await AsyncStorage.getItem(KEY_DEVICE_TOKEN);
  return (t || "").trim();
}
async function getReaderDeviceName(): Promise<string> {
  const n = await AsyncStorage.getItem(KEY_DEVICE_NAME);
  return (n || "").trim();
}
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
        if ((v as any).error && typeof (v as any).error.message === "string")
          return (v as any).error.message;
        return JSON.stringify(v, null, 2);
      }
      return null;
    };

    const body =
      pick(data) ||
      pick(err?.message) ||
      (err?.toString && err.toString() !== "[object Object]"
        ? err.toString()
        : null) ||
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
function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return Promise.resolve(!!window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Proceed", style: "default", onPress: () => resolve(true) },
    ]);
  });
}
function toDataUrl(val?: string) {
  const s = (val || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) return s;
  return `data:image/jpeg;base64,${s}`;
}

const MAX_IMAGE_BYTES = 400 * 1024;
function base64Bytes(b64: string): number {
  const len = (b64 || "").replace(/[^A-Za-z0-9+/=]/g, "").length;
  if (!len) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
}
function asBase64(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  if (s.startsWith("data:")) {
    const i = s.indexOf(",");
    return i >= 0 ? s.slice(i + 1) : "";
  }
  return s;
}
function asDataUrl(raw: string, mime = "image/jpeg"): string {
  const s = (raw || "").trim();
  return s.startsWith("data:") ? s : `data:${mime};base64,${s}`;
}
async function compressDataUrlWeb(
  dataUrl: string,
  maxDim = 1024,
  quality = 0.7,
): Promise<string> {
  if (
    Platform.OS !== "web" ||
    typeof document === "undefined" ||
    !(globalThis as any).Image
  ) {
    return Promise.resolve(dataUrl.split(",")[1] || "");
  }
  return new Promise((resolve) => {
    try {
      const ImgCtor: any = (globalThis as any).Image;
      const img: any = new ImgCtor();
      img.onload = () => {
        let tw = img.naturalWidth || img.width;
        let th = img.naturalHeight || img.height;
        if (Math.max(tw, th) > maxDim) {
          if (tw >= th) {
            th = Math.round((th / tw) * maxDim);
            tw = maxDim;
          } else {
            tw = Math.round((tw / th) * maxDim);
            th = maxDim;
          }
        }
        const canvas: any = (document as any).createElement("canvas");
        canvas.width = Math.max(1, tw);
        canvas.height = Math.max(1, th);
        const ctx: any = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl.split(",")[1] || "");
        ctx.drawImage(img, 0, 0, tw, th);
        const out: string = canvas.toDataURL("image/jpeg", quality);
        resolve(out.split(",")[1] || "");
      };
      img.onerror = () => resolve(dataUrl.split(",")[1] || "");
      img.src = dataUrl;
    } catch {
      resolve(dataUrl.split(",")[1] || "");
    }
  });
}
async function ensureSizedBase64(
  input: string,
  mime = "image/jpeg",
): Promise<string> {
  const raw = asBase64(input);
  if (Platform.OS !== "web") {
    if (base64Bytes(raw) > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is too large (${(base64Bytes(raw) / 1024).toFixed(0)} KB). Please pick a smaller image.`,
      );
    }
    return raw;
  }
  if (base64Bytes(raw) <= MAX_IMAGE_BYTES) return raw;
  const c1 = await compressDataUrlWeb(asDataUrl(raw, mime), 1024, 0.7);
  if (base64Bytes(c1) <= MAX_IMAGE_BYTES) return c1;
  const c2 = await compressDataUrlWeb(asDataUrl(c1, mime), 900, 0.6);
  if (base64Bytes(c2) <= MAX_IMAGE_BYTES) return c2;
  throw new Error(
    `Image is still too large (${(base64Bytes(c2) / 1024).toFixed(0)} KB). Please choose a smaller image.`,
  );
}

async function compressUriToSizedBase64Native(uri: string): Promise<string> {
  const widths = [1600, 1400, 1280, 1152, 1024, 900, 800, 720, 640];
  const qualities = [0.85, 0.78, 0.72, 0.66, 0.60, 0.54, 0.48, 0.42, 0.36];

  let currentUri = uri;

  for (let i = 0; i < widths.length; i++) {
    const width = widths[i];
    const compress = qualities[i];

    const result = await ImageManipulator.manipulateAsync(
      currentUri,
      [{ resize: { width } }],
      {
        compress,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      }
    );

    const b64 = (result.base64 || "").trim();
    if (b64 && base64Bytes(b64) <= MAX_IMAGE_BYTES) {
      return b64;
    }
    currentUri = result.uri;
  }

  const last = await ImageManipulator.manipulateAsync(
    currentUri,
    [],
    { compress: 0.30, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );

  const lastB64 = (last.base64 || "").trim();
  if (lastB64 && base64Bytes(lastB64) <= MAX_IMAGE_BYTES) return lastB64;

  throw new Error(
    `Image is still too large (${Math.round(base64Bytes(lastB64) / 1024)} KB). Try a closer photo or lower resolution image.`
  );
}

function ts(d: string) {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}
function getLastTwo(
  readings: {
    meter_id: string;
    lastread_date: string;
    reading_value: number | string;
  }[],
  meterId: string,
) {
  const arr = readings
    .filter((r) => r.meter_id === meterId)
    .slice()
    .sort((a, b) => ts(b.lastread_date) - ts(a.lastread_date));
  return { latest: arr[0] || null, previous: arr[1] || null };
}
function pctUp(
  newVal: number,
  oldVal: number | string | null | undefined,
): number | null {
  const oldN = oldVal == null ? null : Number(oldVal);
  if (oldN == null || !isFinite(oldN) || oldN === 0) return null;
  const nv = Number(newVal);
  if (!isFinite(nv)) return null;
  return (nv - oldN) / oldN;
}

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

export default function MeterReadingPanel({
  token,
  initialMeterId,
}: {
  token: string | null;
  initialMeterId?: string;
}) {
  const jwt = useMemo(() => decodeJwtPayload(token), [token]);
  const roles = Array.isArray(jwt?.user_roles)
    ? jwt.user_roles.map((r: any) => String(r).toLowerCase())
    : String(jwt?.user_level ?? jwt?.user_roles ?? "")
        .split(/[,\s]+/)
        .map((r) => r.toLowerCase())
        .filter(Boolean);

  const isAdmin = roles.includes("admin");
  const isOperator = roles.includes("operator");
  const isReader = roles.includes("reader");
  const isBiller = roles.includes("biller");
  const canWrite = isAdmin || isOperator || isReader || isBiller;

  const [hasOfflinePackage, setHasOfflinePackage] = useState(false);
  const [syncingPackage, setSyncingPackage] = useState(false);

  const userBuildingId = String(jwt?.building_id || "");

  const headerToken =
    token && /^Bearer\s/i.test(token.trim())
      ? token.trim()
      : token
        ? `Bearer ${token.trim()}`
        : "";
  const authHeader = useMemo(
    () => (headerToken ? { Authorization: headerToken } : {}),
    [headerToken],
  );
  const api = useMemo(
    () =>
      axios.create({ baseURL: BASE_API, headers: authHeader, timeout: 15000 }),
    [authHeader],
  );
  useEffect(() => {
    reloadBillingHeaders();
  }, [authHeader]);
  const { width } = useWindowDimensions();
  const isMobile = width < 640;
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const sub = NetInfo.addEventListener((s) =>
      setIsConnected(!!s.isConnected),
    );
    NetInfo.fetch().then((s) => setIsConnected(!!s.isConnected));
    return () => sub && sub();
  }, []);
  const {
    token: authToken,
    deviceToken: ctxDeviceToken,
    deviceName: ctxDeviceName,
  } = useAuth();

  const {
    scans,
    queueScan,
    removeScan,
    markPending,
    syncOfflineReadings,
    isConnected: ctxConnected,
  } = useScanHistory();

  const online = isConnected ?? ctxConnected ?? false;
  const [syncing, setSyncing] = useState(false);

  const onSyncOffline = async () => {
    if (!online) {
      notify("Offline", "Connect to internet first to sync offline readings.");
      return;
    }
    if (!authToken) {
      notify("Not logged in", "Please log in again.");
      return;
    }
    const deviceToken = (
      ctxDeviceToken || (await getReaderDeviceToken())
    ).trim();
    const deviceName = (ctxDeviceName || (await getReaderDeviceName())).trim();

    if (!deviceToken) {
      notify(
        "Device not registered",
        "This reader device has no device token yet. Ask admin to register the device serial, then login again.",
      );
      return;
    }

    try {
      setSyncing(true);
      await syncOfflineReadings(authToken, deviceToken);
      notify(
        "Synced",
        ` sent successfullyOffline readings${deviceName ? ` (${deviceName})` : ""}.`,
      );
    } catch (e: any) {
      notify("Sync failed", e?.message || "Unable to sync offline readings.");
    } finally {
      setSyncing(false);
    }
  };
  const [typeFilter, setTypeFilter] = useState<
    "" | "electric" | "water" | "lpg"
  >("");
  const [buildingFilter, setBuildingFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<
    "date_desc" | "date_asc" | "id_desc" | "id_asc"
  >("date_desc");
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [buildingPickerVisible, setBuildingPickerVisible] = useState(false);
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [stalls, setStalls] = useState<Stall[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [meterQuery, setMeterQuery] = useState("");
  const [query, setQuery] = useState("");
  const [selectedMeterId, setSelectedMeterId] = useState<string>(
    initialMeterId ?? "",
  );
  const [readingsModalVisible, setReadingsModalVisible] = useState(false);
  const PAGE_SIZE = 30;
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [selectedMeterId]);

  const [createVisible, setCreateVisible] = useState(false);
  const [formMeterId, setFormMeterId] = useState<string>(initialMeterId ?? "");
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState<string>(todayStr());
  const [formRemarks, setFormRemarks] = useState<string>("");
  const [formImage, setFormImage] = useState<string>("");
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageSizeKB, setImageSizeKB] = useState<number | null>(null);

  useEffect(() => {
    if (initialMeterId) {
      setSelectedMeterId(initialMeterId);
      setFormMeterId(initialMeterId);
      setCreateVisible(true);
    }
  }, [initialMeterId]);

  const [createWarn, setCreateWarn] = useState(false);

  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Reading | null>(null);
  const [editMeterId, setEditMeterId] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editRemarks, setEditRemarks] = useState<string>("");
  const [editImage, setEditImage] = useState<string>("");

  const [editWarn, setEditWarn] = useState(false);

  const readingInputRef = useRef<TextInput>(null);

  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyTab, setHistoryTab] = useState<
    "all" | "pending" | "failed" | "synced"
  >("all");

  const [imgToolVisible, setImgToolVisible] = useState(false);
  const READING_ENDPOINTS = [
    "/meter_reading",
    "/readings",
    "/meter-readings",
    "/meterreadings",
  ];
  const [readingBase, setReadingBase] = useState<string>(READING_ENDPOINTS[0]);
  type BillingHeader = {
    building_id: string;
    period: { start: string; end: string };
    status?: string;
  };

  const BILLING_HEADERS_ENDPOINTS = [
    "/billing/headers",
    "/billings/headers",
    "/billings/buildings",
    "/billing",
    "/billings",
  ];

  const [billingHeadersBase, setBillingHeadersBase] = useState<string | null>(
    null,
  );
  const [billingHeaders, setBillingHeaders] = useState<BillingHeader[]>([]);

  async function detectBillingHeadersEndpoint() {
    for (const p of BILLING_HEADERS_ENDPOINTS) {
      try {
        const res = await api.get(p, { validateStatus: () => true });
        const ok =
          res.status >= 200 &&
          res.status < 400 &&
          (Array.isArray(res.data) ||
            (res.data &&
              typeof res.data === "object" &&
              !Array.isArray(res.data)));

        if (ok) {
          setBillingHeadersBase(p);
          return p;
        }
      } catch {}
    }
    return null;
  }

  const reloadBillingHeaders = async () => {
    try {
      const base = billingHeadersBase ?? (await detectBillingHeadersEndpoint());
      if (!base) return;

      const res = await api.get(base, { validateStatus: () => true });
      const data = res.data;

      let headers: BillingHeader[] = [];

      if (Array.isArray(data)) {
        headers = data as BillingHeader[];
      } else if (data && typeof data === "object") {
        headers = Object.values(data as Record<string, any>).map((item) => ({
          building_id: item.building_id,
          period: item.period ?? {
            start: item.period_start,
            end: item.period_end,
          },
          status:
            item.status ??
            item.lock_status ??
            (typeof item.is_locked !== "undefined"
              ? String(item.is_locked)
              : undefined),
        }));
      }

      headers = headers.filter(
        (h) =>
          h &&
          h.building_id &&
          h.period &&
          typeof h.period.start === "string" &&
          typeof h.period.end === "string",
      );

      setBillingHeaders(headers);
    } catch (e) {
      if (Platform.OS === "web") {
        console.error("Billing header load failed:", e);
      }
    }
  };

  async function detectReadingEndpoint() {
    for (const p of READING_ENDPOINTS) {
      try {
        const res = await api.get(p, { validateStatus: () => true });
        if (
          (res.status >= 200 && res.status < 400 && Array.isArray(res.data)) ||
          (res.status === 200 &&
            res.data &&
            typeof res.data === "object" &&
            "items" in res.data)
        ) {
          setReadingBase(p);
          return p;
        }
      } catch {}
    }
    return READING_ENDPOINTS[0];
  }

  const filteredScans = useMemo(
    () =>
      historyTab === "all"
        ? scans
        : scans.filter((s) => s.status === historyTab),
    [scans, historyTab],
  );
  const readNum = (id: string) => {
    const m = /^MR-(\d+)/i.exec(id || "");
    return m ? parseInt(m[1], 10) : 0;
  };

  useEffect(() => {
    loadAll();
  }, [token]);
  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      notify("Not logged in", "Please log in to manage meter readings.");
      return;
    }
    if (!isAdmin && !isOperator && !isBiller) {
      setMeters([]);
      setStalls([]);
      setReadings([]);
      setBuildings([]);
      setHasOfflinePackage(false);
      setBusy(false);
      return;
    }

    try {
      setBusy(true);
      const base = await detectReadingEndpoint();
      const [rRes, mRes, sRes] = await Promise.all([
        api.get<Reading[]>(base),
        api.get<Meter[]>("/meters"),
        api.get<Stall[]>("/stalls"),
      ]);
      setReadings(
        Array.isArray(rRes.data)
          ? rRes.data
          : ((rRes.data as any)?.items ?? []),
      );
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
      if (!isAdmin && userBuildingId) {
        setBuildingFilter((prev) => prev || userBuildingId);
      }

      await reloadBillingHeaders();
    } catch (err: any) {
      notify(
        "Load failed",
        errorText(err, "Please check your connection and permissions."),
      );
      if (Platform.OS === "web")
        console.error("LOAD ERROR", err?.response ?? err);
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

  const buildingIdForMeter = (
    meterId: string | null | undefined,
  ): string | null => {
    if (!meterId) return null;
    const m = metersById.get(meterId);
    if (!m) return null;

    const stallId =
      (m as any).stall_id || (m as any).stall_no || (m as any).stall_sn || null;

    if (stallId && stallToBuilding.has(String(stallId))) {
      return stallToBuilding.get(String(stallId)) || null;
    }

    return (m as any).building_id || null;
  };

  const ymd = (d: string) => (typeof d === "string" ? d.split("T")[0] : d);

  const isBetween = (d: string, s: string, e: string) => {
    const x = ymd(d);
    return x >= ymd(s) && x <= ymd(e);
  };

  const isLockedHeader = (h: BillingHeader): boolean => {
    const status = (h.status ?? "").toString().toLowerCase();
    if (!status) {
      return true;
    }
    return ["locked", "lock", "closed", "finalized", "1", "true"].includes(
      status,
    );
  };

  const isDateLockedFor = (
    buildingId: string | null,
    dateYmd: string,
  ): boolean => {
    if (!buildingId) return false;
    if (!billingHeaders?.length) return false;
    return billingHeaders.some(
      (h) =>
        h.building_id === buildingId &&
        isBetween(dateYmd, h.period.start, h.period.end),
    );
  };
  const isReadingLocked = (row?: Reading | null): boolean => {
    return getReadingLockInfo(row).locked;
  };
  const getReadingLockInfo = (
    row?: Reading | null,
  ): { locked: boolean; header?: BillingHeader } => {
    if (!row) return { locked: false };

    const buildingId = buildingIdForMeter(row.meter_id);
    if (!buildingId) return { locked: false };

    const dateStr = ymd(row.lastread_date);
    if (!billingHeaders || billingHeaders.length === 0) {
      return { locked: false };
    }

    const header = billingHeaders.find(
      (h) =>
        h.building_id === buildingId &&
        isLockedHeader(h) &&
        isBetween(dateStr, h.period.start, h.period.end),
    );

    return { locked: !!header, header };
  };
  const mtrNum = (id: string) => {
    const n = (id || "").replace(/\D+/g, "");
    return n ? parseInt(n, 10) : 0;
  };
  const filteredMeters = useMemo(() => {
    let arr = meters.slice();

    if (typeFilter) {
      const t = String(typeFilter).toLowerCase();
      arr = arr.filter(
        (m) => String((m as any).meter_type || "").toLowerCase() === t,
      );
    }

    if (buildingFilter) {
      const b = buildingFilter;
      arr = arr.filter((m) => {
        const direct = (m as any).building_id || null;
        const stallId =
          (m as any).stall_id ||
          (m as any).stall_no ||
          (m as any).stall_sn ||
          null;
        const viaStall = stallId ? stallToBuilding.get(String(stallId)) : null;
        return direct === b || viaStall === b;
      });
    }

    if (meterQuery && meterQuery.trim()) {
      const q = meterQuery.trim().toLowerCase();
      arr = arr.filter(
        (m) =>
          String((m as any).meter_no || "")
            .toLowerCase()
            .includes(q) ||
          String(m.meter_id || "")
            .toLowerCase()
            .includes(q),
      );
    }

    return arr.sort(
      (a, b) =>
        mtrNum(a.meter_id) - mtrNum(b.meter_id) ||
        a.meter_id.localeCompare(b.meter_id),
    );
  }, [meters, typeFilter, buildingFilter, meterQuery, stallToBuilding]);

  const buildingChipOptionsDeps = 0;

  const buildingChipOptions = useMemo(() => {
    if (isAdmin && buildings.length) {
      return [{ label: "All", value: "" }].concat(
        buildings
          .slice()
          .sort((a, b) => a.building_name.localeCompare(b.building_name))
          .map((b) => ({
            label: b.building_name || b.building_id,
            value: b.building_id,
          })),
      );
    }
    const base = [{ label: "All", value: "" }];
    if (userBuildingId)
      return base.concat([{ label: userBuildingId, value: userBuildingId }]);
    const ids = Array.from(
      new Set(stalls.map((s) => s.building_id).filter(Boolean) as string[]),
    ).sort();
    return base.concat(ids.map((id) => ({ label: id, value: id })));
  }, [isAdmin, buildings, stalls, userBuildingId]);

  const metersVisible = useMemo(() => {
    let arr = meters.slice();

    if (typeFilter) {
      const t = String(typeFilter).toLowerCase();
      arr = arr.filter((m) => String(m.meter_type || "").toLowerCase() === t);
    }

    if (buildingFilter) {
      const b = buildingFilter;
      arr = arr.filter((m) => {
        const direct = (m as any).building_id || null;
        const stallId =
          (m as any).stall_id ||
          (m as any).stall_no ||
          (m as any).stall_sn ||
          null;
        const viaStall = stallId ? stallToBuilding.get(String(stallId)) : null;
        return direct === b || viaStall === b;
      });
    }

    const q = (meterQuery || "").trim().toLowerCase();
    if (q) {
      arr = arr.filter((m) =>
        [
          m.meter_id,
          (m as any).meter_sn,
          (m as any).stall_id,
          (m as any).meter_status,
          (m as any).meter_type,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }

    return arr.sort(
      (a, b) =>
        mtrNum(a.meter_id) - mtrNum(b.meter_id) ||
        a.meter_id.localeCompare(b.meter_id),
    );
  }, [meters, typeFilter, buildingFilter, meterQuery, stallToBuilding]);
  const onCreate = async () => {
    const b = buildingIdForMeter(formMeterId);
    if (b && isDateLockedFor(b, formDate)) {
      notify(
        "Locked by billing",
        "That date is inside a locked billing period for this building.",
      );
      return;
    }
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

    if (createWarn) {
      if (!formRemarks.trim()) {
        notify(
          "Remarks required",
          "Please add remarks because the value increased by 20% or more.",
        );
        return;
      }
      const ok = await confirm(
        "Proceed with high change?",
        "The reading increased by ≥20%. Do you want to proceed?",
      );
      if (!ok) return;
    }

    if (!formImage.trim()) {
      notify(
        "Image required",
        "Your backend requires an image (base64 / data URL / hex).",
      );
      return;
    }

    let imageB64: string;
    try {
      imageB64 = await ensureSizedBase64(formImage);
    } catch (e: any) {
      notify("Image too large", e?.message || "Please choose a smaller image.");
      return;
    }

    const payload = {
      meter_id: formMeterId,
      reading_value: valueNum,
      lastread_date: formDate || todayStr(),
      remarks: formRemarks.trim() || null,
      image: imageB64,
    };

    if (!online) {
      await queueScan(payload);
      setFormValue("");
      setFormDate(todayStr());
      setFormRemarks("");
      setFormImage("");
      setCreateVisible(false);
      notify(
        "Saved offline",
        "Reading added to Offline History. Approve it when you have internet.",
      );
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
    if (isReadingLocked(row)) {
      notify(
        "Locked by billing",
        "This reading falls within a locked billing period and cannot be edited.",
      );
      return;
    }
    setEditRow(row);
    setEditMeterId(row.meter_id);
    setEditValue(String(row.reading_value));
    setEditDate(row.lastread_date);
    setEditRemarks(row.remarks ?? "");
    setEditImage("");
    setEditWarn(false);
    setEditVisible(true);
  };

  const onUpdate = async () => {
    if (editRow && isReadingLocked(editRow)) {
      notify(
        "Locked by billing",
        "This reading falls within a locked billing period and cannot be updated.",
      );
      return;
    }
    if (!canWrite || !editRow) return;

    if (editWarn) {
      if (!editRemarks.trim()) {
        notify(
          "Remarks required",
          "Please add remarks because the value increased by 20% or more.",
        );
        return;
      }
      const ok = await confirm(
        "Proceed with high change?",
        "The reading increased by ≥20%. Do you want to proceed?",
      );
      if (!ok) return;
    }

    let newImageB64: string | undefined;
    if (editImage.trim()) {
      try {
        newImageB64 = await ensureSizedBase64(editImage);
      } catch (e: any) {
        notify(
          "Image too large",
          e?.message || "Please choose a smaller image.",
        );
        return;
      }
    }

    try {
      setSubmitting(true);
      const body: any = {
        meter_id: editMeterId,
        reading_value: editValue === "" ? undefined : parseFloat(editValue),
        lastread_date: editDate,
        remarks: editRemarks.trim() === "" ? null : editRemarks.trim(),
      };
      if (newImageB64) body.image = newImageB64;
      await api.put(
        `${readingBase}/${encodeURIComponent(editRow.reading_id)}`,
        body,
      );
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
    const ok = await confirm(
      "Delete reading?",
      `Are you sure you want to delete ${target.reading_id}?`,
    );
    if (!ok) return;
    try {
      setSubmitting(true);
      await api.delete(
        `${readingBase}/${encodeURIComponent(target.reading_id)}`,
      );
      setEditVisible(false);
      await loadAll();
      notify("Deleted", `${target.reading_id} removed.`);
    } catch (err: any) {
      notify("Delete failed", errorText(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!authToken) {
    return (
      <View style={styles.screen}>
        <View
          style={[
            styles.card,
            { alignItems: "center", justifyContent: "center" },
          ]}
        >
          <Text style={styles.cardTitle}>Not logged in</Text>
          <Text style={{ marginTop: 8, color: "#64748b" }}>
            Please log in again.
          </Text>
        </View>
      </View>
    );
  }

  const syncReaderPackage = async () => {
    if (isAdmin || isOperator || isBiller) {
      notify(
        "Not for admin",
        "This Sync button is only for Reader offline workflow.",
      );
      return;
    }

    if (!online) {
      notify("Offline", "You must be online to sync (import/export).");
      return;
    }

    try {
      setSyncingPackage(true);
      const deviceToken =
        (await AsyncStorage.getItem(KEY_DEVICE_TOKEN))?.trim() || "";
      if (!deviceToken) {
        notify(
          "Missing device token",
          "This device is not registered. Ask admin to register this device serial.",
        );
        return;
      }

      if (!hasOfflinePackage) {
        const res = await api.post("/offlineExport/import", {
          device_token: deviceToken,
        });

        const pkg = res?.data?.package;
        const items = Array.isArray(pkg?.items) ? pkg.items : [];
        const importedMeters: Meter[] = items.map((it: any) => ({
          meter_id: String(it.meter_id),
          meter_type: String(
            it.classification || it.meter_type || "electric",
          ).toLowerCase() as any,
          meter_sn: String(it.meter_number || it.meter_sn || ""),
          meter_mult: 1,
          stall_id: String(it.stall_id || ""),
          meter_status: "active",
          last_updated: new Date().toISOString(),
          updated_by: "import",
        }));

        const importedReadings: Reading[] = [];

        for (const it of items) {
          const meterId = String(it.meter_id || "").trim();
          if (!meterId) continue;

          // 1) latest previous reading
          if (it.prev_date != null && it.prev_reading != null && it.prev_reading !== "") {
            importedReadings.push({
              reading_id: `IMPORT-${meterId}-${String(it.prev_date).slice(0, 10)}`,
              meter_id: meterId,
              reading_value: Number(it.prev_reading),
              read_by: "import",
              lastread_date: String(it.prev_date).slice(0, 10),
              last_updated: new Date().toISOString(),
              updated_by: "import",
              remarks: null,
            });
          }

          // 2) second latest previous reading (only if your backend sends prev2_*)
          if (it.prev2_date != null && it.prev2_reading != null && it.prev2_reading !== "") {
            importedReadings.push({
              reading_id: `IMPORT2-${meterId}-${String(it.prev2_date).slice(0, 10)}`,
              meter_id: meterId,
              reading_value: Number(it.prev2_reading),
              read_by: "import",
              lastread_date: String(it.prev2_date).slice(0, 10),
              last_updated: new Date().toISOString(),
              updated_by: "import",
              remarks: null,
            });
          }
        }

        setMeters(importedMeters);
        setStalls([]);
        setReadings(importedReadings);


        if (!formMeterId && importedMeters.length) {
          setFormMeterId(importedMeters[0].meter_id);
        }

        setHasOfflinePackage(true);
        notify(
          "Synced",
          `Imported ${importedMeters.length} meters to this device.`,
        );
        return;
      }

      if (!authToken) {
        notify("Not logged in", "Please log in again.");
        return;
      }

      await syncOfflineReadings(authToken!, deviceToken);

      setMeters([]);
      setStalls([]);
      setReadings([]);
      setBuildings([]);
      setFormMeterId("");
      setSelectedMeterId("");
      setHasOfflinePackage(false);

      notify("Synced", "Exported offline readings and cleared device data.");
    } catch (e: any) {
      notify("Sync failed", errorText(e, "Unable to sync right now."));
    } finally {
      setSyncingPackage(false);
    }
  };

  const testImageEndpoint = async () => {
    if (!readings.length) {
      notify("No readings available", "Please load some readings first.");
      return;
    }

    const testReading = readings[0];
    console.log("🧪 Testing image endpoint for:", testReading.reading_id);

    try {
      const response = await api.get(
        `${readingBase}/${testReading.reading_id}/image`,
        {
          responseType: "arraybuffer",
          headers: {
            Accept: "image/*",
          },
        },
      );

      console.log("🧪 Test response status:", response.status);
      console.log("🧪 Test data length:", response.data.byteLength);
      console.log("🧪 Response headers:", response.headers);

      if (response.data.byteLength > 0) {
        notify(
          "Backend OK",
          `Image endpoint working. Received ${response.data.byteLength} bytes.`,
        );
      } else {
        notify("Backend Warning", "Image endpoint returned empty data.");
      }
    } catch (err: any) {
      console.error("🧪 Test failed:", err);
      notify("Backend Error", errorText(err, "Image endpoint not accessible."));
    }
  };

  return (
    <View style={styles.screen}>
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
        {!isAdmin && !isOperator && !isBiller && (
          <TouchableOpacity
            style={styles.btn}
            onPress={syncReaderPackage}
            disabled={syncingPackage}
          >
            <Text style={styles.btnText}>
              {syncingPackage
                ? "Syncing..."
                : hasOfflinePackage
                  ? "Sync (Export)"
                  : "Sync (Import)"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Meter Readings</Text>
          {canWrite && (!isReader || hasOfflinePackage) && (
            <TouchableOpacity
              style={styles.btn}
              onPress={() => setCreateVisible(true)}
            >
              <Text style={styles.btnText}>+ Create Reading</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filtersBar}>
          <View style={[styles.searchWrap, { flex: 1 }]}>
            <Ionicons
              name="search"
              size={16}
              color="#94a3b8"
              style={{ marginRight: 6 }}
            />
            <TextInput
              value={meterQuery}
              onChangeText={setMeterQuery}
              placeholder="Search meters by ID, SN, stall, status…"
              placeholderTextColor="#9aa5b1"
              style={styles.search}
            />
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
        <View style={{ marginTop: 6, marginBottom: 10 }}>
          <View style={styles.buildingHeaderRow}>
            <Text style={styles.dropdownLabel}>Building</Text>
          </View>

          {isMobile ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRowHorizontal}
            >
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

        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={metersVisible}
            keyExtractor={(m) => m.meter_id}
            style={{ flex: 1 }}
            contentContainerStyle={
              metersVisible.length === 0
                ? { paddingVertical: 24 }
                : { paddingBottom: 12 }
            }
            ListEmptyComponent={
              <Text style={styles.empty}>No meters found.</Text>
            }
            renderItem={({ item }) => {
              const { latest, previous } = getLastTwo(readings, item.meter_id);
              const prevLine =
              latest
                ? `Prev: ${fmtValue(latest.reading_value)} (${String(latest.lastread_date).slice(0, 10)})`
                : "Prev: —";
              const warn =
                latest && previous
                  ? (pctUp(
                      Number(latest.reading_value),
                      Number(previous.reading_value),
                    ) ?? 0) >= 0.2
                  : false;

              return (
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
                      <Text style={styles.meterLink}>{item.meter_id}</Text> •{" "}
                      {item.meter_type.toUpperCase()}{" "}
                      {warn && (
                        <Text style={styles.warnInline}>⚠ 20%+ up</Text>
                      )}
                    </Text>
                    <Text style={styles.rowMeta}>
                      SN: {item.meter_sn} · Mult: {item.meter_mult} · Stall:{" "}
                      {item.stall_id}
                    </Text>
                    <Text style={styles.rowMetaSmall}>
                      Status: {item.meter_status.toUpperCase()}
                    </Text>
                    {latest ? (
                      <Text style={styles.rowMetaSmall}>{prevLine}</Text>
                    ) : null}
                  </View>

                  <View style={styles.rightIconWrap} pointerEvents="none">
                    {warn ? (
                      <Ionicons
                        name="warning"
                        size={22}
                        color="#f59e0b"
                        accessibilityLabel="Warning: latest reading is 20% higher than previous"
                      />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      <Modal
        visible={filtersVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setFiltersVisible(false)}
      >
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
                <Chip
                  key={label}
                  label={label}
                  active={typeFilter === (val as any)}
                  onPress={() => setTypeFilter(val as any)}
                />
              ))}
            </View>

            <Text style={[styles.dropdownLabel, { marginTop: 12 }]}>
              Sort by
            </Text>
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
                  onPress={() => setSortBy(val as any)}
                />
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
              <TouchableOpacity
                style={styles.btn}
                onPress={() => setFiltersVisible(false)}
              >
                <Text style={styles.btnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={buildingPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setBuildingPickerVisible(false)}
      >
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ width: "100%" }}
          >
            <View
              style={[
                styles.modalCard,
                Platform.OS !== "web" && {
                  maxHeight: Math.round(Dimensions.get("window").height * 0.9),
                },
              ]}
            >
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Select Building</Text>
                <TouchableOpacity
                  onPress={() => setBuildingPickerVisible(false)}
                >
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
                    <Picker.Item
                      key={opt.value || "all"}
                      label={opt.label}
                      value={opt.value}
                    />
                  ))}
                </Picker>
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.smallBtn, styles.ghostBtn]}
                  onPress={() => setBuildingPickerVisible(false)}
                >
                  <Text style={[styles.smallBtnText, styles.ghostBtnText]}>
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

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
                  onChange={(id) => {
                    setFormMeterId(id);
                    const v = Number(formValue);
                    const { latest } = getLastTwo(readings, id);
                    const p = latest ? pctUp(v, latest.reading_value) : null;
                    setCreateWarn(!!p && p >= 0.2);
                  }}
                  options={meters.map((m) => ({
                    label: `${m.meter_id} • ${m.meter_type} • ${m.meter_sn}`,
                    value: m.meter_id,
                  }))}
                />
              </View>
              <View style={styles.rowWrap}>
                <View style={{ flex: 1, marginTop: 8 }}>
                  <Text style={styles.dropdownLabel}>Reading Value</Text>
                  <TextInput
                    ref={readingInputRef}
                    style={styles.input}
                    keyboardType="numeric"
                    value={formValue}
                    onChangeText={(val) => {
                      setFormValue(val);
                      const v = Number(val);
                      const { latest } = getLastTwo(readings, formMeterId);
                      const p = latest ? pctUp(v, latest.reading_value) : null;
                      setCreateWarn(!!p && p >= 0.2);
                    }}
                    placeholder="Reading value"
                  />
                </View>
                <DatePickerField
                  label="Date read"
                  value={formDate}
                  onChange={setFormDate}
                />
              </View>

              {createWarn && (
                <View style={styles.warnBox}>
                  <Ionicons
                    name="warning-outline"
                    size={16}
                    color="#b45309"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.warnText}>
                    This value is ≥20% higher than the previous reading. Remarks
                    are required.
                  </Text>
                </View>
              )}

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>
                  Remarks {createWarn ? "(required)" : "(optional)"}{" "}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      minHeight: 44,
                      borderColor:
                        createWarn && !formRemarks.trim()
                          ? "#f59e0b"
                          : "#d9e2ec",
                    },
                  ]}
                  value={formRemarks}
                  onChangeText={setFormRemarks}
                  placeholder={
                    createWarn
                      ? "Add remarks (required due to ≥20% increase)"
                      : "Notes for this reading"
                  }
                />
              </View>

              <View style={{ marginTop: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={styles.dropdownLabel}>Image (required)</Text>
                  <TouchableOpacity onPress={() => setImgToolVisible(true)}>
                    <Text style={{ color: "#1d4ed8", fontWeight: "800" }}>
                      Open Image ⇄ Base64
                    </Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 44 }]}
                  value={formImage}
                  onChangeText={setFormImage}
                  placeholder="Paste base64 / data URL / hex"
                />
                {formImage.trim() ? (
                  <View style={{ marginTop: 8, alignItems: "flex-start" }}>
                    <RNImage
                      source={{ uri: toDataUrl(formImage) }}
                      style={{
                        width: 200,
                        height: 200,
                        borderRadius: 8,
                        backgroundColor: "#f1f5f9",
                      }}
                      resizeMode="contain"
                    />
                  </View>
                ) : null}
                <Text style={styles.helpTxtSmall}>
                  Tip: You can paste raw base64 (…AA==) or a full data URL. A
                  preview will show automatically.
                </Text>
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
                  disabled={
                    submitting ||
                    (!!buildingIdForMeter(formMeterId) &&
                      isDateLockedFor(
                        buildingIdForMeter(formMeterId)!,
                        formDate,
                      ))
                  }
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>
                      {(() => {
                        const b = buildingIdForMeter(formMeterId);
                        return b && isDateLockedFor(b, formDate)
                          ? "Locked"
                          : online
                            ? "Save Reading"
                            : "Save Offline";
                      })()}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
                  String(r.reading_value)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
              )
            : typed;
          const arr = [...searched];
          switch (sortBy) {
            case "date_asc":
              arr.sort(
                (a, b) =>
                  ts(a.lastread_date) - ts(b.lastread_date) ||
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
                  ts(b.lastread_date) - ts(a.lastread_date) ||
                  readNum(b.reading_id) - readNum(a.reading_id),
              );
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
        readingBase={readingBase}
        api={api}
        testImageEndpoint={testImageEndpoint}
        readings={readings}
        isReadingLockedFn={isReadingLocked}
        getReadingLockInfoFn={getReadingLockInfo}
      />

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
              <Text style={styles.modalTitle}>
                Update {editRow?.reading_id}
              </Text>
              <Dropdown
                label="Meter"
                value={editMeterId}
                onChange={(id) => {
                  setEditMeterId(id);
                  const v = Number(editValue);
                  const { latest, previous } = getLastTwo(readings, id);
                  const base =
                    latest &&
                    editRow &&
                    latest.meter_id === editRow.meter_id &&
                    latest.lastread_date === editRow.lastread_date
                      ? (previous?.reading_value ?? null)
                      : (latest?.reading_value ?? null);
                  const p = base != null ? pctUp(v, base) : null;
                  setEditWarn(!!p && p >= 0.2);
                }}
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
                    onChangeText={(val) => {
                      setEditValue(val);
                      const v = Number(val);
                      const { latest, previous } = getLastTwo(
                        readings,
                        editMeterId || editRow?.meter_id || "",
                      );
                      const base =
                        latest &&
                        editRow &&
                        latest.meter_id === editRow.meter_id &&
                        latest.lastread_date === editRow.lastread_date
                          ? (previous?.reading_value ?? null)
                          : (latest?.reading_value ?? null);
                      const p = base != null ? pctUp(v, base) : null;
                      setEditWarn(!!p && p >= 0.2);
                    }}
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

              {editWarn && (
                <View style={styles.warnBox}>
                  <Ionicons
                    name="warning-outline"
                    size={16}
                    color="#b45309"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.warnText}>
                    This value is ≥20% higher than the previous reading. Remarks
                    are required.
                  </Text>
                </View>
              )}

              <View style={{ marginTop: 8 }}>
                <Text style={styles.dropdownLabel}>
                  Remarks {editWarn ? "(required)" : "(optional)"}{" "}
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      minHeight: 44,
                      borderColor:
                        editWarn && !editRemarks.trim() ? "#f59e0b" : "#d9e2ec",
                    },
                  ]}
                  value={editRemarks}
                  onChangeText={setEditRemarks}
                  placeholder={
                    editWarn
                      ? "Add remarks (required due to ≥20% increase)"
                      : "Notes for this reading"
                  }
                />
              </View>

              <View style={{ marginTop: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={styles.dropdownLabel}>New Image (optional)</Text>
                  <TouchableOpacity onPress={() => setImgToolVisible(true)}>
                    <Text style={{ color: "#1d4ed8", fontWeight: "800" }}>
                      Open Image ⇄ Base64
                    </Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={[styles.input, { minHeight: 44 }]}
                  value={editImage}
                  onChangeText={setEditImage}
                  placeholder="Paste base64 / data URL / hex to replace"
                />
                {editImage.trim() ? (
                  <View style={{ marginTop: 8, alignItems: "flex-start" }}>
                    <RNImage
                      source={{ uri: toDataUrl(editImage) }}
                      style={{
                        width: 200,
                        height: 200,
                        borderRadius: 8,
                        backgroundColor: "#f1f5f9",
                      }}
                      resizeMode="contain"
                    />
                  </View>
                ) : null}
                <Text style={styles.helpTxtSmall}>
                  Leave blank to keep the current image.
                </Text>
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
                  disabled={
                    submitting || (!!editRow && isReadingLocked(editRow))
                  }
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>
                      {isReadingLocked(editRow!) ? "Locked" : "Save changes"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <HistoryModal
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        scans={filteredScans}
        onSync={onSyncOffline}
        syncing={syncing}
        markPending={markPending}
        removeScan={removeScan}
        online={online}
      />

      <ImageBase64Tool
        visible={imgToolVisible}
        onClose={() => setImgToolVisible(false)}
        onUseBase64={(b64) => {
          if (editVisible) {
            setEditImage(b64);
          } else {
            setImageError(null);
            setFormImage(b64);
            setImagePreview(`data:image/jpeg;base64,${b64}`);
            setImageSizeKB(Math.round(base64Bytes(b64) / 1024));
          }
          setImgToolVisible(false);
        }}
      />
    </View>
  );
}

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
  readingBase,
  api,
  isReadingLockedFn,
  getReadingLockInfoFn,
}: any) {
  const { width } = useWindowDimensions();
  const isMobile = width < 640;
  const total = readingsForSelected.length;
  const totalPages = Math.max(1, Math.ceil(total / 30));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * 30;
  const pageData = readingsForSelected.slice(start, start + 30);
  const [printProofVisible, setPrintProofVisible] = useState(false);
  const [printData, setPrintData] = useState<{
    reading: Reading | null;
    imageUri: string | null;
    previousReading: Reading | null;
  }>({
    reading: null,
    imageUri: null,
    previousReading: null,
  });
  const [printLoading, setPrintLoading] = useState(false);
  const [ledgerVisible, setLedgerVisible] = useState(false);
  const [ledgerStart, setLedgerStart] = useState<string>(todayStr());
  const [ledgerEnd, setLedgerEnd] = useState<string>(todayStr());

  const openPrintProof = async (reading: Reading) => {
    setPrintLoading(true);
    setPrintProofVisible(true);

    try {
      const endpoint = `${readingBase}/${encodeURIComponent(reading.reading_id)}/image`;
      console.log("🖼️ Fetching image from:", endpoint);

      const response = await api.get(endpoint, {
        responseType: "arraybuffer",
        headers: {
          Accept: "image/*",
        },
        timeout: 10000,
        validateStatus: (status: number) => status < 500,
      });

      console.log("🖼️ Image response status:", response.status);
      console.log("🖼️ Image data length:", response.data?.byteLength || 0);

      let imageUri = null;

      if (
        response.status === 200 &&
        response.data &&
        response.data.byteLength > 0
      ) {
        try {
          const uint8Array = new Uint8Array(response.data);
          let binary = "";
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
          }
          if (Platform.OS === "web") {
            const base64 = btoa(binary);
            imageUri = asDataUrl(base64);
          } else {
            imageUri = null;
          }
          if (Platform.OS !== "web") {
            notify(
              "Print Proof",
              "Image preview/printing is available on the web app.",
            );
          }
          console.log("🖼️ Image converted to data URL successfully");
        } catch (convertError) {
          console.error("❌ Error converting image to base64:", convertError);
        }
      } else if (response.status === 404) {
        console.warn(
          "🖼️ Image not found (404) for reading:",
          reading.reading_id,
        );
      } else {
        console.warn("🖼️ No image data received or empty response");
      }

      const allReadingsForMeter = readingsForSelected
        .filter((r: Reading) => r.meter_id === reading.meter_id)
        .sort(
          (a: Reading, b: Reading) => ts(b.lastread_date) - ts(a.lastread_date),
        );

      const currentIndex = allReadingsForMeter.findIndex(
        (r: Reading) => r.reading_id === reading.reading_id,
      );
      const previousReading =
        currentIndex < allReadingsForMeter.length - 1
          ? allReadingsForMeter[currentIndex + 1]
          : null;

      setPrintData({
        reading,
        imageUri,
        previousReading,
      });
    } catch (err: any) {
      console.error("❌ Error loading print data:", err);
      console.error("❌ Error details:", errorText(err));

      setPrintData({
        reading,
        imageUri: null,
        previousReading: null,
      });

      if (err.response?.status !== 404) {
        notify(
          "Warning",
          "Image not available for this reading. Other data loaded successfully.",
        );
      }
    } finally {
      setPrintLoading(false);
    }
  };

  const handlePrint = () => {
    if (Platform.OS === "web") {
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        const meter = metersById.get(printData.reading?.meter_id || "");
        const meterType = meter?.meter_type || "Unknown";
        const tenantName =
          (meter as any)?.tenant_name ||
          (meter as any)?.tenant ||
          (meter as any)?.tenant_fullname ||
          "";
        const tenantCode =
          (meter as any)?.tenant_sn ||
          (meter as any)?.tenant_id ||
          (meter as any)?.account_no ||
          "";
        const tenantLine = [tenantCode, tenantName].filter(Boolean).join(" - ");

        printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Meter Reading Proof - ${printData.reading?.reading_id}</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                margin: 20px; 
                line-height: 1.4;
              }
              .header { 
                text-align: center; 
                border-bottom: 2px solid #333; 
                padding-bottom: 10px; 
                margin-bottom: 20px;
              }
              .content { 
                display: flex; 
                flex-direction: column; 
                gap: 20px;
              }
              .reading-info { 
                background: #f5f5f5; 
                padding: 15px; 
                border-radius: 5px;
              }
              .image-section { 
                text-align: center;
              }
              .image-section img { 
                max-width: 100%; 
                max-height: 400px; 
                border: 1px solid #ddd;
              }
              .comparison { 
                display: grid; 
                grid-template-columns: 1fr 1fr; 
                gap: 20px; 
                margin-top: 20px;
              }
              .reading-card { 
                border: 1px solid #ddd; 
                padding: 15px; 
                border-radius: 5px;
              }
              .current { background: #e8f5e8; }
              .previous { background: #f0f0f0; }
              .footer { 
                text-align: center; 
                margin-top: 30px; 
                color: #666; 
                font-size: 12px;
              }
              @media print {
                body { margin: 0; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Meter Reading Proof</h1>
              ${tenantLine ? `<p>Tenant: ${tenantLine}</p>` : ""}
              <p>Generated on: ${new Date().toLocaleString()}</p>
            </div>
                        
            <div class="content">
              <div class="reading-info">
                <h2>Reading Details</h2>
                <p><strong>Reading ID:</strong> ${printData.reading?.reading_id}</p>
                <p><strong>Meter ID:</strong> ${printData.reading?.meter_id}</p>
                <p><strong>Meter Type:</strong> ${meterType.toUpperCase()}</p>
                ${tenantLine ? `<p><strong>Tenant:</strong> ${tenantLine}</p>` : ""}
                <p><strong>Date Read:</strong> ${printData.reading?.lastread_date}</p>
                <p><strong>Read By:</strong> ${printData.reading?.read_by}</p>
                ${printData.reading?.remarks ? `<p><strong>Remarks:</strong> ${printData.reading.remarks}</p>` : ""}
              </div>

              <div class="comparison">
                <div class="reading-card current">
                  <h3>Current Reading</h3>
                  <p><strong>Value:</strong> ${fmtValue(printData.reading?.reading_value)}</p>
                  <p><strong>Date:</strong> ${printData.reading?.lastread_date}</p>
                </div>
                
                <div class="reading-card previous">
                  <h3>Previous Reading</h3>
                  ${
                    printData.previousReading
                      ? `<p><strong>Value:</strong> ${fmtValue(printData.previousReading.reading_value)}</p>
                         <p><strong>Date:</strong> ${printData.previousReading.lastread_date}</p>`
                      : "<p>No previous reading available</p>"
                  }
                </div>
              </div>

              ${
                printData.imageUri
                  ? `
                <div class="image-section">
                  <h3>Meter Image</h3>
                  <img src="${printData.imageUri}" alt="Meter Reading Image" />
                </div>
              `
                  : "<p>No image available for this reading</p>"
              }
            </div>

            <div class="footer">
              <p>This is an official meter reading record. Generated automatically by the system.</p>
            </div>

            <div class="no-print" style="margin-top: 20px; text-align: center;">
              <button onclick="window.print()" style="padding: 10px 20px; font-size: 16px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                Print This Page
              </button>
              <button onclick="window.close()" style="padding: 10px 20px; font-size: 16px; background: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin-left: 10px;">
                Close
              </button>
            </div>

            <script>
              setTimeout(() => {
                window.print();
              }, 500);
            </script>
          </body>
          </html>
        `);
        printWindow.document.close();
      }
    } else {
      notify(
        "Print",
        "Print functionality is available on web platform. On mobile, you can take a screenshot of this proof.",
      );
    }
  };

  const handlePrintLedger = () => {
    if (!selectedMeterId) {
      notify("No meter", "Please select a meter first.");
      return;
    }

    const parseYmd = (val: string): Date | null => {
      const d = new Date(val);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const startDate = parseYmd(ledgerStart);
    const endDate = parseYmd(ledgerEnd);

    if (!startDate || !endDate) {
      notify(
        "Invalid dates",
        "Please enter valid start and end dates (YYYY-MM-DD).",
      );
      return;
    }
    if (startDate > endDate) {
      notify("Invalid range", "Start date must be before end date.");
      return;
    }

    const allForMeter = (readingsForSelected as Reading[])
      .filter((r: Reading) => r.meter_id === selectedMeterId)
      .slice()
      .sort(
        (a: Reading, b: Reading) =>
          new Date(a.lastread_date).getTime() -
          new Date(b.lastread_date).getTime(),
      );

    if (!allForMeter.length) {
      notify(
        "No data",
        "There are no readings for this meter in the selected range.",
      );
      return;
    }
    let lastValue: number | null = null;
    for (const row of allForMeter) {
      const d = new Date(row.lastread_date);
      if (d < startDate) {
        const v = Number(row.reading_value);
        if (!Number.isNaN(v)) {
          lastValue = v;
        }
      }
    }

    const byDate: Record<string, Reading> = {};
    for (const row of allForMeter) {
      const d = new Date(row.lastread_date);
      if (d >= startDate && d <= endDate) {
        const key = d.toISOString().slice(0, 10);
        const existing = byDate[key];
        if (
          !existing ||
          new Date(existing.lastread_date).getTime() < d.getTime()
        ) {
          byDate[key] = row;
        }
      }
    }

    type LedgerRow = {
      date: string;
      prev: string;
      current: string;
      cons: string;
      remarks: string;
    };

    const rows: LedgerRow[] = [];
    const cursor = new Date(startDate.getTime());

    while (cursor <= endDate) {
      const key = cursor.toISOString().slice(0, 10);
      const reading = byDate[key];
      const dayLabel = String(cursor.getDate());

      if (reading) {
        const currentVal = Number(reading.reading_value);
        const prevVal = lastValue;
        const consVal =
          prevVal != null && !Number.isNaN(currentVal)
            ? currentVal - prevVal
            : null;

        const prevStr = prevVal != null ? String(prevVal) : "";
        const currStr = !Number.isNaN(currentVal)
          ? String(currentVal)
          : String(reading.reading_value);
        const consStr = consVal != null ? fmtValue(consVal) : "";
        let remarks = reading.remarks || "";

        if (!remarks && consVal != null && prevVal != null && prevVal > 0) {
          const pct = consVal / prevVal;
          if (pct >= 0.2) {
            remarks = "high cons";
          }
        }

        rows.push({
          date: dayLabel,
          prev: prevStr,
          current: currStr,
          cons: consStr,
          remarks,
        });

        if (!Number.isNaN(currentVal)) {
          lastValue = currentVal;
        }
      } else {
        rows.push({
          date: dayLabel,
          prev: "",
          current: "",
          cons: "",
          remarks: "",
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    if (Platform.OS === "web" && typeof window !== "undefined") {
      const meter = metersById.get ? metersById.get(selectedMeterId) : null;
      const meterType = String(
        (meter as any)?.meter_type || "Meter",
      ).toUpperCase();

      const tenantName =
        (meter as any)?.tenant_name ||
        (meter as any)?.tenant ||
        (meter as any)?.tenant_fullname ||
        "";
      const tenantCode =
        (meter as any)?.tenant_sn ||
        (meter as any)?.tenant_id ||
        (meter as any)?.account_no ||
        selectedMeterId;
      const tenantLine = [tenantCode, tenantName].filter(Boolean).join(" ");

      const rowsHtml = rows
        .map(
          (r) => `
          <tr>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-align:center;">${r.date}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-align:right;">${r.prev}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-align:right;">${r.current}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;text-align:right;">${r.cons}</td>
            <td style="border:1px solid #d1d5db;padding:4px 6px;">${r.remarks}</td>
          </tr>
        `,
        )
        .join("");

      const w = window.open("", "_blank");
      if (!w) {
        notify("Popup blocked", "Please allow popups to print the ledger.");
        return;
      }

      w.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charSet="utf-8" />
          <title>Tenant Meter Reading Ledger</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 20px;
              color: #111827;
            }
            .wrap {
              max-width: 900px;
              margin: 0 auto;
            }
            .header {
              margin-bottom: 12px;
            }
            .header h1 {
              font-size: 18px;
              margin: 0 0 4px 0;
            }
            .header p {
              margin: 2px 0;
              font-size: 13px;
            }
            table {
              border-collapse: collapse;
              width: 100%;
              font-size: 12px;
            }
            th {
              border: 1px solid #d1d5db;
              background: #f3f4f6;
              padding: 4px 6px;
              text-align: center;
            }
            td {
              font-size: 12px;
            }
            .no-print {
              margin-top: 16px;
              text-align: center;
            }
            @media print {
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="header">
              <h1>Tenant Meter Reading Ledger</h1>
              <p>${meterType}</p>
              <p>${tenantLine}</p>
              <p>From ${ledgerStart} to ${ledgerEnd}</p>
            </div>

            <table>
              <thead>
                <tr>
                  <th style="width:50px;">Date</th>
                  <th>Previous</th>
                  <th>Current</th>
                  <th>Cons</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>

            <div class="no-print">
              <button onclick="window.print()" style="padding:8px 16px;border-radius:4px;border:0;background:#2563eb;color:white;cursor:pointer;">
                Print Ledger
              </button>
            </div>
          </div>

          <script>
            setTimeout(function () { window.print(); }, 500);
          </script>
        </body>
        </html>
      `);
      w.document.close();
    } else {
      notify("Print", "Ledger printing is available on the web version.");
    }

    setLedgerVisible(false);
  };
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
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
          <FlatList
            data={pageData}
            keyExtractor={(item) => item.reading_id}
            contentContainerStyle={{ paddingBottom: 12 }}
            ListEmptyComponent={
              <Text style={styles.empty}>No readings for this meter.</Text>
            }
            renderItem={({ item }) => {
              const { locked, header } = getReadingLockInfoFn(item);

              return (
                <View
                  style={[styles.listRow, isMobile && styles.listRowMobile]}
                >
                  <View style={{ flex: 1 }}>
                    {isMobile ? (
                      <>
                        <Text style={styles.rowTitle}>
                          <Text style={styles.meterLink}>
                            {item.reading_id}
                          </Text>{" "}
                          • <Text>{item.lastread_date}</Text>
                        </Text>
                        <Text style={styles.rowSub}>
                          Value: {fmtValue(item.reading_value)}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.rowTitle}>{item.reading_id}</Text>
                        <Text style={styles.rowSub}>
                          {item.lastread_date} • Value:{" "}
                          {fmtValue(item.reading_value)}
                        </Text>
                      </>
                    )}

                    {locked && (
                      <View style={styles.lockBadge}>
                        <Text style={styles.lockBadgeText}>
                          🔒 Locked (Billing {header?.period?.start ?? "?"} →{" "}
                          {header?.period?.end ?? "?"})
                        </Text>
                      </View>
                    )}

                    <Text style={styles.rowSubSmall}>
                      Updated {formatDateTime(item.last_updated)} by{" "}
                      {item.updated_by}
                    </Text>
                  </View>

                  {!locked && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionBtnGhost]}
                      onPress={() => openEdit(item)}
                    >
                      <Text style={styles.actionBtnGhostText}>Update</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnGhost]}
                    onPress={() => openPrintProof(item)}
                  >
                    <Text style={styles.actionBtnGhostText}>Print Proof</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnDanger]}
                    onPress={() => onDelete(item)}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.actionBtnText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            }}
            ListHeaderComponent={
              <>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text style={styles.modalTitle}>
                    Readings for{" "}
                    <Text style={styles.meterLink}>
                      {selectedMeterId || "—"}
                    </Text>
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnGhost]}
                      onPress={() => setLedgerVisible(true)}
                    >
                      <Text style={styles.btnGhostText}>Print Ledger</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.btnGhost]}
                      onPress={onClose}
                    >
                      <Text style={styles.btnGhostText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={[styles.searchWrap, { marginTop: 8 }]}>
                  <Ionicons
                    name="search"
                    size={16}
                    color="#94a3b8"
                    style={{ marginRight: 6 }}
                  />
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

                <Text style={[styles.dropdownLabel, { marginTop: 8 }]}>
                  Sort readings
                </Text>
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
              </>
            }
          />

          <Modal
            visible={ledgerVisible}
            animationType="fade"
            transparent
            onRequestClose={() => setLedgerVisible(false)}
          >
            <View style={styles.promptOverlay}>
              <View style={styles.promptCard}>
                <Text style={styles.modalTitle}>Print Ledger</Text>
                <View style={styles.modalDivider} />
                <Text style={[styles.dropdownLabel, { marginTop: 4 }]}>
                  Start date (YYYY-MM-DD)
                </Text>
                <TextInput
                  value={ledgerStart}
                  onChangeText={setLedgerStart}
                  style={styles.input}
                  placeholder="2025-01-01"
                />
                <Text style={[styles.dropdownLabel, { marginTop: 8 }]}>
                  End date (YYYY-MM-DD)
                </Text>
                <TextInput
                  value={ledgerEnd}
                  onChangeText={setLedgerEnd}
                  style={styles.input}
                  placeholder="2025-01-31"
                />
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    marginTop: 16,
                    gap: 8,
                  }}
                >
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGhost]}
                    onPress={() => setLedgerVisible(false)}
                  >
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.btn}
                    onPress={handlePrintLedger}
                  >
                    <Text style={styles.btnText}>
                      {Platform.OS === "web" ? "Print Ledger" : "Generate"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <Modal
            visible={printProofVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setPrintProofVisible(false)}
          >
            <View style={styles.modalWrap}>
              <View
                style={[styles.modalCard, { maxWidth: 800, maxHeight: "90%" }]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Print Reading Proof</Text>
                  <TouchableOpacity onPress={() => setPrintProofVisible(false)}>
                    <Ionicons name="close" size={24} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ padding: 16 }}
                >
                  {printLoading ? (
                    <View style={{ padding: 40, alignItems: "center" }}>
                      <ActivityIndicator size="large" color="#2563eb" />
                      <Text style={{ marginTop: 16, color: "#64748b" }}>
                        Loading print data...
                      </Text>
                    </View>
                  ) : printData.reading ? (
                    <View style={styles.printProofContent}>
                      <View style={styles.printHeader}>
                        <Text style={styles.printTitle}>
                          Meter Reading Proof
                        </Text>
                        <Text style={styles.printSubtitle}>
                          Generated on: {new Date().toLocaleString()}
                        </Text>
                      </View>

                      <View style={styles.printSection}>
                        <Text style={styles.sectionTitle}>Reading Details</Text>
                        <View style={styles.detailsGrid}>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Reading ID:</Text>
                            <Text style={styles.detailValue}>
                              {printData.reading.reading_id}
                            </Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Meter ID:</Text>
                            <Text style={styles.detailValue}>
                              {printData.reading.meter_id}
                            </Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Meter Type:</Text>
                            <Text style={styles.detailValue}>
                              {metersById
                                .get(printData.reading.meter_id)
                                ?.meter_type.toUpperCase() || "Unknown"}
                            </Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Date Read:</Text>
                            <Text style={styles.detailValue}>
                              {printData.reading.lastread_date}
                            </Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Read By:</Text>
                            <Text style={styles.detailValue}>
                              {printData.reading.read_by}
                            </Text>
                          </View>
                          {printData.reading.remarks && (
                            <View style={styles.detailItem}>
                              <Text style={styles.detailLabel}>Remarks:</Text>
                              <Text style={styles.detailValue}>
                                {printData.reading.remarks}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      <View style={styles.printSection}>
                        <Text style={styles.sectionTitle}>
                          Reading Comparison
                        </Text>
                        <View style={styles.comparisonGrid}>
                          <View
                            style={[styles.readingCard, styles.currentReading]}
                          >
                            <Text style={styles.cardTitle}>
                              Current Reading
                            </Text>
                            <Text style={styles.readingValue}>
                              {fmtValue(printData.reading.reading_value)}
                            </Text>
                            <Text style={styles.readingDate}>
                              Date: {printData.reading.lastread_date}
                            </Text>
                          </View>

                          <View
                            style={[styles.readingCard, styles.previousReading]}
                          >
                            <Text style={styles.cardTitle}>
                              Previous Reading
                            </Text>
                            {printData.previousReading ? (
                              <>
                                <Text style={styles.readingValue}>
                                  {fmtValue(
                                    printData.previousReading.reading_value,
                                  )}
                                </Text>
                                <Text style={styles.readingDate}>
                                  Date:{" "}
                                  {printData.previousReading.lastread_date}
                                </Text>
                              </>
                            ) : (
                              <Text style={styles.noData}>
                                No previous reading available
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>

                      <View style={styles.printSection}>
                        <Text style={styles.sectionTitle}>Meter Image</Text>
                        {printData.imageUri ? (
                          <View style={styles.imageContainer}>
                            <RNImage
                              source={{ uri: printData.imageUri }}
                              style={styles.proofImage}
                              resizeMode="contain"
                              onError={(error) => {
                                console.error(
                                  "❌ Image loading error:",
                                  error.nativeEvent.error,
                                );
                                setPrintData((prev) => ({
                                  ...prev,
                                  imageUri: null,
                                }));
                              }}
                              onLoad={() =>
                                console.log("✅ Image loaded successfully")
                              }
                            />
                          </View>
                        ) : (
                          <View style={styles.noImageContainer}>
                            <Ionicons
                              name="image-outline"
                              size={48}
                              color="#94a3b8"
                            />
                            <Text style={styles.noData}>
                              No image available for this reading
                            </Text>
                            <Text
                              style={[
                                styles.noData,
                                { fontSize: 12, marginTop: 8 },
                              ]}
                            >
                              The image may not have been uploaded or the
                              endpoint is not available.
                            </Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.printFooter}>
                        <Text style={styles.footerText}>
                          This is an official meter reading record. Generated
                          automatically by the system.
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.noData}>No reading data available</Text>
                  )}
                </ScrollView>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGhost]}
                    onPress={() => setPrintProofVisible(false)}
                  >
                    <Text style={styles.btnGhostText}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btn} onPress={handlePrint}>
                    <Text style={styles.btnText}>
                      {Platform.OS === "web" ? "Print" : "Save as PDF"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function HistoryModal({
  visible,
  onClose,
  scans,
  onSync,
  syncing,
  markPending,
  removeScan,
  online,
}: any) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
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
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Offline History</Text>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  scans.length ? null : styles.actionBtnDisabled,
                ]}
                disabled={!scans.length || syncing || !online}
                onPress={onSync}
              >
                {syncing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.actionBtnText}>
                    {online ? "Sync" : "Offline"}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnGhost]}
                onPress={onClose}
              >
                <Text style={styles.actionBtnGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={scans}
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
                    Value: {Number(item.reading_value).toFixed(2)} • Date:{" "}
                    {item.lastread_date}
                  </Text>
                  <Text style={styles.rowSubSmall}>
                    Saved: {new Date(item.createdAt).toLocaleString()}
                  </Text>
                  {!!item.remarks && (
                    <Text style={styles.rowSubSmall}>
                      Remarks: {item.remarks}
                    </Text>
                  )}

                  <View style={styles.badgesRow}>
                    {(item.status === "pending" ||
                      item.status === "failed") && (
                      <Text
                        style={[
                          styles.statusBadge,
                          item.status === "pending"
                            ? styles.statusPending
                            : styles.statusFailed,
                        ]}
                      >
                        {item.status === "pending" ? "Pending" : "Failed"}
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
  );
}

function ImageBase64Tool({
  visible,
  onClose,
  onUseBase64,
}: {
  visible: boolean;
  onClose: () => void;
  onUseBase64: (b64: string) => void;
}) {
  const [tab, setTab] = React.useState<"quick" | "paste">("quick");
  const [mime, setMime] = React.useState<string>("image/jpeg");
  const [base64, setBase64] = React.useState<string>("");
  const [dataUrl, setDataUrl] = React.useState<string>("");
  const [paste, setPaste] = React.useState<string>("");
  const [busy, setBusy] = React.useState<boolean>(false);

  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const openFilePickerWeb = () => {
    if (Platform.OS === "web") fileRef.current?.click?.();
  };

  React.useEffect(() => {
    if (!visible) return;
    setTab("quick");
    setBusy(false);
  }, [visible]);

  const applyB64 = async (rawB64: string, nextMime?: string) => {
    const mm = (nextMime || mime || "image/jpeg").trim() || "image/jpeg";
    const clean = (rawB64 || "").replace(/\s+/g, "");
    if (!clean) return;
    try {
      setBusy(true);
      const sized = await ensureSizedBase64(clean, mm);
      setMime(mm);
      setBase64(sized);
      setDataUrl(asDataUrl(sized, mm));
      setPaste(asDataUrl(sized, mm));
      notify("Ready", "Preview generated. Tap 'Use in Form' to attach it.");
    } catch (e: any) {
      notify("Image too large", e?.message || "Please choose a smaller image.");
    } finally {
      setBusy(false);
    }
  };

  const onPickFileWeb = (e: any) => {
    const f = e?.target?.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      const raw = comma >= 0 ? result.slice(comma + 1) : result;
      await applyB64(raw, f.type || "image/jpeg");
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  };

  const pickFromLibrary = async () => {
    if (Platform.OS === "web") {
      openFilePickerWeb();
      return;
    }
    try {
      setBusy(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        notify("Permission needed", "Please allow photo library access.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: false,
        allowsEditing: true,
      });
      if ((res as any).canceled) return;
      const asset = (res as any).assets?.[0];
      if (!asset?.uri) {
        notify("Failed", "No photo captured.");
        return;
      }

      const compressedB64 = await compressUriToSizedBase64Native(asset.uri);
      await applyB64(compressedB64, "image/jpeg");
    } catch (e: any) {
      notify("Failed", e?.message || "Unable to pick photo.");
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    if (Platform.OS === "web") {
      openFilePickerWeb();
      return;
    }
    try {
      setBusy(true);
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        notify("Permission needed", "Please allow camera access.");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        quality: 0.6,
        base64: false,
        allowsEditing: true,
      });
      if ((res as any).canceled) return;
      const asset = (res as any).assets?.[0];
      const b64 = asset?.base64;
      if (!b64) {
        notify("Failed", "No base64 returned. Please try again.");
        return;
      }
      await applyB64(b64, asset?.mimeType || "image/jpeg");
    } catch (e: any) {
      notify("Failed", e?.message || "Unable to take photo.");
    } finally {
      setBusy(false);
    }
  };

  const decodePaste = async () => {
    const str = (paste || "").trim();
    if (!str) {
      notify("Empty", "Paste a base64 or data URL first.");
      return;
    }
    if (str.startsWith("data:")) {
      const comma = str.indexOf(",");
      const header = comma >= 0 ? str.slice(0, comma) : "";
      const raw = comma >= 0 ? str.slice(comma + 1) : "";
      const m = header.includes(";") ? header.slice(5).split(";")[0] : mime;
      await applyB64(raw, m || mime);
      return;
    }
    await applyB64(str, mime);
  };

  const copyBase64ToClipboard = async () => {
    try {
      if (!base64) return;
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

  const clearAll = () => {
    setBase64("");
    setDataUrl("");
    setPaste("");
    setMime("image/jpeg");
  };

  const sizeKB = base64 ? Math.round(base64Bytes(base64) / 1024) : 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalWrap}
      >
        <View style={styles.modalCardWide}>
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>Attach meter photo</Text>
              <Text style={styles.helpTxtSmall}>
                Take a photo or choose one — it auto-converts to base64.
              </Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnGhost]}
                onPress={onClose}
              >
                <Text style={styles.actionBtnGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 8,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <TouchableOpacity
              style={[
                styles.smallBtn,
                tab === "quick" ? styles.smallBtn : styles.ghostBtn,
              ]}
              onPress={() => setTab("quick")}
            >
              <Text
                style={
                  tab === "quick"
                    ? styles.smallBtnText
                    : [styles.smallBtnText, styles.ghostBtnText]
                }
              >
                Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.smallBtn,
                tab === "paste" ? styles.smallBtn : styles.ghostBtn,
              ]}
              onPress={() => setTab("paste")}
            >
              <Text
                style={
                  tab === "paste"
                    ? styles.smallBtnText
                    : [styles.smallBtnText, styles.ghostBtnText]
                }
              >
                Paste base64
              </Text>
            </TouchableOpacity>
          </View>

          {Platform.OS === "web" && (
            <input
              ref={fileRef as any}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={onPickFileWeb}
            />
          )}

          {tab === "quick" ? (
            <>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <TouchableOpacity
                  style={[styles.btn, busy && styles.btnDisabled]}
                  onPress={takePhoto}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Take Photo</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.btn,
                    styles.btnGhost,
                    busy && styles.btnDisabled,
                  ]}
                  onPress={pickFromLibrary}
                  disabled={busy}
                >
                  <Text style={styles.btnGhostText}>Choose Photo</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={clearAll}
                >
                  <Text style={styles.btnGhostText}>Clear</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 14 }}>
                <Text style={styles.dropdownLabel}>Preview</Text>

                <View
                  style={{
                    marginTop: 8,
                    borderWidth: 1,
                    borderColor: "#e2e8f0",
                    borderRadius: 12,
                    padding: 12,
                    backgroundColor: "#f8fafc",
                  }}
                >
                  {dataUrl ? (
                    <RNImage
                      source={{ uri: dataUrl }}
                      style={{
                        width: "100%",
                        height: 260,
                        borderRadius: 10,
                        backgroundColor: "#fff",
                      }}
                      resizeMode="contain"
                    />
                  ) : (
                    <View
                      style={{
                        height: 260,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="image-outline"
                        size={48}
                        color="#94a3b8"
                      />
                      <Text style={[styles.helpTxtSmall, { marginTop: 8 }]}>
                        No image selected yet.
                      </Text>
                    </View>
                  )}

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 10,
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <Text style={styles.helpTxtSmall}>
                      {base64
                        ? `Size: ${sizeKB} KB (max ${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB)`
                        : "Pick a photo to see size."}
                    </Text>

                    <View
                      style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                    >
                      <TouchableOpacity
                        style={[styles.smallBtn, styles.ghostBtn]}
                        onPress={copyBase64ToClipboard}
                        disabled={!base64}
                      >
                        <Text
                          style={[styles.smallBtnText, styles.ghostBtnText]}
                        >
                          Copy
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.smallBtn, !base64 && styles.btnDisabled]}
                        disabled={!base64}
                        onPress={() => {
                          onUseBase64(base64);
                          onClose();
                        }}
                      >
                        <Text style={styles.smallBtnText}>Use in Form</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.dropdownLabel}>MIME type</Text>
              <View style={styles.pickerWrapper}>
                <Picker
                  selectedValue={mime}
                  onValueChange={(v) => setMime(String(v))}
                >
                  {["image/jpeg", "image/png", "image/webp"].map((m) => (
                    <Picker.Item key={m} label={m} value={m} />
                  ))}
                </Picker>
              </View>

              <Text style={[styles.dropdownLabel, { marginTop: 10 }]}>
                Paste base64 or full data URL
              </Text>
              <TextInput
                multiline
                value={paste}
                onChangeText={setPaste}
                placeholder="Paste base64 (…AA==) or data URL (data:image/png;base64,…) here"
                style={[styles.input, { minHeight: 140 }]}
              />

              <View
                style={{
                  flexDirection: "row",
                  gap: 10,
                  flexWrap: "wrap",
                  marginTop: 10,
                }}
              >
                <TouchableOpacity
                  style={[styles.btn, busy && styles.btnDisabled]}
                  onPress={decodePaste}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Decode / Preview</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost]}
                  onPress={clearAll}
                >
                  <Text style={styles.btnGhostText}>Clear</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 14 }}>
                <Text style={styles.dropdownLabel}>Preview</Text>

                <View
                  style={{
                    marginTop: 8,
                    borderWidth: 1,
                    borderColor: "#e2e8f0",
                    borderRadius: 12,
                    padding: 12,
                    backgroundColor: "#f8fafc",
                  }}
                >
                  {dataUrl ? (
                    <RNImage
                      source={{ uri: dataUrl }}
                      style={{
                        width: "100%",
                        height: 260,
                        borderRadius: 10,
                        backgroundColor: "#fff",
                      }}
                      resizeMode="contain"
                    />
                  ) : (
                    <View
                      style={{
                        height: 260,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="image-outline"
                        size={48}
                        color="#94a3b8"
                      />
                      <Text style={[styles.helpTxtSmall, { marginTop: 8 }]}>
                        No preview yet.
                      </Text>
                    </View>
                  )}

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 10,
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <Text style={styles.helpTxtSmall}>
                      {base64
                        ? `Size: ${sizeKB} KB (max ${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB)`
                        : "Decode to see size."}
                    </Text>

                    <TouchableOpacity
                      style={[styles.smallBtn, !base64 && styles.btnDisabled]}
                      disabled={!base64}
                      onPress={() => {
                        onUseBase64(base64);
                        onClose();
                      }}
                    >
                      <Text style={styles.smallBtnText}>Use in Form</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCardWide: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    width: "100%",
    maxWidth: 960,
    height: "95%",
  },

  modalTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  pageBar: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
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

  actionBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2563eb",
  },
  actionBtnGhost: { backgroundColor: "#e0ecff" },
  actionBtnDanger: { backgroundColor: "#ef4444" },
  actionBtnText: { fontWeight: "700", color: "#fff" },
  actionBtnGhostText: { color: "#1d4ed8", fontWeight: "700" },
  actionBtnDisabled: { opacity: 0.5, backgroundColor: "#e2e8f0" },
  pageBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fff",
  },
  pageBtnText: { fontSize: 14, fontWeight: "700", color: "#102a43" },
  pageBtnDisabled: { opacity: 0.5 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  search: { flex: 1, fontSize: 14, color: "#0b1f33" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },
  loader: { paddingVertical: 24, alignItems: "center" },
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
  screen: { flex: 1, minHeight: 0, padding: 12, backgroundColor: "#f8fafc" },
  infoBar: {
    padding: 10,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
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
    backgroundColor: "#082cac",
  },
  historyBtnText: { color: "#fff", fontWeight: "800" },

  card: {
    flex: 1,
    minHeight: 0,
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
    ...(Platform.select({
      web: { boxShadow: "0 10px 30px rgba(2,6,23,0.06)" as any },
      default: { elevation: 2 },
    }) as any),
  },
  cardHeader: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: "900", color: "#0f172a" },
  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
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
  filtersBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  buildingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
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
  rightIconWrap: {
    width: 28,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
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
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalDivider: { height: 1, backgroundColor: "#edf2f7", marginVertical: 8 },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
  },
  smallBtn: {
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  smallBtnText: { fontSize: 13, fontWeight: "800" },
  ghostBtn: {
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  ghostBtnText: { color: "#1f2937" },
  dropdownLabel: {
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
    textTransform: "none",
  },
  pickerWrapper: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  picker: { height: 50 },
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
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  headerActions: { flexDirection: "row", gap: 8 },

  centerText: {
    textAlign: "center",
    width: "100%",
    color: "#082cac",
    fontWeight: "900",
    fontSize: 15,
    marginLeft: 75,
  },

  historyRow: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 12,
    backgroundColor: "#fff",
    ...(Platform.select({
      web: { boxShadow: "0 2px 8px rgba(0,0,0,0.06)" } as any,
      default: { elevation: 1 },
    }) as any),
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
  badge: {
    backgroundColor: "#bfbfbfff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
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

  rowWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    flexWrap: "wrap",
  },

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
  warnBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f59e0b66",
    backgroundColor: "#fffbeb",
    flexDirection: "row",
    alignItems: "flex-start",
  },
  warnText: { color: "#92400e", fontSize: 13, flex: 1 },
  warnInline: {
    color: "#b45309",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    marginLeft: 6,
  },
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
  printProofContent: {
    flex: 1,
    gap: 16,
  },
  printHeader: {
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "#333",
    paddingBottom: 10,
    marginBottom: 10,
  },
  printTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  printSubtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 4,
  },
  printSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  detailsGrid: {
    backgroundColor: "#f5f5f5",
    padding: 15,
    borderRadius: 5,
    gap: 8,
  },
  detailItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontWeight: "bold",
    color: "#333",
    flex: 1,
  },
  detailValue: {
    color: "#666",
    flex: 2,
  },
  comparisonGrid: {
    flexDirection: "row",
    gap: 16,
  },
  readingCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 15,
    borderRadius: 5,
  },
  currentReading: {
    backgroundColor: "#e8f5e8",
  },
  previousReading: {
    backgroundColor: "#f0f0f0",
  },
  readingValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#2563eb",
    marginBottom: 4,
  },
  readingDate: {
    fontSize: 14,
    color: "#666",
  },
  imageContainer: {
    alignItems: "center",
  },
  proofImage: {
    width: "100%",
    height: 300,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },
  printFooter: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    alignItems: "center",
  },
  footerText: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
  noData: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    padding: 20,
  },
  noImageContainer: {
    alignItems: "center",
    padding: 20,
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "dashed",
  },
  lockBadge: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
    backgroundColor: "#fee2e2",
  },
  lockBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#b91c1c",
  },
});