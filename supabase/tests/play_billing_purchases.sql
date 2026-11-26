-- Google Play purchase recording (sandbox): secret guard, fail-closed gates, test-purchase-only credit, idempotency,
-- token reuse by another account, pending purchases, subscriptions, refunds with shortfall, RLS and append-only events.
-- Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();     -- tester
  other uuid := gen_random_uuid();  -- tester
  plain uuid := gen_random_uuid();  -- not a tester
  sec text := 'k9Qw2Lr7Zp4Xv1Tn8Bs5Hd3Jf6Gm0Ca9Ue2Yi7Ro4Wl1Pq8Nt5Kb3Mc6Vx0Az2';
  fp1 text := encode(sha256('token-one'::bytea), 'hex');
  fp2 text := encode(sha256('token-two'::bytea), 'hex');
  fp3 text := encode(sha256('token-three'::bytea), 'hex');
  fps text := encode(sha256('token-sub'::bytea), 'hex');
  fpx text := encode(sha256('token-x'::bytea), 'hex');
  r text := ''; j jsonb; n bigint; bal0 bigint; bal bigint; t text;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@billing.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, mb, other, plain]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, mb, other, plain]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');
  update public.profiles set is_tester = true where id in (mb, other);
  perform private.set_integration_secret('play_billing', sec);

  -- ===== Owner-level locks =====
  begin
    update public.billing_settings set live_enabled = true;
    r := r || 'FAIL live billing switched on; ';
  exception when check_violation then r := r || 'ok live billing is locked off; ';
  end;
  begin
    update public.financial_flags set token_purchases = true;
    r := r || 'FAIL purchases flag on; ';
  exception when check_violation then r := r || 'ok token purchases flag stays locked off; ';
  end;

  set local role anon;
  -- ===== Secret guard =====
  begin
    perform public.billing_record_play_purchase('wrong-secret-value-that-is-long-enough-000000', mb,
      'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', true, 1, now(), null);
    r := r || 'FAIL recorded without secret; ';
  exception when insufficient_privilege then r := r || 'ok purchase recording needs the integration secret; ';
  end;
  begin
    perform public.billing_revoke_play_purchase(null, fp1, 'x');
    r := r || 'FAIL revoke without secret; ';
  exception when insufficient_privilege then r := r || 'ok revocation needs the integration secret; ';
  end;

  -- ===== Fail closed =====
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'product_not_enabled' then 'ok disabled product credits nothing; '
                 else 'FAIL ' || j::text || '; ' end;
  reset role;
  update public.store_products set enabled = true where product_id in ('rentmate_tokens_50', 'rentmate_tokens_100', 'rentmate_monthly');
  set local role anon;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'billing_disabled' then 'ok billing sandbox off credits nothing; '
                 else 'FAIL ' || j::text || '; ' end;
  reset role;
  update public.billing_settings set sandbox_enabled = true;
  select balance into bal0 from public.token_wallets where user_id = mb;
  set local role anon;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', false, 1, now(), null);
  r := r || case when j->>'outcome' = 'live_purchases_disabled' then 'ok a real (non-test) purchase is refused; '
                 else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, plain, 'rentmate_tokens_50', fpx, 'GPA.9', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'not_a_tester' then 'ok non-tester accounts are refused; '
                 else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_100', fp2, 'GPA.2', 'pending', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'not_purchased' then 'ok pending purchase credits nothing; '
                 else 'FAIL ' || j::text || '; ' end;
  reset role;
  select count(*) into n from public.store_purchases;
  r := r || case when n = 0 then 'ok refused purchases leave no purchase row; ' else 'FAIL rows ' || n || '; ' end;
  select count(*) into n from public.store_purchase_events where event = 'refused';
  r := r || case when n >= 4 then 'ok every refusal is logged; ' else 'FAIL refusals logged ' || n || '; ' end;

  -- ===== Credit, replay, reuse =====
  set local role anon;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'credited' and (j->>'tokens')::int = 50 then 'ok verified test purchase credits catalog tokens; '
                 else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'already_recorded' then 'ok replaying the same token is idempotent; '
                 else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, other, 'rentmate_tokens_50', fp1, 'GPA.1', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'token_reused' then 'ok another account cannot reuse a purchase token; '
                 else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_100', fp2, 'GPA.2', 'purchased', true, 1, now(), null);
  reset role;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = bal0 + 150 then 'ok balance rose by exactly 150; ' else 'FAIL balance ' || bal || ' vs ' || bal0 || '; ' end;
  select balance into bal from public.token_wallets where user_id = other;
  r := r || case when coalesce(bal, 0) = coalesce((select balance from public.token_wallets where user_id = other), 0)
                  and not exists (select 1 from public.token_ledger where user_id = other and reason = 'token_purchase')
                 then 'ok reusing account got nothing; ' else 'FAIL reuse credited; ' end;
  select count(*) into n from public.token_ledger where user_id = mb and reason = 'token_purchase';
  r := r || case when n = 2 then 'ok one ledger entry per purchase; ' else 'FAIL entries ' || n || '; ' end;
  select catalog_price_inr_paise::text into t from public.store_purchases where token_fingerprint = fp1;
  r := r || case when t = (select price_inr_paise::text from public.token_package_catalog where sku = 'planning_50')
                 then 'ok catalog price is snapshotted; ' else 'FAIL snapshot; ' end;

  set local role anon;
  perform public.billing_mark_completed(sec, fp1, true);
  perform public.billing_mark_completed(sec, fp1, true);
  reset role;
  select count(*) into n from public.store_purchases where token_fingerprint = fp1 and consumed_at is not null and acknowledged_at is not null;
  r := r || case when n = 1 then 'ok consume recorded (retry-safe); ' else 'FAIL consume; ' end;

  -- ===== Member access =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select count(*) into n from public.store_purchases;
  r := r || case when n = 2 then 'ok member sees own purchases; ' else 'FAIL member sees ' || n || '; ' end;
  begin
    select token_fingerprint into t from public.store_purchases limit 1;
    r := r || 'FAIL fingerprint readable; ';
  exception when insufficient_privilege then r := r || 'ok fingerprint column is not readable by members; ';
  end;
  begin
    insert into public.store_purchases (product_id, kind, user_id, token_fingerprint, test_purchase, status)
      values ('rentmate_tokens_50', 'token_package', mb, fp3, true, 'credited');
    r := r || 'FAIL member inserted purchase; ';
  exception when insufficient_privilege then r := r || 'ok members cannot write purchases; ';
  end;
  begin
    perform public.admin_set_billing_sandbox(false);
    r := r || 'FAIL member toggled sandbox; ';
  exception when insufficient_privilege or raise_exception then r := r || 'ok only admins toggle the billing sandbox; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  select count(*) into n from public.store_purchases;
  r := r || case when n = 0 then 'ok others cannot see the purchases; ' else 'FAIL leak; ' end;
  begin
    perform 1 from public.store_purchase_events limit 1;
    r := r || 'FAIL events readable; ';
  exception when insufficient_privilege then r := r || 'ok purchase events are not member-readable; ';
  end;
  reset role;

  -- ===== Refund with shortfall =====
  -- Spend down to 20 tokens, then refund the 100-token purchase: only 20 can be clawed back.
  select balance into bal from public.token_wallets where user_id = mb;
  perform private.ledger_post(mb, -(bal - 20), 'admin_adjustment', 'test', null, 'test-spend-' || mb::text);
  set local role anon;
  j := public.billing_revoke_play_purchase(sec, fp2, 'refunded');
  r := r || case when j->>'outcome' = 'revoked_shortfall' and (j->>'reversed')::int = 20
                 then 'ok refund claws back only what remains and records the shortfall; ' else 'FAIL ' || j::text || '; ' end;
  j := public.billing_revoke_play_purchase(sec, fp2, 'refunded');
  r := r || case when j->>'outcome' = 'already_revoked' then 'ok repeated refund is idempotent; ' else 'FAIL ' || j::text || '; ' end;
  reset role;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = 0 then 'ok balance never goes negative; ' else 'FAIL balance ' || bal || '; ' end;
  select count(*) into n from public.moderation_actions where action = 'purchase_reversal_shortfall';
  r := r || case when n = 1 then 'ok shortfall is flagged for review; ' else 'FAIL shortfall log ' || n || '; ' end;
  set local role anon;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_tokens_100', fp2, 'GPA.2', 'purchased', true, 1, now(), null);
  r := r || case when j->>'outcome' = 'already_recorded' and j->>'status' = 'revoked_shortfall'
                 then 'ok a refunded token cannot be credited again; ' else 'FAIL ' || j::text || '; ' end;

  -- ===== Subscription =====
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_monthly', fps, 'GPA.S', 'active', true, 1, now(), now() - interval '1 day');
  r := r || case when j->>'outcome' = 'not_entitled' then 'ok expired period grants nothing; ' else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_monthly', fps, 'GPA.S', 'active', true, 1, now(), now() + interval '30 days');
  r := r || case when j->>'outcome' = 'entitled' then 'ok verified subscription creates an entitlement; ' else 'FAIL ' || j::text || '; ' end;
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_monthly', fps, 'GPA.S', 'grace', true, 1, now(), now() + interval '33 days');
  r := r || case when j->>'outcome' = 'subscription_updated' then 'ok lifecycle update applies; ' else 'FAIL ' || j::text || '; ' end;
  reset role;
  select status into t from public.subscription_entitlements where provider_purchase_id = fps;
  r := r || case when t = 'grace' then 'ok entitlement follows Play state; ' else 'FAIL status ' || coalesce(t, 'null') || '; ' end;
  select count(*) into n from public.token_ledger where user_id = mb and reason = 'token_purchase' and ref_id = (select id::text from public.store_purchases where token_fingerprint = fps);
  r := r || case when n = 0 then 'ok subscriptions grant no tokens; ' else 'FAIL tokens granted; ' end;
  set local role anon;
  j := public.billing_revoke_play_purchase(sec, fps, 'revoked');
  j := public.billing_record_play_purchase(sec, mb, 'rentmate_monthly', fps, 'GPA.S', 'active', true, 1, now(), now() + interval '30 days');
  r := r || case when j->>'outcome' = 'not_applied' then 'ok a revoked subscription cannot be reactivated by replay; ' else 'FAIL ' || j::text || '; ' end;
  reset role;
  select status into t from public.subscription_entitlements where provider_purchase_id = fps;
  r := r || case when t = 'revoked' then 'ok revocation removes entitlement; ' else 'FAIL status ' || t || '; ' end;

  -- ===== RTDN dedupe, lookup =====
  set local role anon;
  r := r || case when public.billing_rtdn_first_seen(sec, 'msg-1') and not public.billing_rtdn_first_seen(sec, 'msg-1')
                 then 'ok RTDN messages are processed once; ' else 'FAIL rtdn dedupe; ' end;
  select count(*) into n from public.billing_purchase_by_fingerprint(sec, fp1);
  r := r || case when n = 1 then 'ok purchase lookup by fingerprint works with the secret; ' else 'FAIL lookup; ' end;
  begin
    perform public.billing_purchase_by_fingerprint('nope-nope-nope-nope-nope-nope-nope-nope', fp1);
    r := r || 'FAIL lookup without secret; ';
  exception when insufficient_privilege then r := r || 'ok lookup needs the secret; ';
  end;
  reset role;

  -- ===== Append-only =====
  begin
    update public.store_purchase_events set detail = 'edited';
    r := r || 'FAIL event edited; ';
  exception when others then r := r || 'ok purchase events are append-only; ';
  end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
