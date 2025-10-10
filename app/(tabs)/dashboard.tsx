import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import axios, { AxiosError } from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { BASE_API } from "../../constants/api";
import { useAuth } from "../../contexts/AuthContext";

// ---- Types ----
type CountKey =
  | "buildings"
  | "tenants"
  | "stalls"
  | "meters"
  | "rates"
  | "readings";

type Role = "admin" | "operator" | "biller" | "unknown";

type Counts = Partial<Record<CountKey, number>>;

type TileState = {
  label: string;
  key: CountKey;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  restricted?: boolean;
};

// ---- Helpers ----
function decodeRole(token: string | null): { role: Role; buildingId?: string } {
  if (!token) return { role: "unknown" };
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(jsonPayload);
    const role = String(
      payload.user_level || payload.role || "unknown"
    ).toLowerCase() as Role;
    const buildingId = payload.building_id || payload.buildingId || undefined;
    if (role === "admin" || role === "operator" || role === "biller")
      return { role, buildingId };
    return { role: "unknown" };
  } catch {
    return { role: "unknown" };
  }
}

function makeApi(token: string | null) {
  const api = axios.create({ baseURL: BASE_API });
  api.interceptors.request.use((cfg) => {
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    return cfg;
  });
  return api;
}

async function safeCount(
  api: ReturnType<typeof makeApi>,
  path: string
): Promise<{ count?: number; restricted?: boolean }> {
  try {
    const res = await api.get(path);
    const data = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.rows)
      ? res.data.rows
      : [];
    return { count: data.length };
  } catch (e) {
    const err = e as AxiosError;
    if (
      err.response &&
      (err.response.status === 401 || err.response.status === 403)
    ) {
      return { restricted: true };
    }
    return { count: 0 };
  }
}

// after makeApi / safeCount …

async function countRates(
  api: ReturnType<typeof makeApi>,
  role: "admin" | "operator" | "biller" | "unknown",
  buildingId?: string
) {
  // biller/operator: count rates in their building
  if (role !== "admin" && buildingId) {
    return await safeCount(api, `/rates/buildings/${encodeURIComponent(buildingId)}`);
  }

  // admin: sum across all buildings
  try {
    const bRes = await api.get("/buildings");
    let total = 0;
    for (const b of bRes.data || []) {
      const r = await api.get(`/rates/buildings/${encodeURIComponent(b.building_id)}`);
      total += Array.isArray(r.data) ? r.data.length : 0;
    }
    return { count: total };
  } catch {
    return { count: 0 };
  }
}


export default function Dashboard() {
  const router = useRouter();
  const { token } = useAuth();
  const { role } = useMemo(() => decodeRole(token), [token]);
  const api = useMemo(() => makeApi(token), [token]);

  const [busy, setBusy] = useState(true);
  const [counts, setCounts] = useState<Counts>({});
  const [restrictions, setRestrictions] = useState<Record<CountKey, boolean>>({
    buildings: false,
    tenants: false,
    stalls: false,
    meters: false,
    rates: false,
    readings: false,
  });

  const wantedTiles: TileState[] = useMemo(() => {
    const base: TileState[] = [
      {
        key: "buildings",
        label: "Buildings",
        color: "#0ea5e9",
        icon: "business",
      },
      { key: "tenants", label: "Tenants", color: "#22c55e", icon: "people" },
      { key: "stalls", label: "Stalls", color: "#f59e0b", icon: "storefront" },
      { key: "meters", label: "Meters", color: "#ef4444", icon: "speedometer" },
      { key: "rates", label: "Rates", color: "#8b5cf6", icon: "pricetag" },
      {
        key: "readings",
        label: "Readings",
        color: "#06b6d4",
        icon: "document-text",
      },
    ];

    if (role === "admin") return base;

    if (role === "operator") {
      return base.filter((t) =>
        ["tenants", "stalls", "meters", "readings"].includes(t.key)
      );
    }

    if (role === "biller") {
      return base.filter((t) => ["tenants", "rates"].includes(t.key));
    }

    return base;
  }, [role]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!token) {
        setBusy(false);
        return;
      }
      setBusy(true);
      const nextCounts: Counts = {};
      const nextRestr: Record<CountKey, boolean> = {
        buildings: false,
        tenants: false,
        stalls: false,
        meters: false,
        rates: false,
        readings: false,
      };

      const tasks = wantedTiles.map(async (t) => {
        if (t.key === "rates") {
          const { count, restricted } = await countRates(api, role as any, decodeRole(token).buildingId);
          if (!alive) return;
          if (typeof count === "number") nextCounts[t.key] = count;
          if (restricted) nextRestr[t.key] = true;
          return;
        }

        const { count, restricted } = await safeCount(api, `/${t.key}`);
        if (!alive) return;
        if (typeof count === "number") nextCounts[t.key] = count;
        if (restricted) nextRestr[t.key] = true;
      });

      await Promise.all(tasks);
      if (!alive) return;
      setCounts(nextCounts);
      setRestrictions(nextRestr);
      setBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [token, role]);

  const openPanel = (key: CountKey) => {
    router.push({ pathname: "/(tabs)/admin", params: { panel: key } });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Dashboard</Text>

      {busy && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      )}

      <View style={styles.grid}>
        {wantedTiles.map((t) => {
          const value = counts[t.key];
          const restricted = restrictions[t.key];
          return (
            <TouchableOpacity
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={`Open ${t.label} panel`}
              disabled={restricted}
              onPress={() => openPanel(t.key)}
              activeOpacity={0.7}
              style={[styles.tile, restricted && { opacity: 0.6 }]}
            >
              <View
                style={[styles.iconBubble, { backgroundColor: t.color + "1A" }]}
              >
                <Ionicons name={t.icon} size={20} color={t.color} />
              </View>
              <Text style={styles.tileLabel}>{t.label}</Text>
              <Text style={styles.tileValue}>
                {restricted ? "—" : typeof value === "number" ? value : 0}
              </Text>
              {restricted && (
                <View style={styles.restrictBadge}>
                  <Ionicons name="lock-closed" size={12} />
                  <Text style={styles.restrictText}>Restricted</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.legend}>
        Tap a tile to open its panel. “—” means your role can’t view that list
        or the server denied access.
      </Text>

      {!busy &&
        Object.keys(counts).length > 0 &&
        Object.values(counts).every((v) => v === 0) && (
          <View style={styles.helpBox}>
            <Ionicons name="information-circle" size={18} />
            <Text style={styles.helpText}>
              If you expected numbers here, check your role or login again. Some
              tiles are admin- or operator-only.
            </Text>
          </View>
        )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  heading: {
    fontSize: 24,
    fontWeight: "800",
    color: "#102a43",
    marginBottom: 4,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: { color: "#6b7280" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  tile: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#eef2f7",
    alignItems: "flex-start",
    gap: 6,
    ...(Platform.select({
      web: { boxShadow: "0 6px 18px rgba(16,42,67,0.05)" as any },
      default: { elevation: 1 },
    }) as any),
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  tileLabel: { color: "#6b7280", fontSize: 12, fontWeight: "600" },
  tileValue: { color: "#102a43", fontSize: 28, fontWeight: "800" },
  restrictBadge: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  restrictText: { fontSize: 11, color: "#374151", fontWeight: "600" },
  legend: { marginTop: 6, color: "#6b7280", fontSize: 12 },
  helpBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  helpText: { color: "#374151" },
});