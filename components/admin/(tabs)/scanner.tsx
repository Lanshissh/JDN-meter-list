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
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useScanHistory } from "../../contexts/ScanHistoryContext";

export default function ScannerScreen() {
  const router = useRouter();
  const { addScan } = useScanHistory();
  const [scanned, setScanned] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);

  const handleScan = (data: OnSuccessfulScanProps) => {
    if (scanned) return;
    setScanned(true);

    const scanText =
      (data as any)?.rawData || (data as any)?.data || JSON.stringify(data);

    addScan({ data: String(scanText), timestamp: new Date().toISOString() });

    // Jump to History so the dashboard fetches immediately
    router.replace("/(tabs)/history");

    Alert.alert("Scanned!", String(scanText));
    setTimeout(() => setScanned(false), 3000);
  };

  useFocusEffect(
    React.useCallback(() => {
      setScannerKey((prev) => prev + 1); // re-create scanner on focus
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
          showTorchButton: true, // <-- built-in flash toggle
          showStatus: true,
        }}
        permissionScreen={{}}
      />

      {/* Top bar with Close (X) */}
      <SafeAreaView pointerEvents="box-none" style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.replace("/(tabs)/history")}
          style={styles.iconBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={26} color="#000000ff" />
        </TouchableOpacity>
      </SafeAreaView>

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
    marginTop:53.1,
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
  },
  overlayText: {
    color: "#fff",
    fontSize: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
    padding: 8,
    borderRadius: 10,
  },
});