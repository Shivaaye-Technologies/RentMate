/**
 * Supabase client for Android: the same project and Auth as the web, with the session kept in Android Keystore
 * (expo-secure-store, chunked), PKCE for email links, and token refresh paused while the app is in the background.
 */
import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { readConfig, type ConfigResult } from "./config";
import { createChunkedStorage } from "./secureSession";

export const configResult: ConfigResult = readConfig(
  {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  },
  __DEV__,
);

const storage = createChunkedStorage({
  getItemAsync: (k) => SecureStore.getItemAsync(k),
  setItemAsync: (k, v) => SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.WHEN_UNLOCKED }),
  deleteItemAsync: (k) => SecureStore.deleteItemAsync(k),
});

/** Null when the build is missing its public configuration (the app then shows a configuration message). */
export const supabase: SupabaseClient | null = configResult.ok
  ? createClient(configResult.config.supabaseUrl, configResult.config.supabaseKey, {
      auth: {
        storage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;

export const apiBaseUrl = configResult.ok ? configResult.config.apiUrl : "";

// Refresh tokens only while the app is in the foreground (Supabase's guidance for React Native).
if (supabase) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  });
}
