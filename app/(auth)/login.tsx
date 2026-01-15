import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import axios from "axios";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API as BASE_API_CONST } from "../../constants/api";

const KEY_DEVICE_SERIAL = "device_serial_v1";
const KEY_DEVICE_TOKEN = "device_token_v1";
const KEY_DEVICE_NAME = "device_name_v1";
const KEY_OFFLINE_SCANS = "offline_scans_v1";
const KEY_OFFLINE_PACKAGE = "offline_package_v1";

const resolveBaseApiForDevice = (base: string) => {
  if (!base) return base;
  try {
    const url = new URL(base);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    if (!isHttp) return base;
    const host = url.hostname;
    if (
      Platform.OS === "android" &&
      (host === "localhost" || host === "127.0.0.1")
    ) {
      url.hostname = "10.0.2.2";
      return url.toString().replace(/\/$/, "");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return base;
  }
};

const BASE_API = resolveBaseApiForDevice(BASE_API_CONST);
const API_URL = `${BASE_API}/auth/login`;

function safeJsonParse<T = any>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");

    return safeJsonParse(json);
  } catch {
    return null;
  }
}

function normalizeRole(r: any) {
  return String(r || "")
    .trim()
    .toLowerCase();
}

function hasReaderRole(payload: any) {
  const roles = Array.isArray(payload?.user_roles) ? payload.user_roles : [];
  return roles.map(normalizeRole).includes("reader");
}

async function getDeviceSerial() {
  const s = await AsyncStorage.getItem(KEY_DEVICE_SERIAL);
  return (s || "").trim().toUpperCase();
}

function guessDeviceName(): string {
  try {
    const Constants = require("expo-constants").default;
    const name =
      Constants?.deviceName ||
      Constants?.platform?.ios?.model ||
      Constants?.platform?.android?.model ||
      "";
    return (name || "Reader Device").trim();
  } catch {
    return "Reader Device";
  }
}

async function clearReaderOfflineSession() {
  await AsyncStorage.multiRemove([KEY_OFFLINE_SCANS, KEY_OFFLINE_PACKAGE]);
}

export default function LoginScreen() {
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [deviceModalOpen, setDeviceModalOpen] = useState(false);
  const [deviceSerialInput, setDeviceSerialInput] = useState("");
  const [storedDeviceSerial, setStoredDeviceSerial] = useState<string>("");
  const usernameLabelAnim = useRef(new Animated.Value(0)).current;
  const passwordLabelAnim = useRef(new Animated.Value(0)).current;

  const api = useMemo(() => {
    return axios.create({
      baseURL: BASE_API,
      timeout: 15000,
      headers: { "Content-Type": "application/json" },
    });
  }, []);

  const canSubmit = useMemo(
    () => username.trim().length > 0 && password.length > 0 && !loading,
    [username, password, loading],
  );

  const refreshSerial = async () => {
    const s = await getDeviceSerial();
    setStoredDeviceSerial(s);
    if (!deviceSerialInput) setDeviceSerialInput(s);
  };

  useEffect(() => {
    console.log(
      "Auth Login Screen mounted. BASE_API →",
      BASE_API,
      "API_URL →",
      API_URL,
    );
    refreshSerial();
  }, []);

  const openDeviceSettings = async () => {
    await refreshSerial();
    setDeviceModalOpen(true);
  };

  const saveDeviceSerial = async () => {
    const serial = (deviceSerialInput || "").trim().toUpperCase();
    if (!serial) {
      setError("Please enter a Device Serial.");
      return;
    }
    await AsyncStorage.setItem(KEY_DEVICE_SERIAL, serial);
    setStoredDeviceSerial(serial);
    setDeviceModalOpen(false);
    setError("");
  };

  const clearDeviceSerial = async () => {
    await AsyncStorage.removeItem(KEY_DEVICE_SERIAL);
    setStoredDeviceSerial("");
    setDeviceSerialInput("");
    setError("");
  };

  const submit = async () => {
    const user_id = username.trim();
    const user_password = password;

    if (!user_id || !user_password) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);
    setError("");
    Keyboard.dismiss();

    try {
      const res = await api.post("/auth/login", { user_id, user_password });

      const token = res?.data?.token ?? res?.data?.data?.token ?? null;
      if (!token) {
        console.log("LOGIN OK but missing token. Response data:", res?.data);
        throw new Error("Logged in but no token returned by server.");
      }
      const payload = decodeJwtPayload(token);
      const isReader = hasReaderRole(payload);

      if (isReader) {
        await clearReaderOfflineSession();
        const device_serial = await getDeviceSerial();
        if (!device_serial) {
          setDeviceModalOpen(true);
          throw new Error(
            "This device has no Device Serial set. Tap Device Settings and enter the serial registered by admin.",
          );
        }

        const device_name = guessDeviceName();

        const rr = await api.post(
          "/reader-devices/resolve",
          { device_serial, device_name },
          { headers: { Authorization: `Bearer ${token}` } },
        );

        const device =
          rr?.data?.device ?? rr?.data?.data?.device ?? rr?.data?.data ?? null;

        const device_token = device?.device_token;
        if (!device_token) {
          throw new Error(
            "Device resolve succeeded but no device token was returned.",
          );
        }

        await AsyncStorage.setItem(KEY_DEVICE_TOKEN, String(device_token));
        await AsyncStorage.setItem(
          KEY_DEVICE_NAME,
          String(device?.device_name || device_name),
        );
      } else {
        await AsyncStorage.multiRemove([KEY_DEVICE_TOKEN, KEY_DEVICE_NAME]);
      }

      await login(token);

      router.replace("/(tabs)/dashboard");
    } catch (err: any) {
      console.log("LOGIN ERROR →", {
        url: API_URL,
        base: BASE_API,
        platform: Platform.OS,
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message,
      });

      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        (err?.response?.status === 500
          ? "Server error (500) from API."
          : err?.message) ||
        "Network/server error. Please try again.";

      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  const onFocus = (field: "username" | "password") => {
    setFocusedInput(field);
    Animated.timing(
      field === "username" ? usernameLabelAnim : passwordLabelAnim,
      {
        toValue: 1,
        duration: 200,
        useNativeDriver: false,
      },
    ).start();
  };

  const onBlur = (field: "username" | "password") => {
    setFocusedInput(null);
    const val = field === "username" ? username : password;
    if (!val) {
      Animated.timing(
        field === "username" ? usernameLabelAnim : passwordLabelAnim,
        {
          toValue: 0,
          duration: 200,
          useNativeDriver: false,
        },
      ).start();
    }
  };

  const usernameLabelStyle = {
    top: usernameLabelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [18, -10],
    }),
    fontSize: usernameLabelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [16, 12],
    }),
  };

  const passwordLabelStyle = {
    top: passwordLabelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [18, -10],
    }),
    fontSize: passwordLabelAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [16, 12],
    }),
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#fbfbfdff", "#c3cce2ff", "#a7b1c9ff"]}
        style={styles.backgroundGradient}
      />
      <View style={styles.shape1} />
      <View style={styles.shape2} />
      <View style={styles.shape3} />
      <View style={styles.grainOverlay} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <View style={styles.content}>
          <View style={styles.cardContainer}>
            <View style={styles.ambientShadow} />
            <View style={styles.card}>
              <View style={styles.goldBar} />

              <View style={styles.logoContainer}>
                <View style={styles.logoFrame}>
                  <Image
                    source={require("../../assets/images/logo.png")}
                    style={styles.logo}
                    resizeMode="contain"
                  />
                </View>
              </View>

              <Text style={styles.title}>Welcome</Text>
              <Text style={styles.subtitle}>
                Please sign in to your account
              </Text>

              <View style={styles.deviceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceLabel}>Device Serial</Text>
                  <Text style={styles.deviceValue} numberOfLines={1}>
                    {storedDeviceSerial ? storedDeviceSerial : "Not set"}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.deviceBtn}
                  onPress={openDeviceSettings}
                >
                  <Ionicons
                    name="settings-outline"
                    size={18}
                    color="#47538bff"
                  />
                  <Text style={styles.deviceBtnText}>Device Settings</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.formContainer}>
                <View style={styles.inputContainer}>
                  <Animated.Text
                    style={[
                      styles.floatingLabel,
                      usernameLabelStyle,
                      (focusedInput === "username" || username) &&
                        styles.floatingLabelActive,
                    ]}
                  >
                    Username
                  </Animated.Text>

                  <View
                    style={[
                      styles.inputWrapper,
                      focusedInput === "username" && styles.inputWrapperFocused,
                    ]}
                  >
                    <Ionicons
                      name="person"
                      size={20}
                      color={
                        focusedInput === "username" ? "#47578bff" : "#a0a0a0"
                      }
                      style={styles.inputIconLeft}
                    />
                    <TextInput
                      style={styles.input}
                      value={username}
                      onChangeText={(text) => {
                        setUsername(text);
                        if (text && !username) {
                          Animated.timing(usernameLabelAnim, {
                            toValue: 1,
                            duration: 200,
                            useNativeDriver: false,
                          }).start();
                        }
                      }}
                      onFocus={() => onFocus("username")}
                      onBlur={() => onBlur("username")}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                      onSubmitEditing={() => {}}
                    />
                  </View>
                  <View
                    style={[
                      styles.inputUnderline,
                      focusedInput === "username" &&
                        styles.inputUnderlineFocused,
                    ]}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Animated.Text
                    style={[
                      styles.floatingLabel,
                      passwordLabelStyle,
                      (focusedInput === "password" || password) &&
                        styles.floatingLabelActive,
                    ]}
                  >
                    Password
                  </Animated.Text>

                  <View
                    style={[
                      styles.inputWrapper,
                      focusedInput === "password" && styles.inputWrapperFocused,
                    ]}
                  >
                    <Ionicons
                      name="lock-closed"
                      size={20}
                      color={
                        focusedInput === "password" ? "#47578bff" : "#a0a0a0"
                      }
                      style={styles.inputIconLeft}
                    />
                    <TextInput
                      style={[styles.input, { flex: 1 }]}
                      value={password}
                      onChangeText={(text) => {
                        setPassword(text);
                        if (text && !password) {
                          Animated.timing(passwordLabelAnim, {
                            toValue: 1,
                            duration: 200,
                            useNativeDriver: false,
                          }).start();
                        }
                      }}
                      onFocus={() => onFocus("password")}
                      onBlur={() => onBlur("password")}
                      secureTextEntry={!showPw}
                      returnKeyType="go"
                      onSubmitEditing={() => canSubmit && submit()}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPw((v) => !v)}
                      style={styles.eyeButton}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons
                        name={showPw ? "eye-off" : "eye"}
                        size={20}
                        color="#a0a0a0"
                      />
                    </TouchableOpacity>
                  </View>

                  <View
                    style={[
                      styles.inputUnderline,
                      focusedInput === "password" &&
                        styles.inputUnderlineFocused,
                    ]}
                  />
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons
                    name="information-circle"
                    size={18}
                    color="#d32f2f"
                  />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.button,
                  (!canSubmit || loading) && styles.buttonDisabled,
                ]}
                onPress={submit}
                disabled={!canSubmit || loading}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={["#47538bff", "#6d75a0ff", "#47538bff"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.buttonGradient}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <View style={styles.buttonContent}>
                      <Text style={styles.buttonText}>Sign In</Text>
                      <View style={styles.buttonDivider} />
                      <Ionicons name="log-in-outline" size={20} color="#fff" />
                    </View>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>SECURE</Text>
                <View style={styles.dividerLine} />
              </View>

              <View style={styles.footer}>
                <View style={styles.securityBadge}>
                  <Ionicons name="shield" size={16} color="#474d8bff" />
                  <Text style={styles.securityText}>Protected Connection</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.decorativeCircle} />
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={deviceModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDeviceModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Device Settings</Text>
            <Text style={styles.modalHint}>
              Enter the Device Serial that was registered in Admin → Reader
              Devices.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Device Serial"
              value={deviceSerialInput}
              autoCapitalize="characters"
              onChangeText={setDeviceSerialInput}
            />

            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnGhost]}
                onPress={() => setDeviceModalOpen(false)}
              >
                <Text style={[styles.modalBtnText, styles.modalBtnTextGhost]}>
                  Close
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnDanger]}
                onPress={clearDeviceSerial}
              >
                <Text style={styles.modalBtnText}>Clear</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalBtn}
                onPress={saveDeviceSerial}
              >
                <Text style={styles.modalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>

            {storedDeviceSerial ? (
              <Text style={styles.modalCurrent}>
                Current: {storedDeviceSerial}
              </Text>
            ) : (
              <Text style={styles.modalCurrent}>Current: Not set</Text>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fdfcfb" },
  backgroundGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  shape1: {
    position: "absolute",
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: "#74b7d4ff",
    opacity: 0.15,
    top: -200,
    right: -150,
    ...(Platform.select({ web: { filter: "blur(80px)" as any } }) as any),
  },
  shape2: {
    position: "absolute",
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: "#474e8bff",
    opacity: 0.1,
    bottom: -100,
    left: -100,
    ...(Platform.select({ web: { filter: "blur(70px)" as any } }) as any),
  },
  shape3: {
    position: "absolute",
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "#a7b6c9ff",
    opacity: 0.2,
    top: "50%",
    left: "50%",
    marginLeft: -125,
    marginTop: -125,
    ...(Platform.select({ web: { filter: "blur(60px)" as any } }) as any),
  },
  grainOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.03,
    backgroundColor: "#000",
  },
  keyboardView: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    position: "relative",
  },
  cardContainer: { width: "100%", maxWidth: 440, position: "relative" },
  ambientShadow: {
    position: "absolute",
    top: 30,
    left: 20,
    right: 20,
    bottom: -30,
    backgroundColor: "#47538bff",
    opacity: 0.15,
    borderRadius: 28,
    ...(Platform.select({ web: { filter: "blur(40px)" as any } }) as any),
  },
  card: {
    backgroundColor: "#ffffffff",
    borderRadius: 28,
    padding: 40,
    borderWidth: 1,
    borderColor: "rgba(72, 71, 139, 0.15)",
    position: "relative",
    overflow: "visible",
    ...(Platform.select({
      web: { boxShadow: "0 20px 60px rgba(71, 76, 139, 0.15)" as any },
      default: {
        elevation: 8,
        shadowColor: "#4d478bff",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 30,
      },
    }) as any),
  },
  goldBar: {
    position: "absolute",
    top: 0,
    left: "25%",
    right: "25%",
    height: 4,
    backgroundColor: "#47518bff",
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  logoContainer: { alignItems: "center", marginBottom: 20 },
  logoFrame: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#f6f6faff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#52478b33",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(77, 71, 139, 0.1)" as any },
      default: {
        elevation: 4,
        shadowColor: "#47558bff",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
    }) as any),
  },
  logo: { width: 64, height: 64 },
  title: {
    fontSize: 36,
    fontWeight: "300",
    color: "#2c2c2cff",
    textAlign: "center",
    marginBottom: 4,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 14,
    color: "#757575ff",
    textAlign: "center",
    marginBottom: 18,
    fontWeight: "400",
  },

  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#e6e6e6",
    marginBottom: 18,
  },
  deviceLabel: {
    fontSize: 11,
    color: "#888",
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  deviceValue: {
    fontSize: 13,
    color: "#2c2c2cff",
    fontWeight: "600",
    marginTop: 2,
  },
  deviceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#f1f2ff",
    borderWidth: 1,
    borderColor: "rgba(71, 83, 139, 0.18)",
  },
  deviceBtnText: { color: "#47538bff", fontWeight: "700", fontSize: 12 },

  formContainer: { gap: 28, marginBottom: 24 },
  inputContainer: { position: "relative" },
  floatingLabel: {
    position: "absolute",
    left: 48,
    color: "#a0a0a0ff",
    fontWeight: "400",
    backgroundColor: "#ffffffff",
    paddingHorizontal: 6,
    zIndex: 1,
  },
  floatingLabelActive: { color: "#47598bff", fontWeight: "500" },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fafafa",
    borderRadius: 8,
    height: 56,
  },
  inputWrapperFocused: { backgroundColor: "#ffffff" },
  inputIconLeft: { marginLeft: 16, marginRight: 12 },
  input: {
    flex: 1,
    height: 56,
    color: "#2c2c2cff",
    fontSize: 16,
    fontWeight: "400",
    paddingRight: 16,
  },
  eyeButton: {
    width: 48,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  inputUnderline: {
    height: 2,
    backgroundColor: "#e0e0e0ff",
    marginTop: 2,
    borderRadius: 1,
  },
  inputUnderlineFocused: {
    height: 2,
    backgroundColor: "#474a8bff",
    ...(Platform.select({
      web: { boxShadow: "0 0 8px rgba(73, 71, 139, 0.3)" as any },
    }) as any),
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#edebffff",
    borderLeftWidth: 4,
    borderLeftColor: "#d32f2f",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 24,
    gap: 12,
  },
  errorText: { flex: 1, color: "#c62828", fontSize: 14, fontWeight: "500" },
  button: {
    height: 56,
    borderRadius: 12,
    overflow: "hidden",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(88, 71, 139, 0.3)" as any },
      default: {
        elevation: 6,
        shadowColor: "#47618bff",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
    }) as any),
  },
  buttonDisabled: { opacity: 0.6 },
  buttonGradient: { flex: 1, alignItems: "center", justifyContent: "center" },
  buttonContent: { flexDirection: "row", alignItems: "center", gap: 16 },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 1,
  },
  buttonDivider: {
    width: 1,
    height: 20,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 28,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#e0e0e0ff" },
  dividerText: {
    fontSize: 11,
    color: "#a0a0a0ff",
    fontWeight: "600",
    letterSpacing: 2,
  },
  footer: { alignItems: "center" },
  securityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#faf8f6",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#50478b22",
  },
  securityText: { fontSize: 12, color: "#757575ff", fontWeight: "500" },
  decorativeCircle: {
    position: "absolute",
    bottom: 40,
    right: 40,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#47488bff",
    opacity: 0.3,
  },

  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
    color: "#0f172a",
  },
  modalHint: { color: "#64748b", marginBottom: 12, lineHeight: 18 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  modalRow: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 6,
    flexWrap: "wrap",
  },
  modalBtn: {
    backgroundColor: "#47538b",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalBtnDanger: { backgroundColor: "#b91c1c" },
  modalBtnGhost: { backgroundColor: "#e5e7eb" },
  modalBtnText: { color: "#fff", fontWeight: "800" },
  modalBtnTextGhost: { color: "#111827" },
  modalCurrent: { marginTop: 10, color: "#334155", fontWeight: "600" },
});