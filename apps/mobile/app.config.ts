import type { ExpoConfig } from "expo/config";

/**
 * RentMate Android app configuration (Expo SDK 58).
 *
 * Package id: com.shivaayetechnologies.rentmate — approved by the founder as permanent (2026-11-20). It cannot change
 * after the first Google Play upload, so it is a constant (no environment override) and a test pins it.
 *
 * Only public values reach the app: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY (publishable) and
 * EXPO_PUBLIC_API_URL. Server secrets (LiveKit key/secret, service role key) never belong here.
 */
/** The permanent Android application id (also the applicationId and the namespace of the native project). */
export const ANDROID_PACKAGE = "com.shivaayetechnologies.rentmate";
/** Custom URL scheme for app links such as rentmate://auth/callback. */
export const URL_SCHEME = "rentmate";
/** Expo organization that owns the EAS project (required for an organization-owned project). Not a secret. */
export const EXPO_OWNER = "shivaaye-technologies";
/** EAS project "rentmate" (created by the founder, 2026-11-20). An identifier, not a secret. */
export const EAS_PROJECT_ID = "8b134aa5-6f2c-4741-90d9-05d03dae3662";

const config: ExpoConfig = {
  name: "RentMate",
  slug: "rentmate",
  owner: EXPO_OWNER,
  scheme: URL_SCHEME,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  platforms: ["android"],
  android: {
    package: ANDROID_PACKAGE,
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
    // Keystore-encrypted session values cannot be decrypted after a restore, so they are excluded from backups.
    ["expo-secure-store", { configureAndroidBackup: true }],
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
    // Links this app to the EAS project shivaaye-technologies/rentmate.
    eas: { projectId: EAS_PROJECT_ID },
  },
};

export default config;
