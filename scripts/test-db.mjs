#!/usr/bin/env node
// Applies every migration to a throwaway in-memory Postgres (PGlite), seeds the
// demo profiles, and runs the SQL permission tests. Never touches a real database.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { DEFAULTS } from "./demo/generate-demo-profiles.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
// btree_gist backs the booking overlap constraint (installed on Supabase by the marketplace migration).
const db = new PGlite({ extensions: { btree_gist } });
let failed = false;

await db.exec(read("supabase/tests/supabase_stubs.sql"));
for (const file of readdirSync(join(root, "supabase/migrations")).sort()) {
  try {
    await db.exec(read(`supabase/migrations/${file}`));
  } catch (e) {
    console.error(`Migration failed: ${file}\n  ${e.message}`);
    process.exit(1);
  }
}
console.log("Migrations applied.");

// Seeding twice proves the seed is repeatable.
for (let i = 0; i < 2; i++) await db.exec(read("supabase/seed/demo_profiles.sql"));
const { rows } = await db.query("select count(*)::int as n from public.profiles where is_demo");
console.log(`Demo seed applied twice: ${rows[0].n} demo profiles.`);
if (rows[0].n !== DEFAULTS.count) failed = true;

for (const test of [
  "rls_flow.sql",
  "demo_isolation.sql",
  "demo_mode.sql",
  "discover_activity.sql",
  "profile_details.sql",
  "live_foundation.sql",
  "no_adult_content.sql",
  "policy_audit.sql",
  "marketplace.sql",
  "audit_hardening.sql",
  "token_wallet.sql",
  "token_subscription_entitlements.sql",
  "payment_account_registry.sql",
  "financial_config_versions.sql",
  "calls_and_live_rooms.sql",
  "admin_mfa.sql",
  "recovery_codes_and_retention.sql",
  "guest_host_mutes.sql",
  "integration_secret_strength.sql",
  "photo_privacy.sql",
  "account_deletion_photos.sql",
  "age_attestation.sql",
  "age_attestation_enforcement.sql",
  "age_attestation_abuse.sql",
  "booking_token_holds.sql",
  "play_billing_purchases.sql",
  "admin_role_tiers.sql",
  "booking_expiry_job.sql",
  "schema_security_audit.sql",
]) {
  try {
    await db.exec(read(`supabase/tests/${test}`));
    console.error(`${test}: did not report results`);
    failed = true;
  } catch (e) {
    const results = String(e.message)
      .replace(/^.*RESULTS:\s*/s, "")
      .split(/;\s*/)
      .filter(Boolean);
    const bad = results.filter((r) => !r.startsWith("ok"));
    console.log(`${test}: ${results.length - bad.length}/${results.length} ok`);
    for (const b of bad) console.log(`  ${b}`);
    if (!/ROLLED BACK/.test(e.message) || bad.length) failed = true;
  }
}

// Trim keeps demo profiles up to a number and removes the rest (nothing else).
const { trimSql } = await import("./demo/generate-demo-profiles.mjs");
await db.exec(trimSql(120));
const trimmed = (await db.query("select count(*)::int as n from public.profiles where is_demo")).rows[0].n;
console.log(`Trim to 120: ${trimmed} demo profiles left.`);
if (trimmed !== 120) failed = true;

// Cleanup removes every demo profile and nothing else.
await db.exec(`
  insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'real@example.test');
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  values ('00000000-0000-4000-8000-000000000001', 'Real Person', 30, 'relationship', 25, 35);
`);
const before = (await db.query("select count(*)::int as n from public.profiles where not is_demo")).rows[0].n;
await db.exec(read("supabase/seed/demo_cleanup.sql"));
const after = await db.query(
  "select count(*) filter (where is_demo)::int as demo, count(*) filter (where not is_demo)::int as real from public.profiles",
);
console.log(`Cleanup: ${after.rows[0].demo} demo left, real profiles ${before} -> ${after.rows[0].real}.`);
if (after.rows[0].demo !== 0 || after.rows[0].real !== before) failed = true;

await db.close();
process.exit(failed ? 1 : 0);
