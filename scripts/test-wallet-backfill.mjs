#!/usr/bin/env node
// Upgrade test for 20261120100000_token_wallet.sql on a database that already has members (as production will).
// Migrates to just before the wallet, adds real and demo members, applies the wallet and every later migration,
// replays the backfill, and checks: each existing real member gets exactly one 100-token bonus, demo members get
// none, replays never pay twice, and members created afterwards get theirs from the trigger. Throwaway PGlite only.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const WALLET = "20261120100000_token_wallet.sql";
const migrations = readdirSync(join(root, "supabase/migrations")).sort();
const at = migrations.indexOf(WALLET);
if (at < 0) throw new Error(`${WALLET} not found`);

const db = new PGlite({ extensions: { btree_gist } });
await db.exec(read("supabase/tests/supabase_stubs.sql"));
for (const f of migrations.slice(0, at)) await db.exec(read(`supabase/migrations/${f}`));

const REAL = ["a1", "a2", "a3"].map((s, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
const DEMO = "00000000-0000-4000-8000-0000000000d1";
for (const id of [...REAL, DEMO]) {
  await db.query(
    `insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')`,
    [id, `${id}@upgrade.test`],
  );
}
for (const id of REAL) {
  await db.query(
    `insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values ($1, 'Member', 30, 'friendship', 18, 60)`,
    [id],
  );
}
await db.query(
  `insert into public.profiles (id, display_name, age, looking_for, age_min, age_max, is_demo) values ($1, 'Demo', 30, 'friendship', 18, 60, true)`,
  [DEMO],
);

for (const f of migrations.slice(at)) await db.exec(read(`supabase/migrations/${f}`));

let failed = false;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
};
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

let rows = await q(`select user_id::text, balance from public.token_wallets order by 1`);
check(
  "each existing real member received exactly 100 tokens",
  rows.length === 3 &&
    rows.every((r) => Number(r.balance) === 100) &&
    rows.every((r) => REAL.includes(r.user_id)),
  JSON.stringify(rows),
);
rows = await q(`select count(*)::int n from public.token_ledger where user_id = $1`, [DEMO]);
check("demo members received nothing", rows[0].n === 0);
rows = await q(`select user_id, count(*)::int n from public.token_ledger group by 1`);
check(
  "one ledger entry per member",
  rows.every((r) => r.n === 1),
  JSON.stringify(rows),
);

// Replay the backfill (e.g. the migration's loop run a second time by mistake).
await db.exec(`do $$ declare p record; begin
  for p in select id from public.profiles where not is_demo loop
    perform private.ledger_post(p.id, 100, 'registration_bonus', 'profile', p.id::text, 'registration_bonus:' || p.id);
  end loop; end $$;`);
rows = await q(
  `select sum(balance)::int s, (select count(*)::int from public.token_ledger) n from public.token_wallets`,
);
check("replaying the backfill pays nobody twice", rows[0].s === 300 && rows[0].n === 3, JSON.stringify(rows));

// A member who joins after the upgrade gets the bonus from the trigger.
const NEW = "00000000-0000-4000-8000-0000000000a9";
await db.query(`insert into auth.users (id, email) values ($1, 'new@upgrade.test')`, [NEW]);
await db.query(
  `insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values ($1, 'Member', 30, 'friendship', 18, 60)`,
  [NEW],
);
rows = await q(`select balance from public.token_wallets where user_id = $1`, [NEW]);
check("members who join later get the bonus once", rows.length === 1 && Number(rows[0].balance) === 100);
rows = await q(
  `select coalesce(sum(delta), 0)::int s from public.token_ledger where reason <> 'registration_bonus'`,
);
check("nothing else was credited or charged", rows[0].s === 0);

process.exit(failed ? 1 : 0);
