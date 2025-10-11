import React, { useState, useRef } from "react";
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
  Animated,
} from "react-native";
import axios from "axios";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../contexts/AuthContext";
import { BASE_API } from "../../constants/api";
import { LinearGradient } from "expo-linear-gradient";

const API_URL = `${BASE_API}/auth/login`;

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const usernameLabelAnim = useRef(new Animated.Value(0)).current;
  const passwordLabelAnim = useRef(new Animated.Value(0)).current;

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

  const handleUsernameFocus = () => {
    setFocusedInput("username");
    Animated.timing(usernameLabelAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handleUsernameBlur = () => {
    setFocusedInput(null);
    if (!username) {
      Animated.timing(usernameLabelAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const handlePasswordFocus = () => {
    setFocusedInput("password");
    Animated.timing(passwordLabelAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handlePasswordBlur = () => {
    setFocusedInput(null);
    if (!password) {
      Animated.timing(passwordLabelAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
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
      {/* Sophisticated gradient background */}
      <LinearGradient
        colors={["#fbfbfdff", "#c3cce2ff", "#a7b1c9ff"]}
        style={styles.backgroundGradient}
      />

      {/* Floating shapes */}
      <View style={styles.shape1} />
      <View style={styles.shape2} />
      <View style={styles.shape3} />
      
      {/* Subtle grain texture overlay */}
      <View style={styles.grainOverlay} />

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.select({ ios: "padding", android: undefined })}
      >
        <View style={styles.content}>
          {/* Main card with luxury design */}
          <View style={styles.cardContainer}>
            {/* Ambient shadow */}
            <View style={styles.ambientShadow} />
            
            <View style={styles.card}>
              {/* Gold accent bar */}
              <View style={styles.goldBar} />
              
              {/* Logo section */}
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

              {/* Floating label inputs */}
              <View style={styles.formContainer}>
                <View style={styles.inputContainer}>
                  <Animated.Text
                    style={[
                      styles.floatingLabel,
                      usernameLabelStyle,
                      (focusedInput === "username" || username) && styles.floatingLabelActive,
                    ]}
                  >
                    Username
                  </Animated.Text>
                  <View style={[styles.inputWrapper, focusedInput === "username" && styles.inputWrapperFocused]}>
                    <Ionicons
                      name="person"
                      size={20}
                      color={focusedInput === "username" ? "#47578bff" : "#a0a0a0"}
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
                      onFocus={handleUsernameFocus}
                      onBlur={handleUsernameBlur}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <View style={[styles.inputUnderline, focusedInput === "username" && styles.inputUnderlineFocused]} />
                </View>

                <View style={styles.inputContainer}>
                  <Animated.Text
                    style={[
                      styles.floatingLabel,
                      passwordLabelStyle,
                      (focusedInput === "password" || password) && styles.floatingLabelActive,
                    ]}
                  >
                    Password
                  </Animated.Text>
                  <View style={[styles.inputWrapper, focusedInput === "password" && styles.inputWrapperFocused]}>
                    <Ionicons
                      name="lock-closed"
                      size={20}
                      color={focusedInput === "password" ? "#47578bff" : "#a0a0a0"}
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
                      onFocus={handlePasswordFocus}
                      onBlur={handlePasswordBlur}
                      secureTextEntry={!showPw}
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
                  <View style={[styles.inputUnderline, focusedInput === "password" && styles.inputUnderlineFocused]} />
                </View>
              </View>

              {/* Error message */}
              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="information-circle" size={18} color="#d32f2f" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Elegant button */}
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
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

              {/* Divider */}
              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>SECURE</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Footer */}
              <View style={styles.footer}>
                <View style={styles.securityBadge}>
                  <Ionicons name="shield" size={16} color="#474d8bff" />
                  <Text style={styles.securityText}>Protected Connection</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Decorative element */}
          <View style={styles.decorativeCircle} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fdfcfb",
  },
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
    ...(Platform.select({
      web: { filter: "blur(80px)" as any },
    }) as any),
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
    ...(Platform.select({
      web: { filter: "blur(70px)" as any },
    }) as any),
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
    ...(Platform.select({
      web: { filter: "blur(60px)" as any },
    }) as any),
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
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    position: "relative",
  },
  cardContainer: {
    width: "100%",
    maxWidth: 440,
    position: "relative",
  },
  ambientShadow: {
    position: "absolute",
    top: 30,
    left: 20,
    right: 20,
    bottom: -30,
    backgroundColor: "#47538bff",
    opacity: 0.15,
    borderRadius: 28,
    ...(Platform.select({
      web: { filter: "blur(40px)" as any },
    }) as any),
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
      web: {
        boxShadow: "0 20px 60px rgba(71, 76, 139, 0.15)" as any,
      },
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
  logoContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
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
      web: {
        boxShadow: "0 8px 24px rgba(77, 71, 139, 0.1)" as any,
      },
      default: {
        elevation: 4,
        shadowColor: "#47558bff",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
    }) as any),
  },
  logo: {
    width: 64,
    height: 64,
  },
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
    marginBottom: 36,
    fontWeight: "400",
  },
  formContainer: {
    gap: 28,
    marginBottom: 24,
  },
  inputContainer: {
    position: "relative",
  },
  floatingLabel: {
    position: "absolute",
    left: 48,
    color: "#a0a0a0ff",
    fontWeight: "400",
    backgroundColor: "#ffffffff",
    paddingHorizontal: 6,
    zIndex: 1,
  },
  floatingLabelActive: {
    color: "#47598bff",
    fontWeight: "500",
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fafafa",
    borderRadius: 8,
    height: 56,
  },
  inputWrapperFocused: {
    backgroundColor: "#ffffff",
  },
  inputIconLeft: {
    marginLeft: 16,
    marginRight: 12,
  },
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
    backgroundColor: "#474a8bff",
    ...(Platform.select({
      web: {
        boxShadow: "0 0 8px rgba(73, 71, 139, 0.3)" as any,
      },
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
  errorText: {
    flex: 1,
    color: "#c62828",
    fontSize: 14,
    fontWeight: "500",
  },
  button: {
    height: 56,
    borderRadius: 12,
    overflow: "hidden",
    ...(Platform.select({
      web: {
        boxShadow: "0 8px 24px rgba(88, 71, 139, 0.3)" as any,
      },
      default: {
        elevation: 6,
        shadowColor: "#47618bff",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
    }) as any),
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonGradient: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
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
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e0e0e0ff",
  },
  dividerText: {
    fontSize: 11,
    color: "#a0a0a0ff",
    fontWeight: "600",
    letterSpacing: 2,
  },
  footer: {
    alignItems: "center",
  },
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
  securityText: {
    fontSize: 12,
    color: "#757575ff",
    fontWeight: "500",
  },
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
});