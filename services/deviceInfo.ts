import AsyncStorage from "@react-native-async-storage/async-storage";

export type ReaderDeviceResolved = {
  id: number;
  device_serial: string;
  device_name: string | null;
  device_token: string;
  status: "active" | "blocked" | string;
};

const KEY_DEVICE_SERIAL = "device_serial_v1";
const KEY_DEVICE_TOKEN = "device_token_v1";
const KEY_DEVICE_NAME = "device_name_v1";

function normalizeSerial(serial: string) {
  return (serial || "").trim().toUpperCase();
}

/**
 * Admin/Setup screen should call this after the admin sets the serial in the device.
 * Example serial: "ABC-12345"
 */
export async function setDeviceSerial(serial: string) {
  const s = normalizeSerial(serial);
  if (!s) throw new Error("Device serial is required.");
  await AsyncStorage.setItem(KEY_DEVICE_SERIAL, s);
  return s;
}

export async function getDeviceSerial() {
  const s = await AsyncStorage.getItem(KEY_DEVICE_SERIAL);
  return s ? normalizeSerial(s) : "";
}

export async function clearDeviceIdentity() {
  await AsyncStorage.multiRemove([KEY_DEVICE_SERIAL, KEY_DEVICE_TOKEN, KEY_DEVICE_NAME]);
}

export async function getStoredDeviceToken() {
  return (await AsyncStorage.getItem(KEY_DEVICE_TOKEN)) || "";
}

export async function getStoredDeviceName() {
  return (await AsyncStorage.getItem(KEY_DEVICE_NAME)) || "";
}

/**
 * Best-effort device name. Works even if expo-constants is not installed (won't crash).
 */
export function guessDeviceName(): string {
  try {
    // optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;
    const modelName =
      Constants?.deviceName ||
      Constants?.platform?.ios?.model ||
      Constants?.platform?.android?.model ||
      "";
    return modelName || "Reader Device";
  } catch {
    return "Reader Device";
  }
}

/**
 * Reader role only:
 * Call this AFTER login to resolve the device token using the serial stored on the device.
 *
 * Backend endpoint:
 * POST /reader-devices/resolve
 * body: { device_serial, device_name }
 *
 * Returns: { device: {...device_token...} }
 */
export async function resolveReaderDevice(opts: {
  apiBaseUrl: string;
  authToken: string; // your normal JWT/session token
  deviceName?: string;
}) {
  const device_serial = await getDeviceSerial();
  if (!device_serial) {
    throw new Error(
      "No device serial set on this device. Ask admin to set it in Device Settings."
    );
  }

  const device_name = (opts.deviceName || guessDeviceName()).trim();

  const res = await fetch(`${opts.apiBaseUrl}/reader-devices/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.authToken}`,
    },
    body: JSON.stringify({ device_serial, device_name }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `Resolve device failed (${res.status}).`;
    throw new Error(msg);
  }

  const device: ReaderDeviceResolved | undefined = data?.device;
  if (!device?.device_token) {
    throw new Error("Resolve device did not return a device token.");
  }

  // Store token + name locally (READERS ONLY)
  await AsyncStorage.setItem(KEY_DEVICE_TOKEN, device.device_token);
  await AsyncStorage.setItem(KEY_DEVICE_NAME, device.device_name || device_name);

  return device;
}