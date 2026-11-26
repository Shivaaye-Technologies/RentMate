#!/usr/bin/env node
// Server-only secrets must never reach the browser bundle. Builds the web app with unique dummy values in every
// server-side secret variable, then fails if any of them appears in apps/web/dist. A VITE_ variable is set the same
// way as a control, proving the search finds values that Vite does inline. Uses throwaway values only; never reads
// real environment secrets.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SERVER_ONLY = [
  "LIVEKIT_API_SECRET",
  "LIVEKIT_API_KEY",
  "LIVE_WEBHOOK_DB_SECRET",
  "BILLING_DB_SECRET",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "GOOGLE_PLAY_RTDN_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const canary = (name) => `canary_${name}_${randomBytes(12).toString("hex")}`;
const values = Object.fromEntries(SERVER_ONLY.map((n) => [n, canary(n)]));
const control = `https://${randomBytes(6).toString("hex")}.supabase.co`;

execFileSync("npm", ["run", "build", "-w", "apps/web"], {
  stdio: "ignore",
  env: { ...process.env, ...values, VITE_SUPABASE_URL: control, VITE_SUPABASE_ANON_KEY: "publishable-test" },
});

function* files(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}
const dist = join("apps", "web", "dist");
let bundle = "";
for (const f of files(dist)) bundle += readFileSync(f, "latin1");

let failed = false;
if (!bundle.includes(control)) {
  console.log("FAIL control: the VITE_ value was not found, so this check cannot detect leaks");
  failed = true;
}
for (const [name, value] of Object.entries(values)) {
  const leaked = bundle.includes(value);
  if (leaked) failed = true;
  console.log(
    `${leaked ? "FAIL" : "ok  "} ${name} ${leaked ? "is in the browser bundle" : "not in the browser bundle"}`,
  );
}
// Anything named like a secret must not be exposed through Vite's public prefix (git grep exits 1 on no match).
let exposed = "";
try {
  exposed = execFileSync(
    "git",
    [
      "grep",
      "-nE",
      "VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE)",
      "--",
      "apps/web",
      "render.yaml",
      ".env.example",
    ],
    { encoding: "utf8" },
  );
} catch (e) {
  if (e.status !== 1) throw e;
}
if (exposed) {
  failed = true;
  console.log(`FAIL secret-named VITE_ variable:\n${exposed}`);
}
console.log(
  failed ? "bundle secret check FAILED" : `bundle secret check: ${SERVER_ONLY.length} server secrets absent`,
);
process.exit(failed ? 1 : 0);
