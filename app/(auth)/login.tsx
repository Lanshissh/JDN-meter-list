import React, { useState } from "react";
import { router } from "expo-router";
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
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";

const API_URL = `${BASE_API}/auth/login`;

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    const user_id = username.trim();
    const user_password = password; // keep exact password

    if (!user_id || !user_password) {
      setError("Please enter your username and password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await axios.post(API_URL, { user_id, user_password });
      // API returns { token }
      const { token } = res.data;
      await login(token);
      router.replace("/(tabs)/admin");
    } catch (err: any) {
      if (err.response?.data?.error) {
        // e.g. "No existing credentials" / "Invalid credentials"
        setError(String(err.response.data.error));
      } else if (err.message) {
        setError("Network/server error: " + err.message);
      } else {
        setError("Unknown error");
      }
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

        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Log in to your account</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor="#9aa5b1"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor="#9aa5b1"
        />

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
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    ...(Platform.select({
      web: { boxShadow: "0 8px 30px rgba(0,0,0,0.08)" as any },
      default: { elevation: 4 },
    }) as any),
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#102a43",
  },
  subtitle: {
    fontSize: 14,
    color: "#627d98",
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d9e2ec",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#fff",
    width: "100%",
    marginBottom: 14,
    color: "#102a43",
  },
  button: {
    backgroundColor: "#1f4bd8",
    paddingVertical: 14,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  error: {
    color: "#e53935",
    fontSize: 13,
    marginBottom: 8,
  },
});