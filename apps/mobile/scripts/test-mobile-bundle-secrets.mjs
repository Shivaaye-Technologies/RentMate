#!/usr/bin/env node
// Server-only secrets must never reach the Android bundle. Exports the app's JavaScript for Android with unique dummy
// values in every server-side secret variable, then fails if any of them appears in dist/. A public EXPO_PUBLIC_ value
// is set the same way as a control, proving the search finds values that Expo does inline. Throwaway values only;
// never reads real environment secrets. Run from apps/mobile: npm run check:bundle-secrets
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const SERVER_ONLY = [
  "LIVEKIT_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVE_WEBHOOK_DB_SECRET",
  "BILLING_DB_SECRET",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "GOOGLE_PLAY_RTDN_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
];
const canary = (name) => `canary_${name}_${randomBytes(12).toString("hex")}`;
const values = Object.fromEntries(SERVER_ONLY.map((n) => [n, canary(n)]));
const control = `https://${randomBytes(6).toString("hex")}-control.onrender.com`;

rmSync("dist", { recursive: true, force: true });
execFileSync("npx", ["expo", "export", "--platform", "android", "--output-dir", "dist"], {
  stdio: "inherit",
  env: {
    ...process.env,
    ...values,
    CI: "1",
    EXPO_OFFLINE: "1",
    EXPO_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_placeholder",
    EXPO_PUBLIC_API_URL: control,
  },
});

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}
const all = [...files("dist")].map((p) => readFileSync(p).toString("latin1")).join("\n");

let failed = false;
if (!all.includes(control.replace("https://", ""))) {
  console.log("FAIL control: the public EXPO_PUBLIC_API_URL was not found, so the search is not working");
  failed = true;
} else console.log("ok   control: public EXPO_PUBLIC_API_URL is in the bundle (search works)");
for (const [name, value] of Object.entries(values)) {
  if (all.includes(value)) {
    console.log(`FAIL ${name} reached the Android bundle`);
    failed = true;
  } else console.log(`ok   ${name} not in the Android bundle`);
}
// The role name "service_role" itself may appear: the app's config guard compares against it to refuse such keys.
process.exit(failed ? 1 : 0);
