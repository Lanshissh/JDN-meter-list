import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from "react-native";
import axios from "axios";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

const API_URL = `${BASE_API}/auth/login`;

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    const user_id = username.trim();
    const user_password = password;

    if (!user_id || !user_password) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await axios.post(API_URL, { user_id, user_password });
      const { token } = res.data;
      await login(token);
      router.replace("/(tabs)/dashboard");
    } catch (err: any) {
      if (err?.response?.data?.error) setError(String(err.response.data.error));
      else setError("Network/server error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: "padding", android: undefined })}
    >
      <View style={styles.card}>
        <Image
          source={require("../../assets/images/logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#9aa5b1"
        />

        <View style={{ width: "100%", position: "relative" }}>
          <TextInput
            style={[styles.input, { paddingRight: 42 }]}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            placeholderTextColor="#9aa5b1"
          />
          <TouchableOpacity
            onPress={() => setShowPw((v) => !v)}
            style={styles.eye}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={showPw ? "eye-off-outline" : "eye-outline"}
              size={20}
              color="#7b8794"
            />
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Removed page background to match your reference
  container: {
    flex: 1,
    backgroundColor: "#f5f7fb", // or "#fff"
    justifyContent: "center",
    padding: 16,
  },
  // Compact card with smaller paddings & max width
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    ...(Platform.select({
      web: { boxShadow: "0 8px 24px rgba(207, 207, 207, 0.06)" as any },
      default: { elevation: 3 },
    }) as any),
  },
  logo: {
    width: 84,
    height: 84,
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#102a43",
    marginTop: 4,
  },
  subtitle: {
    fontSize: 12,
    color: "#627d98",
    marginBottom: 14,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: "#d9e2ec",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#ffffffff",
    width: "100%",
    marginBottom: 10,
    color: "#102a43",
  },
  eye: {
    position: "absolute",
    right: 10,
    top: 12,
  },
  button: {
    height: 44,
    backgroundColor: "#1f4bd8",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.8 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  error: { color: "#d64545", alignSelf: "flex-start", marginBottom: 8 },
});
