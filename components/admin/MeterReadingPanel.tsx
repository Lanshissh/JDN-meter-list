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
  Keyboard,
  Dimensions,
  KeyboardAvoidingView,
  ScrollView,
  SafeAreaView,
  ToastAndroid,
} from "react-native";
import axios from "axios";
import { Picker } from "@react-native-picker/picker";
import {
  QRCodeScanner,
  OnSuccessfulScanProps,
} from "@masumdev/rn-qrcode-scanner";
import { BASE_API } from "../../constants/api";

// Date helper available to all components
const todayStr = () => new Date().toISOString().slice(0, 10);

// --- Types that mirror your DB & backend ---
export type Reading = {
  reading_id: string;
  meter_id: string;
  reading_value: number;
  read_by: string;
  lastread_date: string; // YYYY-MM-DD
  last_updated: string; // ISO datetime
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

export default function MeterReadingPanel({ token }: { token: string | null }) {
  const authHeader = useMemo(
    () => ({ Authorization: `Bearer ${token ?? ""}` }),
    [token],
  );

  const api = useMemo(
    () =>
      axios.create({
        baseURL: BASE_API,
        headers: authHeader,
        timeout: 15000,
      }),
    [authHeader],
  );

  const [typeFilter, setTypeFilter] = useState<
    "" | "electric" | "water" | "lpg"
  >("");

  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [query, setQuery] = useState("");

  const [formMeterId, setFormMeterId] = useState("");
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState<string>(todayStr());

  const [editVisible, setEditVisible] = useState(false);
  const [editRow, setEditRow] = useState<Reading | null>(null);
  const [editMeterId, setEditMeterId] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editDate, setEditDate] = useState("");

  const [scanVisible, setScanVisible] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);
  const readingInputRef = useRef<TextInput>(null);

  const [sortBy, setSortBy] = useState<
    "date_desc" | "date_asc" | "id_desc" | "id_asc"
  >("date_desc");

  const readNum = (id: string) => {
    const m = /^MR-(\d+)/i.exec(id || "");
    return m ? parseInt(m[1], 10) : 0;
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadAll = async () => {
    if (!token) {
      setBusy(false);
      Alert.alert("Not logged in", "Please log in to manage meter readings.");
      return;
    }
    try {
      setBusy(true);
      const [rRes, mRes] = await Promise.all([
        api.get<Reading[]>("/readings"),
        api.get<Meter[]>("/meters"),
      ]);

      setReadings(rRes.data);
      setMeters(mRes.data);
      if (!formMeterId && mRes.data.length)
        setFormMeterId(mRes.data[0].meter_id);
    } catch (err: any) {
      console.error("[READINGS LOAD]", err?.response?.data || err?.message);
      Alert.alert(
        "Load failed",
        err?.response?.data?.error ??
          "Please check your connection and permissions.",
      );
    } finally {
      setBusy(false);
    }
  };

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  const toast = (title: string, message?: string) => {
    if (Platform.OS === "android") {
      ToastAndroid.show(
        message ? `${title}: ${message}` : title,
        ToastAndroid.SHORT,
      );
    } else {
      Alert.alert(title, message);
    }
  };

  const metersById = useMemo(() => {
    const map = new Map<string, Meter>();
    meters.forEach((m) => map.set(m.meter_id, m));
    return map;
  }, [meters]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return readings;
    return readings.filter(
      (r) =>
        r.reading_id.toLowerCase().includes(q) ||
        r.meter_id.toLowerCase().includes(q) ||
        r.lastread_date.toLowerCase().includes(q) ||
        String(r.reading_value).toLowerCase().includes(q),
    );
  }, [readings, query]);

  const visible = useMemo(() => {
    const typed = searched.filter(
      (r) =>
        !typeFilter ||
        (metersById.get(r.meter_id)?.meter_type || "").toLowerCase() ===
          typeFilter,
    );

    const arr = [...typed];
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
  }, [searched, typeFilter, metersById, sortBy]);

  // --- CRUD ---
  const onCreate = async () => {
    if (!formMeterId || !formValue) {
      Alert.alert("Missing info", "Please select a meter and enter a reading.");
      return;
    }
    const valueNum = parseFloat(formValue);
    if (Number.isNaN(valueNum)) {
      Alert.alert("Invalid value", "Reading must be a number.");
      return;
    }

    try {
      setSubmitting(true);
      await api.post("/readings", {
        meter_id: formMeterId,
        reading_value: valueNum,
        lastread_date: formDate || todayStr(),
      });
      setFormValue("");
      setFormDate(todayStr());
      await loadAll();
      if (
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        window.alert
      ) {
        window.alert("Success\n\nMeter reading recorded.");
      }
    } catch (err: any) {
      console.error("[CREATE READING]", err?.response?.data || err?.message);
      Alert.alert(
        "Create failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = (row?: Reading) => {
    const target = row ?? editRow;
    if (!target) return;

    const performDelete = async () => {
      try {
        setSubmitting(true);
        await api.delete(`/readings/${encodeURIComponent(target.reading_id)}`);
        setEditVisible(false);
        await loadAll();
        if (
          Platform.OS === "web" &&
          typeof window !== "undefined" &&
          window.alert
        ) {
          window.alert(`Deleted\n\n${target.reading_id} removed.`);
        }
      } catch (err: any) {
        console.error("[DELETE READING]", err?.response?.data || err?.message);
        Alert.alert(
          "Delete failed",
          err?.response?.data?.error ?? "Server error.",
        );
      } finally {
        setSubmitting(false);
      }
    };

    Alert.alert(
      "Delete reading?",
      `Are you sure you want to delete ${target.reading_id}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: performDelete },
      ],
    );
  };

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
      if (
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        window.alert
      ) {
        window.alert("Updated\n\nReading updated successfully.");
      }
    } catch (err: any) {
      console.error("[UPDATE READING]", err?.response?.data || err?.message);
      Alert.alert(
        "Update failed",
        err?.response?.data?.error ?? "Server error.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // --- QR scanning (unchanged UI) ---
  const onScan = (data: OnSuccessfulScanProps | string) => {
    const rawScanned = String(
      (data as any)?.code ??
        (data as any)?.rawData ??
        (data as any)?.data ??
        data ??
        "",
    ).trim();

    if (!rawScanned) return;

    const meterIdPattern = /^MTR-[A-Za-z0-9-]+$/i;
    if (!meterIdPattern.test(rawScanned)) {
      return;
    }
    const meterId = rawScanned;

    setScanVisible(false);

    // Validate meter
    if (!metersById.get(meterId)) {
      Alert.alert("Unknown meter", `No meter found for id: ${meterId}`);
      return;
    }

    // Always prepare a NEW reading in the create form
    setFormMeterId(meterId);
    setFormValue(""); // clear any previous value
    setFormDate(todayStr()); // default to today

    setTimeout(() => {
      readingInputRef.current?.focus?.();
    }, 150);
  };

  const openScanner = () => {
    setScannerKey((k) => k + 1);
    setScanVisible(true);
    Keyboard.dismiss();
  };

  return (
    <View style={styles.grid}>
      {/* --- Create form --- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Record Meter Reading</Text>

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

        <TouchableOpacity
          style={[styles.btn, submitting && styles.btnDisabled]}
          onPress={onCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Save Reading</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>New entries default the date to today.</Text>
      </View>

      {/* --- List & Filters --- */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Manage Meter Readings</Text>
        <TextInput
          style={styles.search}
          placeholder="Search by Reading ID, Meter ID, date, value…"
          value={query}
          onChangeText={setQuery}
        />
        <View style={styles.filterRow}>
          {[
            { label: "ALL", val: "" },
            { label: "ELECTRIC", val: "electric" },
            { label: "WATER", val: "water" },
            { label: "GAS", val: "lpg" },
          ].map(({ label, val }) => (
            <TouchableOpacity
              key={label}
              style={[styles.chip, typeFilter === val && styles.chipActive]}
              onPress={() => setTypeFilter(val as any)}
            >
              <Text
                style={[
                  styles.chipText,
                  typeFilter === val && styles.chipTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={[styles.filterRow, { marginTop: -4 }]}>
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
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator />
          </View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.reading_id}
            ListEmptyComponent={
              <Text style={styles.empty}>No readings found.</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>
                    {item.reading_id} • {item.meter_id}
                  </Text>
                  <Text style={styles.rowSub}>
                    {item.lastread_date} • Value: {item.reading_value}
                  </Text>
                  <Text style={styles.rowSub}>
                    Updated {formatDateTime(item.last_updated)} by{" "}
                    {item.updated_by}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.link}
                  onPress={() => openEdit(item)}
                >
                  <Text style={styles.linkText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.link, { marginLeft: 8 }]}
                  onPress={() => onDelete(item)}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.linkText, { color: "#e53935" }]}>
                      Delete
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      {/* --- Edit Modal --- */}
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
          {/* Card */}
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

              {/* Meter */}
              <Dropdown
                label="Meter"
                value={editMeterId}
                onChange={setEditMeterId}
                options={meters.map((m) => ({
                  label: `${m.meter_id} • ${m.meter_type} • ${m.meter_sn}`,
                  value: m.meter_id,
                }))}
              />

              {/* Value + Date */}
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

      {/* --- QR Scanner (unchanged UI) --- */}
      <Modal
        visible={scanVisible}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setScanVisible(false)}
      >
        <View style={styles.scannerScreen}>
          {/* Fill with camera */}
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

          {/* Close (X) */}
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

          {/* Browser hint */}
          {Platform.OS === "web" ? (
            <Text style={[styles.scanInfo, styles.scanTopInfo]}>
              Camera access requires HTTPS in the browser. If the camera does
              not start, please use the dropdown instead.
            </Text>
          ) : null}

          {/* Footer */}
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
    </View>
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

  // parse YYYY-MM-DD
  const [y, m, d] = (value || todayStr())
    .split("-")
    .map((n: string) => parseInt(n, 10));
  const [year, setYear] = useState(y || new Date().getFullYear());
  const [month, setMonth] = useState(
    (m || new Date().getMonth() + 1) as number,
  );
  const [day, setDay] = useState(d || new Date().getDate());

  useEffect(() => {
    // keep local state in sync when value prop changes externally
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
    // Better cross-platform formatting without locale surprises
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
  btn: {
    marginTop: 12,
    backgroundColor: "#1f4bd8",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.7 },
  btnText: { color: "#fff", fontWeight: "700" },
  hint: { marginTop: 8, color: "#627d98" },
  search: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  loader: { paddingVertical: 20, alignItems: "center" },
  empty: { textAlign: "center", color: "#627d98", paddingVertical: 16 },
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
    maxWidth: 480,
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

  scanBtn: {
    marginTop: 35,
    backgroundColor: "#0ea5e9",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  scanBtnText: { color: "#fff", fontWeight: "700" },
  btnGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  btnGhostText: { color: "#102a43", fontWeight: "700" },

  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
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

  // Scanner screen
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
});