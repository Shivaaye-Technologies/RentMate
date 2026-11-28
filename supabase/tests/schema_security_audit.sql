-- Schema-wide security invariants, checked after every migration. Always rolls back. Every result must start with "ok".
do $$
declare r text := ''; t text;
begin
  select string_agg(tablename, ',') into t from pg_tables where schemaname = 'public' and not rowsecurity;
  r := r || case when t is null then 'ok every public table has RLS enabled; ' else 'FAIL no RLS: ' || t || '; ' end;

  select string_agg(n.nspname || '.' || p.proname, ',') into t
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('public', 'private')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  r := r || case when t is null then 'ok every security-definer function pins search_path; ' else 'FAIL search_path: ' || t || '; ' end;

  select string_agg(distinct table_name || ':' || privilege_type, ',') into t
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  r := r || case when t is null then 'ok anon cannot write any public table; ' else 'FAIL anon writes: ' || t || '; ' end;

  select string_agg(distinct table_name, ',') into t
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT';
  r := r || case when t is null then 'ok anon cannot read any public table; ' else 'FAIL anon reads: ' || t || '; ' end;

  -- Signed-out callers reach only secret-guarded integration functions and the public demo listing.
  select string_agg(p.proname, ',' order by p.proname) into t
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('billing_mark_completed', 'billing_purchase_by_fingerprint', 'billing_record_play_purchase',
                          'billing_revoke_play_purchase', 'billing_rtdn_first_seen', 'booking_jobs_expire', 'booking_jobs_settle',
                          'demo_mode_profiles', 'live_kicks_claim', 'live_kicks_done', 'live_webhook_ingest');
  r := r || case when t is null then 'ok anon can execute only the reviewed allowlist; ' else 'FAIL anon executes: ' || t || '; ' end;

  -- The ledger cannot be written by members or signed-out callers.
  r := r || case when not has_function_privilege('authenticated', 'private.ledger_post(uuid, bigint, text, text, text, text, uuid)', 'execute')
                  and not has_function_privilege('anon', 'private.ledger_post(uuid, bigint, text, text, text, text, uuid)', 'execute')
                 then 'ok ledger_post is server-only; ' else 'FAIL ledger_post executable; ' end;
  r := r || case when not has_table_privilege('authenticated', 'public.token_ledger', 'insert')
                  and not has_table_privilege('authenticated', 'public.token_ledger', 'update')
                  and not has_table_privilege('authenticated', 'public.token_wallets', 'update')
                 then 'ok members cannot write the ledger or wallets; ' else 'FAIL ledger writable; ' end;

  -- Money switches stay locked by constraints.
  select string_agg(conname, ',' order by conname) into t from pg_constraint
  where conname in ('purchases_off', 'deposits_off', 'transfers_off', 'withdrawals_off', 'redemption_off', 'payouts_off',
                    'live_billing_off', 'live_spend_off');
  r := r || case when t = 'deposits_off,live_billing_off,live_spend_off,payouts_off,purchases_off,redemption_off,transfers_off,withdrawals_off'
                 then 'ok all money switches are locked off by constraints; ' else 'FAIL constraints: ' || coalesce(t, 'none') || '; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
