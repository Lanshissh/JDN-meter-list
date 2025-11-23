// scanner.tsx
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
  Platform,
} from "react-native";

export default function ScannerScreen() {
  const router = useRouter();
  const [scanned, setScanned] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);

  const handleScan = (data: OnSuccessfulScanProps) => {
    if (scanned) return;
    setScanned(true);

    const raw = String(
      (data as any)?.code ??
        (data as any)?.rawData ??
        (data as any)?.data ??
        ""
    ).trim();

    if (!raw) {
      Alert.alert("QR code empty", "No data found in QR code.");
      setTimeout(() => setScanned(false), 1500);
      return;
    }

    // Expect the QR content to be the meter id, e.g. "MTR-0001"
    const meterIdPattern = /^MTR-[A-Za-z0-9-]+$/i;
    if (!meterIdPattern.test(raw)) {
      Alert.alert("Invalid QR", "QR code does not contain a valid meter ID.");
      setTimeout(() => setScanned(false), 1500);
      return;
    }

    const meterId = raw.toUpperCase();

    // Go straight to Admin → Readings and pass the meterId.
    // MeterReadingPanel will open the Add Reading modal and preselect this meter.
    router.replace({
      pathname: "/(tabs)/admin",
      params: { panel: "readings", meterId },
    } as any);

    Alert.alert("Scanned!", `Meter: ${meterId}`);
    setTimeout(() => setScanned(false), 1500);
  };

  useFocusEffect(
    React.useCallback(() => {
      // Force re-mount scanner when screen gains focus
      setScannerKey((prev) => prev + 1);
    }, [])
  );

  return (
    <View style={styles.container}>
      <QRCodeScanner
        key={scannerKey}
        core={{ onSuccessfulScan: handleScan }}
        scanning={{ cooldownDuration: 1200 }}
        uiControls={{
          showControls: true,
          showTorchButton: true,
          showStatus: true,
        }}
        permissionScreen={{}}
      />
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
          <Text style={styles.overlayHint}>
            Use CTRL/CMD + Plus to zoom if needed
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
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