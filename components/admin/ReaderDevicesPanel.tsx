import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import axios from "axios";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

type Device = {
  id: number;
  device_serial: string;
  device_name: string | null;
  device_token: string;
  status: "active" | "blocked" | string;
  last_seen_at?: any;
  created_at?: any;
};

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

export default function ReaderDevicesPanel() {
  const { token, hasRole } = useAuth();
  const isAdmin = hasRole("admin");

  const { width } = useWindowDimensions();
  const isMobile = width < 640;

  const api = useMemo(() => {
    return axios.create({
      baseURL: BASE_API,
      timeout: 20000,
      headers: { Authorization: `Bearer ${token ?? ""}` },
    });
  }, [token]);

  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string>("");

  // register modal
  const [addOpen, setAddOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const [name, setName] = useState("");

  // UI-only: consistent with StallsPanel style
  const [query, setQuery] = useState("");
  const [filtersVisible, setFiltersVisible] = useState(false);
  type StatusFilter = "all" | "active" | "blocked";
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const fetchDevices = async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const res = await api.get("/reader-devices");
      const devs = res.data?.devices;

      if (Array.isArray(devs)) {
        setDevices(devs);
      } else {
        setDevices([]);
        const msg = pickMessage(res.data) || "Unexpected response from server.";
        setError(toText(msg));
      }
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Failed to load devices.";
      setError(toText(msg));
      setDevices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && isAdmin) fetchDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isAdmin]);

  const onRegister = async () => {
    const device_serial = serial.trim().toUpperCase();
    const device_name = name.trim();

    if (!device_serial) {
      notify("Missing", "Please enter a device serial.");
      return;
    }

    try {
      setLoading(true);
      await api.post("/reader-devices/register", {
        device_serial,
        device_name: device_name || undefined,
      });

      setAddOpen(false);
      setSerial("");
      setName("");
      await fetchDevices();
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Register failed.";
      notify("Register failed", toText(msg));
    } finally {
      setLoading(false);
    }
  };

  const onToggleBlock = async (d: Device) => {
    const next =
      String(d.status).toLowerCase() === "active" ? "blocked" : "active";
    try {
      setLoading(true);
      await api.patch(`/reader-devices/${d.id}`, { status: next });
      await fetchDevices();
    } catch (e: any) {
      const msg =
        pickMessage(e?.response?.data) || e?.message || "Update failed.";
      notify("Update failed", toText(msg));
    } finally {
      setLoading(false);
    }
  };

  const onDelete = async (d: Device) => {
    Alert.alert(
      "Delete device?",
      `Serial: ${d.device_serial}\nThis will remove the token from server control.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setLoading(true);
              await api.delete(`/reader-devices/${d.id}`);
              await fetchDevices();
            } catch (e: any) {
              const msg =
                pickMessage(e?.response?.data) ||
                e?.message ||
                "Delete failed.";
              notify("Delete failed", toText(msg));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const visibleDevices = useMemo(() => {
    const q = query.trim().toLowerCase();

    let arr = devices;

    if (statusFilter !== "all") {
      arr = arr.filter(
        (d) => String(d.status).toLowerCase() === String(statusFilter),
      );
    }

    if (q) {
      arr = arr.filter((d) => {
        const sn = String(d.device_serial || "").toLowerCase();
        const nm = String(d.device_name || "").toLowerCase();
        const tk = String(d.device_token || "").toLowerCase();
        return sn.includes(q) || nm.includes(q) || tk.includes(q);
      });
    }

    // nice stable ordering
    return [...arr].sort((a, b) =>
      String(a.device_serial || "").localeCompare(String(b.device_serial || "")),
    );
  }, [devices, query, statusFilter]);

  if (!isAdmin) {
    return (
      <View style={styles.selectEmpty}>
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
            <Text style={styles.cardTitle}>Reader Devices</Text>

            <TouchableOpacity style={styles.btn} onPress={() => setAddOpen(true)}>
              <Text style={styles.btnText}>+ Register</Text>
            </TouchableOpacity>
          </View>

          {!!error && <Text style={styles.err}>{toText(error)}</Text>}
          {loading ? (
            <View style={styles.loader}>
              <ActivityIndicator />
            </View>
          ) : null}

          {/* Search + Filters row (same vibe as StallsPanel) */}
          <View style={styles.filtersBar}>
            <View style={[styles.searchWrap, { flex: 1 }]}>
              <Ionicons
                name="search-outline"
                size={16}
                color="#94a3b8"
                style={{ marginRight: 6 }}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Search serial, name, token…"
                placeholderTextColor="#94a3b8"
                value={query}
                onChangeText={setQuery}
              />
              {!!query && (
                <TouchableOpacity
                  onPress={() => setQuery("")}
                  style={styles.clearBtn}
                >
                  <Ionicons name="close" size={14} color="#64748b" />
                </TouchableOpacity>
              )}
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

            <TouchableOpacity style={styles.btnGhost} onPress={fetchDevices}>
              <Ionicons
                name="refresh-outline"
                size={16}
                color="#394e6a"
                style={{ marginRight: 6 }}
              />
              <Text style={styles.btnGhostText}>Refresh</Text>
            </TouchableOpacity>
          </View>

          {/* Status chips (inline, consistent) */}
          <View style={{ marginTop: 6, marginBottom: 12 }}>
            {isMobile ? (
              <ScrollViewRow>
                <Chip
                  label="All"
                  active={statusFilter === "all"}
                  onPress={() => setStatusFilter("all")}
                />
                <Chip
                  label="Active"
                  active={statusFilter === "active"}
                  onPress={() => setStatusFilter("active")}
                />
                <Chip
                  label="Blocked"
                  active={statusFilter === "blocked"}
                  onPress={() => setStatusFilter("blocked")}
                />
              </ScrollViewRow>
            ) : (
              <View style={styles.chipsRow}>
                <Chip
                  label="All"
                  active={statusFilter === "all"}
                  onPress={() => setStatusFilter("all")}
                />
                <Chip
                  label="Active"
                  active={statusFilter === "active"}
                  onPress={() => setStatusFilter("active")}
                />
                <Chip
                  label="Blocked"
                  active={statusFilter === "blocked"}
                  onPress={() => setStatusFilter("blocked")}
                />
              </View>
            )}
          </View>

          <FlatList
            data={visibleDevices}
            keyExtractor={(d) => String(d.id)}
            contentContainerStyle={
              visibleDevices.length === 0 ? styles.emptyPad : { paddingBottom: 24 }
            }
            refreshing={loading}
            onRefresh={fetchDevices}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="albums-outline" size={42} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>No devices</Text>
                <Text style={styles.emptyText}>
                  No registered reader devices match your filters.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isActive = String(item.status).toLowerCase() === "active";
              return (
                <View style={[styles.row, isMobile && styles.rowMobile]}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>
                      {toText(item.device_serial)}{" "}
                      <Text style={styles.rowSub}>(#{item.id})</Text>
                    </Text>
                    <Text style={styles.rowMeta}>
                      Name: {toText(item.device_name || "—")} • Status:{" "}
                      {toText(item.status)}
                    </Text>
                    <Text style={styles.rowMetaSmall}>
                      Token: {toText(item.device_token)}
                    </Text>
                  </View>

                  <View style={isMobile ? styles.rowActionsMobile : styles.rowActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionEdit]}
                      onPress={() => onToggleBlock(item)}
                      disabled={loading}
                    >
                      <Ionicons
                        name={isActive ? "ban-outline" : "checkmark-circle-outline"}
                        size={16}
                        color="#1f2937"
                      />
                      <Text style={[styles.actionText, styles.actionEditText]}>
                        {isActive ? "Block" : "Unblock"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionDelete]}
                      onPress={() => onDelete(item)}
                      disabled={loading}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                      <Text style={[styles.actionText, styles.actionDeleteText]}>
                        Delete
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }}
          />

          {/* Filters Modal (design consistent) */}
          <Modal
            visible={filtersVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setFiltersVisible(false)}
          >
            <View style={styles.promptOverlay}>
              <View style={styles.promptCard}>
                <Text style={styles.modalTitle}>Filters</Text>
                <View style={styles.modalDivider} />

                <Text style={styles.dropdownLabel}>Status</Text>
                <View style={styles.chipsRow}>
                  <Chip
                    label="All"
                    active={statusFilter === "all"}
                    onPress={() => setStatusFilter("all")}
                  />
                  <Chip
                    label="Active"
                    active={statusFilter === "active"}
                    onPress={() => setStatusFilter("active")}
                  />
                  <Chip
                    label="Blocked"
                    active={statusFilter === "blocked"}
                    onPress={() => setStatusFilter("blocked")}
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

          {/* Register Modal (kept logic, improved design) */}
          <Modal
            visible={addOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setAddOpen(false)}
          >
            <View style={styles.promptOverlay}>
              <View style={styles.promptCard}>
                <Text style={styles.modalTitle}>Register Device</Text>
                <View style={styles.modalDivider} />

                <Text style={styles.dropdownLabel}>Device Serial</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Device Serial (from Device Settings)"
                  placeholderTextColor="#94a3b8"
                  value={serial}
                  onChangeText={setSerial}
                  autoCapitalize="characters"
                />

                <Text style={styles.dropdownLabel}>Device Name (optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., Reader A"
                  placeholderTextColor="#94a3b8"
                  value={name}
                  onChangeText={setName}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.btnGhost, { paddingVertical: 10 }]}
                    onPress={() => setAddOpen(false)}
                  >
                    <Text style={styles.btnGhostText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.btn} onPress={onRegister}>
                    <Text style={styles.btnText}>Save</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.hint}>
                  Token is generated by server. Reader resolves it on login using the
                  serial.
                </Text>
              </View>
            </View>
          </Modal>
        </View>
      </View>
    </View>
  );
}

/** small helper to mimic StallsPanel horizontal chips spacing */
function ScrollViewRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row" }}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={React.Children.toArray(children)}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.chipsRowHorizontal}
        renderItem={({ item }) => item as any}
      />
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
  },
  cardTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },

  btn: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  btnText: { color: "#fff", fontWeight: "700" },

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

  err: { color: "#c62828", marginBottom: 10 },

  loader: { paddingVertical: 12, alignItems: "center", justifyContent: "center" },

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
  searchInput: {
    flex: 1,
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 12,
    paddingVertical: 0,
  },
  clearBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e2e8f0",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    marginLeft: 6,
  },

  dropdownLabel: {
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 8,
  },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chipsRowHorizontal: { paddingRight: 4, gap: 8 },

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
  rowMobile: { flexDirection: "column", alignItems: "stretch" },

  rowMain: { flex: 1, paddingRight: 10 },
  rowTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  rowSub: { color: "#64748b", fontWeight: "600" },
  rowMeta: { color: "#334155", marginTop: 6 },
  rowMetaSmall: { color: "#94a3b8", marginTop: 2, fontSize: 12 },

  rowActions: {
    width: 240,
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
  selectEmpty: {
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

  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    color: "#0f172a",
    fontWeight: "700",
  },

  hint: { marginTop: 8, opacity: 0.7, color: "#475569" },
});