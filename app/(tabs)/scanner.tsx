// app/(tabs)/scanner.tsx
import {
  OnSuccessfulScanProps,
  QRCodeScanner,
} from "@masumdev/rn-qrcode-scanner";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useScanHistory } from "../../contexts/ScanHistoryContext";

const today = () => new Date().toISOString().slice(0, 10);

export default function ScannerScreen() {
  const router = useRouter();
  // ⬇️ use queueScan instead of addScan (Ctx does not have addScan)
  const { queueScan } = useScanHistory();
  const [scanned, setScanned] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);

  const handleScan = async (data: OnSuccessfulScanProps) => {
    if (scanned) return;
    setScanned(true);

    const scanText =
      (data as any)?.rawData || (data as any)?.data || JSON.stringify(data);
    const raw = String(scanText).trim();

    // Try to extract a meter id like MTR-123...
    const match = raw.match(/\bMTR-[A-Za-z0-9-]+\b/i);
    const meterId = match ? match[0].toUpperCase() : "";

    // If we detected a meter id, queue an offline "placeholder" reading (value 0, today).
    // This lets the reading appear in Offline History for later approval when online.
    try {
      if (meterId) {
        await queueScan({
          meter_id: meterId,
          reading_value: 0,
          lastread_date: today(),
        });
      }
    } catch {
      // Non-fatal — continue navigation anyway
    }

    // Go to Billing screen after scan
    router.replace("/(tabs)/billing");

    Alert.alert("Scanned!", meterId || raw);
    setTimeout(() => setScanned(false), 3000);
  };

  useFocusEffect(
    React.useCallback(() => {
      setScannerKey((prev) => prev + 1); // re-create scanner on focus
    }, []),
  );

  return (
    <View style={styles.container}>
      <QRCodeScanner
        key={scannerKey}
        core={{ onSuccessfulScan: handleScan }}
        scanning={{ cooldownDuration: 1200 }}
        uiControls={{
          showControls: true,
          showTorchButton: true, // built-in flash toggle
          showStatus: true,
        }}
        permissionScreen={{}}
      />

      {/* Make overlays non-interactive so touches reach the torch button */}
      <View pointerEvents="none" style={styles.logoContainer}>
        <Image
          source={require("../../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      <View pointerEvents="none" style={styles.overlay}>
        <Text style={styles.overlayText}>Point your camera at a QR Code</Text>
        {Platform.OS === "web" ? (
          <Text style={styles.overlayHint}>Use CTRL/CMD + Plus to zoom if needed</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: 12,
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    zIndex: 20,
  },
  iconBtn: {
    marginLeft: 8.7,
    marginTop: 53.1,
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    borderRadius: 999,
    padding: 8,
  },

  logoContainer: {
    position: "absolute",
    top: 40,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  logo: { width: 100, height: 100, opacity: 0.9 },

  overlay: {
    position: "absolute",
    bottom: 60,
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  overlayText: {
    color: "#fff",
    fontSize: 14,
    textAlign: "center",
    opacity: 0.9,
  },
  overlayHint: {
    marginTop: 6,
    color: "#d1d5db",
    fontSize: 12,
    opacity: 0.85,
  },
});