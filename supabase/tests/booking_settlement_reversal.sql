-- Decisions on disputes raised after settlement (migrations 20261126160000, 20261126170000). Always rolls back.
-- Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  cm uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();
  other uuid := gen_random_uuid();
  r text := ''; n bigint; t text; bal bigint; bal0 bigint; ok boolean;
  base timestamptz; svc uuid; b1 uuid; b2 uuid; b3 uuid;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@reversal.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, modr, cm, mb, other]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, modr, cm, mb, other]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin'), (modr, 'moderator');
  update public.profiles set is_tester = true where id in (cm, mb);
  base := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 days 9 hours') at time zone 'Asia/Kolkata';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_profiles (user_id, headline, city, area) values (cm, 'Friendly city guide', 'Pune', 'Baner');
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_review_companion(cm, 'approved', true, 'Identity and age checked');
  perform public.admin_set_booking_token_sandbox(true);
  perform public.admin_grant_sandbox_tokens(mb, 1000, 'reversal-grant-1');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, price_tokens, min_minutes, max_minutes)
    values (cm, 'coffee', 'Coffee and conversation', 'hourly', 900, 120, 60, 180) returning id into svc;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute)
    select cm, d, 0, 1440 from generate_series(0, 6) d;

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  b1 := public.booking_request_with_tokens(svc, base, 60, 'Cafe Good Luck, FC Road', '', 'rev-b1-00001');
  b2 := public.booking_request_with_tokens(svc, base + interval '2 hours', 60, 'Cafe Good Luck, FC Road', '', 'rev-b2-00001');
  b3 := public.booking_request_with_tokens(svc, base + interval '4 hours', 60, 'Cafe Good Luck, FC Road', '', 'rev-b3-00001');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(b1, 'accept', null);
  perform public.booking_respond(b2, 'accept', null);
  perform public.booking_respond(b3, 'accept', null);
  reset role;
  update public.bookings set starts_at = now() - interval '3 days' - interval '1 hour' * k,
                             ends_at = now() - interval '3 days' - interval '1 hour' * k + interval '30 minutes'
  from (values (b1, 0), (b2, 2), (b3, 4)) v(id, k) where bookings.id = v.id;

  -- Both participants confirm all three; they complete and settle.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  perform public.booking_complete(b1); perform public.booking_complete(b2); perform public.booking_complete(b3);
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_complete(b1); perform public.booking_complete(b2); perform public.booking_complete(b3);
  select pending_tokens into n from public.my_creator_booking_earnings();
  r := r || case when n > 0 then 'ok creator has pending earnings from three bookings; ' else 'FAIL pending ' || n || '; ' end;
  -- The member disputes b1 and b2 after settlement; b3 stays completed.
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select balance into bal0 from public.token_wallets where user_id = mb;
  perform public.booking_dispute(b1, 'The companion never arrived at the cafe.');
  perform public.booking_dispute(b2, 'We met but it ended after ten minutes.');
  reset role;
  select string_agg(h.status, ',' order by array_position(array[b1, b2, b3], h.booking_id)) into t
    from public.booking_token_holds h where h.booking_id in (b1, b2, b3);
  r := r || case when t = 'settled,settled,settled' then 'ok a late dispute leaves the hold settled; ' else 'FAIL holds ' || t || '; ' end;

  -- ===== Who may decide =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_decide_settled_dispute(b1, 'reverse', 'Moderator attempt');
    r := r || 'FAIL a moderator reversed a settlement; ';
  exception when insufficient_privilege then r := r || 'ok moderators cannot reverse settlements; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_decide_settled_dispute(b1, 'reverse', 'Member attempt');
    r := r || 'FAIL a member reversed their own booking; ';
  exception when insufficient_privilege then r := r || 'ok members cannot reverse; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_decide_settled_dispute(b3, 'reverse', 'Not disputed at all');
    r := r || 'FAIL reversed an undisputed booking; ';
  exception when raise_exception then r := r || 'ok only disputed settled bookings qualify; ';
  end;
  begin
    perform public.admin_decide_settled_dispute(b1, 'reverse', 'no');
    r := r || 'FAIL reversed without a reason; ';
  exception when invalid_parameter_value then r := r || 'ok a reason is required; ';
  end;
  begin
    perform public.admin_decide_settled_dispute(b1, 'refund-everything', 'Wrong action name');
    r := r || 'FAIL unknown action accepted; ';
  exception when invalid_parameter_value then r := r || 'ok unknown actions are refused; ';
  end;

  -- ===== Reverse b1 =====
  perform public.admin_decide_settled_dispute(b1, 'reverse', 'Companion did not attend; refund member');
  begin
    perform public.admin_decide_settled_dispute(b1, 'reverse', 'Second attempt to refund');
    r := r || 'FAIL reversed twice; ';
  exception when raise_exception then r := r || 'ok a settlement is reversed at most once; ';
  end;
  -- ===== Uphold b2 =====
  perform public.admin_decide_settled_dispute(b2, 'uphold', 'Meeting happened as booked');
  reset role;

  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = bal0 + 120 then 'ok the member got exactly the hold back; ' else 'FAIL balance ' || bal || ' vs ' || bal0 || '; ' end;
  select count(*) into n from public.token_ledger where idempotency_key = 'booking_reversal:' || b1;
  r := r || case when n = 1 then 'ok one reversal ledger entry; ' else 'FAIL reversal entries ' || n || '; ' end;
  select count(*) into n from public.token_ledger where idempotency_key like 'booking_re%:' || b2;
  r := r || case when n = 0 then 'ok upholding moves no tokens; ' else 'FAIL uphold entries ' || n || '; ' end;
  select b.status into t from public.bookings b where b.id = b1;
  r := r || case when t = 'cancelled' then 'ok reversed booking is cancelled; ' else 'FAIL b1 ' || t || '; ' end;
  select b.status into t from public.bookings b where b.id = b2;
  r := r || case when t = 'completed' then 'ok upheld booking is completed again; ' else 'FAIL b2 ' || t || '; ' end;
  select count(*) into n from public.creator_booking_earnings where booking_id = b1;
  r := r || case when n = 1 then 'ok the earnings row is kept, not edited away; ' else 'FAIL earnings rows ' || n || '; ' end;
  select creator_tokens_reversed + commission_tokens_reversed into n from public.booking_settlement_reversals where booking_id = b1;
  r := r || case when n = 120 then 'ok the reversal cancels earnings and commission together; ' else 'FAIL reversed ' || n || '; ' end;
  select count(*) into n from public.booking_token_hold_events where booking_id = b1 and event = 'reversed';
  r := r || case when n = 1 then 'ok the hold history records the reversal; ' else 'FAIL events ' || n || '; ' end;
  select count(*) into n from public.notifications where booking_id = b1 and kind = 'dispute_resolved';
  r := r || case when n = 2 then 'ok both participants are told; ' else 'FAIL notices ' || n || '; ' end;
  begin
    update public.booking_settlement_reversals set member_tokens_refunded = 999 where booking_id = b1;
    r := r || 'FAIL reversal edited; ';
  exception when insufficient_privilege then r := r || 'ok reversals are append-only; ';
  end;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  select pending_tokens, settled_bookings into n, bal from public.my_creator_booking_earnings();
  select sum(e.tokens) into bal0 from public.creator_booking_earnings e where e.booking_id in (b2, b3);
  r := r || case when n = bal0 and bal = 2 then 'ok pending earnings net out the reversal; '
                 else 'FAIL pending ' || n || '/' || bal || ' expected ' || bal0 || '/2; ' end;
  select count(*) into n from public.booking_settlement_reversals;
  r := r || case when n = 1 then 'ok the companion can see the reversal of their booking; ' else 'FAIL companion sees ' || n || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  select count(*) into n from public.booking_settlement_reversals;
  r := r || case when n = 0 then 'ok outsiders see no reversals; ' else 'FAIL outsider sees ' || n || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  select count(*) filter (where not balanced), count(*) filter (where booking_id = b1 and balanced and creator = 0 and commission = 0)
    into n, bal from public.admin_booking_token_reconciliation() where booking_id in (b1, b2, b3);
  r := r || case when n = 0 and bal = 1 then 'ok reconciliation balances, the reversed booking nets to zero; '
                 else 'FAIL reconciliation ' || n || ' unbalanced, b1 ok ' || bal || '; ' end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  select count(*) into n from public.admin_booking_token_reconciliation() where not balanced;
  r := r || case when n = 0 then 'ok nothing else shows as unbalanced; ' else 'FAIL unbalanced rows ' || n || '; ' end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
