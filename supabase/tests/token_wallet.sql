-- Token wallet foundation test (migration 20261120100000_token_wallet.sql). Always rolls back. Every result must start
-- with "ok".
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  d uuid := gen_random_uuid();   -- demo profile
  r text := ''; n bigint; e1 bigint; e2 bigint; bal bigint;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@wallet.test', 'authenticated', 'authenticated' from unnest(array[a, b, d]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[a, b]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max, is_demo)
  values (d, 'Demo', 30, 'friendship', 18, 60, true);

  -- ===== Registration bonus =====
  select balance into bal from public.token_wallets where user_id = a;
  r := r || case when bal = 100 then 'ok new members get the 100-token bonus; ' else 'FAIL bonus ' || coalesce(bal, -1) || '; ' end;
  select count(*) into n from public.token_ledger where user_id = a and reason = 'registration_bonus';
  r := r || case when n = 1 then 'ok the bonus is one ledger entry; ' else 'FAIL bonus rows ' || n || '; ' end;
  select count(*) into n from public.token_ledger where user_id = d;
  r := r || case when n = 0 then 'ok demo profiles get no tokens; ' else 'FAIL demo tokens; ' end;
  -- Re-running the bonus (e.g. the backfill) never pays twice.
  perform private.ledger_post(a, 100, 'registration_bonus', 'profile', a::text, 'registration_bonus:' || a);
  select balance into bal from public.token_wallets where user_id = a;
  r := r || case when bal = 100 then 'ok replaying the bonus does not pay twice; ' else 'FAIL bonus replay ' || bal || '; ' end;

  -- ===== Ledger rules =====
  e1 := private.ledger_post(a, -30, 'message', 'message', 'm-1', 'spend:a:0001');
  e2 := private.ledger_post(a, -30, 'message', 'message', 'm-1', 'spend:a:0001');
  select balance into bal from public.token_wallets where user_id = a;
  r := r || case when e1 = e2 and bal = 70 then 'ok a replayed spend returns the same entry and charges once; '
                 else 'FAIL replay ' || bal || '; ' end;
  begin
    perform private.ledger_post(a, -40, 'message', 'message', 'm-2', 'spend:a:0001');
    r := r || 'FAIL reused key for a different amount; ';
  exception when unique_violation then r := r || 'ok a key cannot be reused for a different entry; ';
  end;
  begin
    perform private.ledger_post(a, -71, 'video_call', 'call', 'c-1', 'spend:a:0002');
    r := r || 'FAIL balance went negative; ';
  exception when raise_exception then r := r || 'ok balances can never go negative; ';
  end;
  select balance into bal from public.token_wallets where user_id = a;
  select sum(delta) into n from public.token_ledger where user_id = a;
  r := r || case when bal = n and bal = 70 then 'ok balance equals the sum of the ledger; ' else 'FAIL sum ' || n || ' vs ' || bal || '; ' end;
  select count(*) into n from public.token_ledger l
    where l.user_id = a and l.balance_after <> (select sum(x.delta) from public.token_ledger x where x.user_id = a and x.id <= l.id);
  r := r || case when n = 0 then 'ok every entry records the running balance; ' else 'FAIL running balance; ' end;
  begin
    perform private.ledger_post(a, 5, 'gift_received', null, null, 'gift:a:000001');
    r := r || 'FAIL unknown reason accepted; ';
  exception when check_violation then r := r || 'ok only listed reasons are allowed (no gifts or transfers); ';
  end;

  -- ===== Append-only =====
  begin
    update public.token_ledger set delta = 1000 where user_id = a;
    r := r || 'FAIL ledger edited; ';
  exception when insufficient_privilege then r := r || 'ok ledger entries cannot be edited, even by the owner; ';
  end;
  begin
    delete from public.token_ledger where user_id = a; -- policy-guard: allow (refusal test)
    r := r || 'FAIL ledger deleted; ';
  exception when insufficient_privilege then r := r || 'ok ledger entries cannot be deleted directly; ';
  end;

  -- ===== Money-like switches stay off =====
  begin
    update public.financial_flags set member_transfers = true;
    r := r || 'FAIL transfers enabled; ';
  exception when check_violation then r := r || 'ok member-to-member transfers cannot be switched on; ';
  end;
  begin
    update public.financial_flags set withdrawals = true;
    r := r || 'FAIL withdrawals enabled; ';
  exception when check_violation then r := r || 'ok withdrawals cannot be switched on; ';
  end;
  begin
    update public.financial_flags set cash_redemption = true;
    r := r || 'FAIL redemption enabled; ';
  exception when check_violation then r := r || 'ok cash redemption cannot be switched on; ';
  end;
  begin
    update public.financial_flags set creator_payouts = true;
    r := r || 'FAIL payouts enabled; ';
  exception when check_violation then r := r || 'ok creator payouts cannot be switched on; ';
  end;
  begin
    update public.financial_flags set token_purchases = true;
    r := r || 'FAIL purchases enabled; ';
  exception when check_violation then r := r || 'ok token purchases cannot be switched on; ';
  end;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname ~ '(transfer|withdraw|redeem|payout|send_tokens|gift)';
  r := r || case when n = 0 then 'ok no public function moves tokens between members or out; ' else 'FAIL ' || n || ' money functions; ' end;

  -- ===== Clients =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.token_ledger;
  r := r || case when n = 1 then 'ok members see only their own ledger; ' else 'FAIL ledger visible ' || n || '; ' end;
  select count(*) into n from public.token_wallets;
  r := r || case when n = 1 then 'ok members see only their own wallet; ' else 'FAIL wallets visible ' || n || '; ' end;
  begin
    update public.token_wallets set balance = 1000000 where user_id = b;
    r := r || 'FAIL client changed balance; ';
  exception when insufficient_privilege then r := r || 'ok clients cannot change balances; ';
  end;
  begin
    insert into public.token_ledger (user_id, delta, balance_after, reason, idempotency_key)
      values (b, 1000, 1100, 'admin_adjustment', 'forged-entry-1');
    r := r || 'FAIL client wrote ledger; ';
  exception when insufficient_privilege then r := r || 'ok clients cannot write ledger entries; ';
  end;
  begin
    perform private.ledger_post(b, 1000, 'admin_adjustment', null, null, 'forged-entry-2');
    r := r || 'FAIL client called ledger_post; ';
  exception when insufficient_privilege then r := r || 'ok clients cannot call the posting function; ';
  end;
  begin
    update public.metering_rates set registration_bonus = 100000;
    r := r || 'FAIL client changed rates; ';
  exception when insufficient_privilege then r := r || 'ok clients cannot change rates; ';
  end;
  select count(*) into n from public.metering_rates
    where registration_bonus = 100 and voice_tokens_per_minute = 60 and video_tokens_per_second = 5
      and free_likes_per_24h = 15 and free_dislikes_per_24h = 15 and free_rewinds_per_24h = 3
      and free_messages_per_24h = 10000 and not allowances_enforced and not call_metering_enabled;
  r := r || case when n = 1 then 'ok current token and free-tier rates are recorded with enforcement safely disabled; '
                 else 'FAIL rates; ' end;
  reset role;
  set local role anon;
  begin
    select count(*) into n from public.token_wallets;
    r := r || 'FAIL anon read wallets; ';
  exception when insufficient_privilege then r := r || 'ok anonymous visitors cannot read wallets; ';
  end;
  reset role;

  -- ===== Account deletion removes the member's wallet and ledger with the account =====
  delete from auth.users where id = b; -- policy-guard: allow (account deletion path)
  select count(*) into n from public.token_ledger where user_id = b;
  r := r || case when n = 0 then 'ok deleting an account removes its wallet and ledger; ' else 'FAIL ledger left; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
