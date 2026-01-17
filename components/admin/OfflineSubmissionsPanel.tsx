import React, { useEffect, useMemo, useState } from "react";
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
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

type Submission = {
  id: number;
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

function toText(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  try {
    return JSON.stringify(v);
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

const dateOf = (s?: string) => (s ? Date.parse(s) || 0 : 0);

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
  const { token, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const api = useMemo(() => {
    return axios.create({
      baseURL: BASE_API,
      timeout: 25000,
      headers: { Authorization: `Bearer ${token ?? ""}` },
    });
  }, [token]);

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [items, setItems] = useState<Submission[]>([]);
  const [error, setError] = useState<string>("");

  // Lookups for building chips + mapping meter->building
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [meterToBuilding, setMeterToBuilding] = useState<Map<string, string>>(
    () => new Map(),
  );

  // UI / filters (match StallsPanel behavior)
  const [buildingFilter, setBuildingFilter] = useState<string>(""); // default empty -> force select to show list
  type SortMode = "newest" | "oldest";
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filtersVisible, setFiltersVisible] = useState(false);

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
      const msg =
        pickMessage(e?.response?.data) ||
        e?.message ||
        "Failed to load pending submissions.";
      setError(toText(msg));
      setItems([]);
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

      // Optional: auto-pick first building if none selected (same vibe as "forces selection")
      // Comment this out if you want the user to manually choose every time.
      // if (!buildingFilter && bList.length > 0) setBuildingFilter(bList[0].building_id);
    } catch {
      // ignore lookup errors; UI still works but building mapping might be incomplete
    }
  };

  useEffect(() => {
    if (token && isAdmin) {
      (async () => {
        await Promise.all([fetchPending(), fetchLookups()]);
      })();
    } else {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  const buildingLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of buildings) {
      map.set(b.building_id, b.building_name || b.building_id);
    }
    return map;
  }, [buildings]);

  const filtered = useMemo(() => {
    let list = items;

    // Gate by building (hide list until selected)
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

  const approve = async (id: number) => {
    try {
      setSubmitting(true);
      await api.post(`/offlineExport/approve/${id}`);
      await fetchPending();
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Approve failed.";
      notify("Approve failed", toText(msg));
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async (id: number) => {
    try {
      setSubmitting(true);
      await api.post(`/offlineExport/reject/${id}`);
      await fetchPending();
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Reject failed.";
      notify("Reject failed", toText(msg));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.selectBuildingEmpty}>
        <Ionicons name="lock-closed-outline" size={44} color="#cbd5e1" />
        <Text style={styles.emptyTitle}>Admin only</Text>
        <Text style={styles.emptyText}>You don’t have access to this panel.</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.grid}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Offline Submissions</Text>

            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                fetchPending();
                fetchLookups();
              }}
              disabled={submitting}
            >
              <Text style={styles.btnText}>
                {submitting ? "Refreshing…" : "Refresh"}
              </Text>
            </TouchableOpacity>
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

            {/* Building chips (NO "All", same as StallsPanel) */}
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

          {/* Gate like StallsPanel: hide list until a building is selected */}
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

                return (
                  <View style={[styles.row, isMobile && styles.rowMobile]}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>
                        Meter {toText(item.meter_id)}{" "}
                        <Text style={styles.rowSub}>(#{item.id})</Text>
                      </Text>

                      <Text style={styles.rowMeta}>
                        Building: {bName} • Value:{" "}
                        {Number(item.reading_value).toFixed(2)} • Date:{" "}
                        {toText(item.reading_date)}
                      </Text>

                      <Text style={styles.rowMetaSmall}>
                        Reader: {toText(item.reader_user_id)}
                        {item.device_serial
                          ? ` • Device: ${toText(item.device_serial)}${
                              item.device_name ? ` (${toText(item.device_name)})` : ""
                            }`
                          : ""}
                      </Text>

                      <Text style={styles.rowMetaSmall}>
                        Submitted:{" "}
                        {item.submitted_at
                          ? new Date(item.submitted_at).toLocaleString()
                          : "—"}
                        {item.remarks ? ` • Remarks: ${toText(item.remarks)}` : ""}
                      </Text>

                      <Text style={styles.rowMetaSmall}>
                        Image: {item.image_base64 ? "✅ Attached" : "— None"}
                      </Text>
                    </View>

                    {isMobile ? (
                      <View style={styles.rowActionsMobile}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionEdit]}
                          onPress={() => approve(item.id)}
                          disabled={submitting}
                        >
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={16}
                            color="#1f2937"
                          />
                          <Text style={[styles.actionText, styles.actionEditText]}>
                            Approve
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionDelete]}
                          onPress={() => reject(item.id)}
                          disabled={submitting}
                        >
                          <Ionicons name="close-circle-outline" size={16} color="#fff" />
                          <Text style={[styles.actionText, styles.actionDeleteText]}>
                            Reject
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.rowActions}>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionEdit]}
                          onPress={() => approve(item.id)}
                          disabled={submitting}
                        >
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={16}
                            color="#1f2937"
                          />
                          <Text style={[styles.actionText, styles.actionEditText]}>
                            Approve
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionBtn, styles.actionDelete]}
                          onPress={() => reject(item.id)}
                          disabled={submitting}
                        >
                          <Ionicons name="close-circle-outline" size={16} color="#fff" />
                          <Text style={[styles.actionText, styles.actionDeleteText]}>
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

        {/* Filters modal (copied pattern from StallsPanel) */}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: 0,
  },
  grid: {
    flex: 1,
    padding: 14,
    gap: 14,
    minHeight: 0,
  },
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
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
  },

  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontWeight: "700" },

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

  loader: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  buildingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  dropdownLabel: {
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
    textTransform: "none",
  },

  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chipsRowHorizontal: {
    paddingRight: 4,
    gap: 8,
  },
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
  rowMobile: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  rowMain: {
    flex: 1,
    paddingRight: 10,
  },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontWeight: "600" },
  rowMeta: { color: "#334155", marginTop: 6 },
  rowMetaSmall: { color: "#94a3b8", marginTop: 2, fontSize: 12 },

  rowActions: {
    width: 220,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  rowActionsMobile: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  actionBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  actionEdit: { backgroundColor: "#e2e8f0" },
  actionDelete: { backgroundColor: "#ef4444" },
  actionText: { fontWeight: "700" },
  actionEditText: { color: "#1f2937" },
  actionDeleteText: { color: "#fff" },

  emptyPad: { paddingVertical: 30 },
  empty: { alignItems: "center", gap: 6 },
  selectBuildingEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 30,
  },
  emptyTitle: { fontWeight: "800", color: "#0f172a" },
  emptyText: { color: "#94a3b8", textAlign: "center" },

  promptOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.36)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  promptCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    width: "100%",
    maxWidth: 560,
    padding: 14,
    ...(Platform.select({
      web: { boxShadow: "0 14px 44px rgba(15, 23, 42, 0.16)" } as any,
      default: { elevation: 3 },
    }) as any),
  },
  modalTitle: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  modalDivider: { height: 1, backgroundColor: "#e2e8f0", marginVertical: 10 },
  modalActions: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
});