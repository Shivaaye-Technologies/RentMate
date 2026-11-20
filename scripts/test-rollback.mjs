#!/usr/bin/env node
// Rehearses the rollback SQL in docs/rollback/ on throwaway PGlite databases, newest step first. For each step: apply
// every migration, run the rollback files from the newest down to this step, check the schema matches a database
// that never had those migrations, run the earlier SQL suites, then re-apply the migrations and run their own suites.
// Never touches a real database.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const migrations = readdirSync(join(root, "supabase/migrations")).sort();

/** Newest first. Each step undoes `migrations` with `rollback`; `suites` test those migrations once re-applied. */
const STEPS = [
  {
    migrations: ["20261123140000_age_attestation_enforcement.sql"],
    rollback: "docs/rollback/20261123_age_attestation_enforcement.rollback.sql",
    suites: ["age_attestation.sql", "age_attestation_enforcement.sql", "age_attestation_abuse.sql"],
  },
  {
    migrations: ["20261123130000_age_attestation.sql"],
    rollback: "docs/rollback/20261123_age_attestation.rollback.sql",
    suites: ["age_attestation.sql"],
  },
  {
    migrations: ["20261123120000_account_deletion_photos.sql"],
    rollback: "docs/rollback/20261123_account_deletion_photos.rollback.sql",
    suites: ["account_deletion_photos.sql"],
  },
  {
    migrations: ["20261123110000_photo_privacy.sql"],
    rollback: "docs/rollback/20261123_photo_privacy.rollback.sql",
    suites: ["photo_privacy.sql"],
  },
  {
    migrations: ["20261123100000_integration_secret_strength.sql"],
    rollback: "docs/rollback/20261123_integration_secret_strength.rollback.sql",
    suites: ["integration_secret_strength.sql"],
  },
  {
    migrations: ["20261123090000_guest_host_mutes.sql"],
    rollback: "docs/rollback/20261123_guest_host_mutes.rollback.sql",
    suites: ["guest_host_mutes.sql"],
  },
  {
    migrations: ["20261122090000_recovery_codes_and_retention.sql"],
    rollback: "docs/rollback/20261122_recovery_codes_and_retention.rollback.sql",
    suites: ["recovery_codes_and_retention.sql"],
  },
  {
    migrations: ["20261121100000_admin_mfa.sql"],
    rollback: "docs/rollback/20261121_admin_mfa.rollback.sql",
    suites: ["admin_mfa.sql"],
  },
  {
    migrations: ["20261121090000_calls_and_live_rooms.sql"],
    rollback: "docs/rollback/20261121_calls_and_live_rooms.rollback.sql",
    suites: ["calls_and_live_rooms.sql"],
  },
  {
    migrations: ["20261120090000_audit_hardening.sql", "20261120100000_token_wallet.sql"],
    rollback: "docs/rollback/20261120_audit_hardening_and_wallet.rollback.sql",
    suites: ["audit_hardening.sql", "token_wallet.sql"],
  },
];
const EARLIER_SUITES = ["rls_flow.sql", "live_foundation.sql", "marketplace.sql"];

async function fresh(skip) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(read("supabase/tests/supabase_stubs.sql"));
  for (const f of migrations) if (!skip.includes(f)) await db.exec(read(`supabase/migrations/${f}`));
  return db;
}

// Shape of everything a migration can change: functions (with body hash and grants), policies, triggers, tables, columns.
const SHAPE = `
  select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
         || md5(pg_get_functiondef(p.oid)) || ' '
         || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '') as x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private')
  union all select 'policy ' || polrelid::regclass || ' ' || polname from pg_policy
  union all select 'trigger ' || tgrelid::regclass || ' ' || tgname from pg_trigger where not tgisinternal
  union all select 'table ' || schemaname || '.' || tablename from pg_tables where schemaname in ('public', 'private')
  union all select 'column ' || table_schema || '.' || table_name || '.' || column_name
  from information_schema.columns where table_schema in ('public', 'private')
  union all select 'publication ' || tablename from pg_publication_tables where pubname = 'supabase_realtime'
  order by 1`;
const shape = async (db) => (await db.query(SHAPE)).rows.map((r) => r.x);

async function suite(db, test) {
  try {
    await db.exec(read(`supabase/tests/${test}`));
    return { ok: false, line: `${test}: did not report results` };
  } catch (e) {
    const results = String(e.message)
      .replace(/^.*RESULTS:\s*/s, "")
      .split(/;\s*/)
      .filter(Boolean);
    const bad = results.filter((r) => !r.startsWith("ok"));
    return {
      ok: bad.length === 0 && /ROLLED BACK/.test(e.message),
      line: `${test}: ${results.length - bad.length}/${results.length} ok${bad.length ? ` (${bad.join("; ")})` : ""}`,
    };
  }
}

let failed = false;
for (let i = 0; i < STEPS.length; i++) {
  const undone = STEPS.slice(0, i + 1);
  const skip = undone.flatMap((s) => s.migrations);
  const label = undone.map((s) => s.rollback.replace("docs/rollback/", "")).join(" + ");
  const before = await shape(await fresh(skip));
  const db = await fresh([]);
  for (const s of undone) await db.exec(read(s.rollback));
  const after = await shape(db);
  // Privilege revocations from 20261120090000 (SEC-03) are deliberately kept; table grants are not part of SHAPE.
  const missing = before.filter((x) => !after.includes(x));
  const extra = after.filter((x) => !before.includes(x));
  if (missing.length || extra.length) {
    failed = true;
    console.log(`Rollback ${label} does not restore the previous schema:`);
    for (const x of missing) console.log(`  missing: ${x}`);
    for (const x of extra) console.log(`  left over: ${x}`);
  } else {
    console.log(`Rollback ${label} restores the previous schema (${before.length} objects compared).`);
  }
  for (const test of EARLIER_SUITES) {
    const r = await suite(db, test);
    console.log(`  after rollback, ${r.line}`);
    if (!r.ok) failed = true;
  }
  // Forward again, oldest undone step first.
  for (const s of [...undone].reverse()) {
    for (const f of s.migrations) await db.exec(read(`supabase/migrations/${f}`));
    for (const test of s.suites) {
      const r = await suite(db, test);
      console.log(`  after re-applying, ${r.line}`);
      if (!r.ok) failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
