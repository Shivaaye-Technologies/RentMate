import type { ExpoConfig } from "expo/config";

/**
 * RentMate Android app configuration (Expo SDK 58).
 *
 * Package id: PROPOSED, not confirmed. It cannot change after the first Google Play upload, so it is read from
 * RENTMATE_ANDROID_PACKAGE when set and the founder confirms the value before any store build.
 *
 * Only public values reach the app: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY (publishable) and
 * EXPO_PUBLIC_API_URL. Server secrets (LiveKit key/secret, service role key) never belong here.
 */
const config: ExpoConfig = {
  name: "RentMate",
  slug: "rentmate",
  scheme: "rentmate",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android: {
    package: process.env.RENTMATE_ANDROID_PACKAGE ?? "com.shivaayetechnologies.rentmate",
    versionCode: 1,
    // Permissions are added only when the feature that needs them ships, and requested at the moment of use.
    // Calls will add CAMERA and RECORD_AUDIO; push will add POST_NOTIFICATIONS; location stays optional.
    permissions: [],
    blockedPermissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_CONTACTS",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-build-properties",
      {
        // Google Play: new apps and updates must target Android 16 (API 36) since 2026-08-31.
        android: { compileSdkVersion: 36, targetSdkVersion: 36, minSdkVersion: 24 },
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    // Set when the founder creates the EAS project; not a secret.
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
};

export default config;
