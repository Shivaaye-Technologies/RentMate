#!/usr/bin/env node
// Rehearses docs/rollback/20261120_audit_hardening_and_wallet.rollback.sql on a throwaway PGlite database:
// apply every migration, roll the two 2026-11-20 migrations back, check the schema matches a database that never had
// them, run the earlier SQL suites, then re-apply both migrations (forward again). Never touches a real database.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const NEW = ["20261120090000_audit_hardening.sql", "20261120100000_token_wallet.sql"];
const migrations = readdirSync(join(root, "supabase/migrations")).sort();

async function fresh(skip) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(read("supabase/tests/supabase_stubs.sql"));
  for (const f of migrations) if (!skip.includes(f)) await db.exec(read(`supabase/migrations/${f}`));
  return db;
}

// Shape of everything a migration can change: functions (with body hash), policies, triggers, tables, columns, grants.
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
  order by 1`;
const shape = async (db) => (await db.query(SHAPE)).rows.map((r) => r.x);

const before = await shape(await fresh(NEW));
const db = await fresh([]);
await db.exec(read("docs/rollback/20261120_audit_hardening_and_wallet.rollback.sql"));
const after = await shape(db);

// SEC-03 privilege revocations are deliberately kept, so grants are compared separately (function ACLs differ only
// where a function was re-created; table grants are not part of SHAPE).
const missing = before.filter((x) => !after.includes(x));
const extra = after.filter((x) => !before.includes(x));
let failed = false;
if (missing.length || extra.length) {
  failed = true;
  console.log("Rollback does not restore the previous schema:");
  for (const x of missing) console.log(`  missing: ${x}`);
  for (const x of extra) console.log(`  left over: ${x}`);
} else {
  console.log(`Rollback restores the previous schema (${before.length} objects compared).`);
}

for (const test of ["rls_flow.sql", "live_foundation.sql", "marketplace.sql"]) {
  try {
    await db.exec(read(`supabase/tests/${test}`));
    failed = true;
  } catch (e) {
    const results = String(e.message)
      .replace(/^.*RESULTS:\s*/s, "")
      .split(/;\s*/)
      .filter(Boolean);
    const bad = results.filter((r) => !r.startsWith("ok"));
    console.log(`after rollback, ${test}: ${results.length - bad.length}/${results.length} ok`);
    if (bad.length || !/ROLLED BACK/.test(e.message)) failed = true;
  }
}

for (const f of NEW) await db.exec(read(`supabase/migrations/${f}`));
for (const test of ["audit_hardening.sql", "token_wallet.sql"]) {
  try {
    await db.exec(read(`supabase/tests/${test}`));
    failed = true;
  } catch (e) {
    const results = String(e.message)
      .replace(/^.*RESULTS:\s*/s, "")
      .split(/;\s*/)
      .filter(Boolean);
    const bad = results.filter((r) => !r.startsWith("ok"));
    console.log(`after re-applying, ${test}: ${results.length - bad.length}/${results.length} ok`);
    for (const b of bad) console.log(`  ${b}`);
    if (bad.length || !/ROLLED BACK/.test(e.message)) failed = true;
  }
}
process.exit(failed ? 1 : 0);
