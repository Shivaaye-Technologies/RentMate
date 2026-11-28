#!/usr/bin/env node
// Generates the native Android project exactly as EAS does before Gradle (`expo prebuild`), checks the parts that
// matter for the store and for security, then deletes it (android/ is never committed). No Android SDK needed.
// Run from apps/mobile: npm run check:native
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PACKAGE = "com.shivaayetechnologies.rentmate";
const keep = process.argv.includes("--keep");
let failed = false;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && detail ? ` (${detail})` : ""}`);
  if (!cond) failed = true;
};

rmSync("android", { recursive: true, force: true });
execFileSync("npx", ["expo", "prebuild", "--platform", "android", "--no-install", "--clean"], {
  stdio: "ignore",
  env: { ...process.env, CI: "1" },
});

try {
  const gradle = readFileSync("android/app/build.gradle", "utf8");
  const props = readFileSync("android/gradle.properties", "utf8");
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

  check(`applicationId is ${PACKAGE}`, gradle.includes(`applicationId '${PACKAGE}'`));
  check(`namespace is ${PACKAGE}`, gradle.includes(`namespace '${PACKAGE}'`));
  const javaDir = join("android/app/src/main/java", ...PACKAGE.split("."));
  check(
    "MainActivity and MainApplication live in that package",
    existsSync(javaDir) &&
      ["MainActivity.kt", "MainApplication.kt"].every((f) => readdirSync(javaDir).includes(f)),
  );
  check("compileSdk 37 (required by Expo SDK 58 libraries)", /android\.compileSdkVersion=37\b/.test(props));
  check("targetSdk 36 (Google Play requirement)", /android\.targetSdkVersion=36\b/.test(props));
  check("minSdk 24", /android\.minSdkVersion=24\b/.test(props));
  check("billing links only the Google Play store (expo-iap)", /^openiapStore=play$/m.test(props));

  check(
    "rentmate:// deep links open the app",
    /<intent-filter>[\s\S]*?android\.intent\.action\.VIEW[\s\S]*?android\.intent\.category\.BROWSABLE[\s\S]*?<data android:scheme="rentmate"\/>[\s\S]*?<\/intent-filter>/.test(
      manifest,
    ),
  );
  check(
    "single task launch mode (links reuse the open app)",
    /android:launchMode="singleTask"/.test(manifest),
  );

  const granted = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"\/>/g)].map((m) => m[1]);
  const allowed = new Set([
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.BLUETOOTH",
    "android.permission.CAMERA",
    "android.permission.INTERNET",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.RECORD_AUDIO",
    "android.permission.VIBRATE",
    "android.permission.WAKE_LOCK",
  ]);
  check(
    "only required LiveKit, network, and vibration permissions are requested",
    granted.every((p) => allowed.has(p)),
    granted.join(", "),
  );
  for (const p of ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "READ_CONTACTS"]) {
    check(
      `${p} is removed because the feature is not enabled`,
      manifest.includes(`<uses-permission android:name="android.permission.${p}" tools:node="remove"/>`),
    );
  }
  for (const p of ["CAMERA", "RECORD_AUDIO"]) {
    check(
      `${p} is available for opt-in LiveKit calls and live rooms`,
      granted.includes(`android.permission.${p}`),
    );
  }
  check(
    "secure session values are excluded from backups",
    /android:fullBackupContent="@xml\/secure_store_backup_rules"/.test(manifest) &&
      /android:dataExtractionRules="@xml\/secure_store_data_extraction_rules"/.test(manifest),
  );
  check("no cleartext (http) traffic allowed by default", !/usesCleartextTraffic="true"/.test(manifest));
} finally {
  if (!keep) rmSync("android", { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
