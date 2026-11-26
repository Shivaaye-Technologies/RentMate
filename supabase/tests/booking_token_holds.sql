-- Token-funded bookings (sandbox): gates, server quotes, atomic holds, idempotency, insufficient balance, release on
-- reject/cancel/expiry, two-party completion, creator/commission split from the snapshot, dispute and report
-- freezes, moderator decisions, append-only records, RLS, booking chat isolation and reconciliation.
-- Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  cm uuid := gen_random_uuid();    -- companion (tester)
  mb uuid := gen_random_uuid();    -- member (tester)
  plain uuid := gen_random_uuid(); -- member, not a tester
  out_ uuid := gen_random_uuid();  -- unrelated member (tester)
  r text := ''; n bigint; t text; bal bigint; bal0 bigint;
  base timestamptz; svc uuid; svc_dear uuid;
  b1 uuid; b2 uuid; b3 uuid; b4 uuid; b5 uuid; b6 uuid; b7 uuid; x uuid;
  q record;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@tokens.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, modr, cm, mb, plain, out_]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, modr, cm, mb, plain, out_]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin'), (modr, 'moderator');
  update public.profiles set is_tester = true where id in (cm, mb, out_);
  base := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 days 11 hours') at time zone 'Asia/Kolkata';

  -- ===== Owner-level locks =====
  begin
    update public.booking_token_settings set live_spend_enabled = true;
    r := r || 'FAIL live spend switched on; ';
  exception when check_violation then r := r || 'ok live booking spend is locked off; ';
  end;

  set local role authenticated;

  -- ===== Companion with a token-priced service =====
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_profiles (user_id, headline, city, area) values (cm, 'Friendly city guide', 'Pune', 'Baner');
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_review_companion(cm, 'approved', true, 'Identity and age checked');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, price_tokens, min_minutes, max_minutes)
    values (cm, 'coffee', 'Coffee and conversation', 'hourly', 900, 120, 60, 180) returning id into svc;
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, price_tokens)
    values (cm, 'sightseeing', 'Museum walk', 'session', 2000, 5000) returning id into svc_dear;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute)
    select cm, d, 0, 1440 from generate_series(0, 6) d;

  -- ===== Gates =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_request_with_tokens(svc, base, 90, 'Cafe Good Luck, FC Road', '', 'gate-off-0001');
    r := r || 'FAIL booked while sandbox off; ';
  exception when raise_exception then r := r || 'ok token booking refused while the sandbox is off; ';
  end;
  select count(*) into n from public.bookings where member_id = mb;
  r := r || case when n = 0 then 'ok nothing kept from the refused request; ' else 'FAIL booking kept; ' end;
  begin
    perform public.admin_set_booking_token_sandbox(true);
    r := r || 'FAIL member switched sandbox; ';
  exception when insufficient_privilege then r := r || 'ok only admins switch the sandbox; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_set_booking_token_sandbox(true);
  begin
    perform public.admin_grant_sandbox_tokens(plain, 100, 'grant-plain-1');
    r := r || 'FAIL granted to non-tester; ';
  exception when raise_exception then r := r || 'ok sandbox tokens only for testers; ';
  end;
  perform public.admin_grant_sandbox_tokens(mb, 1000, 'grant-mb-1');
  perform public.admin_grant_sandbox_tokens(mb, 1000, 'grant-mb-1'); -- replay
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select balance into bal0 from public.token_wallets where user_id = mb;
  r := r || case when bal0 = 1100 then 'ok sandbox grant credited once (bonus 100 + 1000); ' else 'FAIL balance ' || bal0 || '; ' end;
  select count(*) into n from public.token_ledger where user_id = mb and reason = 'sandbox_grant';
  r := r || case when n = 1 then 'ok sandbox credit labelled sandbox_grant; ' else 'FAIL grants ' || n || '; ' end;
  begin
    perform private.ledger_post(mb, 999, 'admin_adjustment', null, null, 'self-credit-0001');
    r := r || 'FAIL member posted to ledger; ';
  exception when insufficient_privilege then r := r || 'ok members cannot post to the ledger; ';
  end;

  -- ===== Quote =====
  select * into q from public.booking_token_quote(svc, 90);
  r := r || case when q.gross_tokens = 180 and q.enough_tokens and q.token_booking_available
              then 'ok server quote 120/h x 90 min = 180 tokens; ' else 'FAIL quote ' || q.gross_tokens || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', plain, 'role', 'authenticated')::text, true);
  select * into q from public.booking_token_quote(svc, 90);
  r := r || case when not q.token_booking_available then 'ok quote says unavailable to non-testers; ' else 'FAIL non-tester available; ' end;
  begin
    perform public.booking_request_with_tokens(svc, base, 90, 'Cafe Good Luck, FC Road', '', 'plain-req-0001');
    r := r || 'FAIL non-tester booked; ';
  exception when raise_exception then r := r || 'ok non-testers cannot spend tokens on bookings; ';
  end;

  -- ===== Hold =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  b1 := public.booking_request_with_tokens(svc, base, 90, 'Cafe Good Luck, FC Road', 'Hello', 'req-b1-00001');
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = bal0 - 180 then 'ok hold debits exactly the quote; ' else 'FAIL balance after hold ' || bal || '; ' end;
  select status, tokens into t, n from public.booking_token_holds where booking_id = b1;
  r := r || case when t = 'held' and n = 180 then 'ok hold recorded; ' else 'FAIL hold ' || coalesce(t, 'none') || '; ' end;
  select * into q from public.booking_token_quotes where booking_id = b1;
  r := r || case when q.commission_pct = 15 and q.commission_tokens = 27 and q.creator_tokens = 153 and q.minutes = 90
              then 'ok quote snapshot: 15% = 27 commission, 153 creator; ' else 'FAIL snapshot; ' end;
  x := public.booking_request_with_tokens(svc, base, 90, 'Cafe Good Luck, FC Road', 'Hello', 'req-b1-00001');
  select balance into n from public.token_wallets where user_id = mb;
  r := r || case when x = b1 and n = bal then 'ok replayed request returns the same booking, no second hold; '
              else 'FAIL replay; ' end;
  select count(*) into n from public.token_ledger where user_id = mb and reason = 'booking_hold';
  r := r || case when n = 1 then 'ok one hold ledger entry; ' else 'FAIL hold entries ' || n || '; ' end;

  -- Insufficient balance: nothing is created.
  select count(*) into n from public.bookings where member_id = mb;
  begin
    perform public.booking_request_with_tokens(svc_dear, base + interval '3 hours', 60, 'City Museum', '', 'req-dear-0001');
    r := r || 'FAIL overspent; ';
  exception when raise_exception then r := r || 'ok insufficient balance refused; ';
  end;
  select count(*) into t from public.bookings where member_id = mb;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when t::bigint = n and bal = bal0 - 180 then 'ok refused request left no booking and no debit; '
              else 'FAIL partial state; ' end;

  -- ===== Reject releases =====
  b2 := public.booking_request_with_tokens(svc, base + interval '3 hours', 60, 'Cafe Good Luck, FC Road', '', 'req-b2-00001');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(b2, 'reject', 'Not available');
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select status into t from public.booking_token_holds where booking_id = b2;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when t = 'released' and bal = bal0 - 180 then 'ok rejection refunds the hold; ' else 'FAIL reject ' || t || '; ' end;
  select count(*) into n from public.token_ledger where idempotency_key = 'booking_refund:' || b2 and delta = 120;
  r := r || case when n = 1 then 'ok refund is a compensating ledger entry; ' else 'FAIL refund entry; ' end;

  -- ===== Member cancel releases =====
  b3 := public.booking_request_with_tokens(svc, base + interval '6 hours', 60, 'Cafe Good Luck, FC Road', '', 'req-b3-00001');
  perform public.booking_cancel(b3, 'Plans changed');
  select status into t from public.booking_token_holds where booking_id = b3;
  r := r || case when t = 'released' then 'ok cancellation refunds the hold; ' else 'FAIL cancel ' || t || '; ' end;

  -- ===== Expiry releases =====
  b4 := public.booking_request_with_tokens(svc, base + interval '9 hours', 60, 'Cafe Good Luck, FC Road', '', 'req-b4-00001');
  reset role;
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = b4;
  set local role authenticated;
  perform public.booking_expire_stale();
  select h.status || '/' || b.status into t from public.booking_token_holds h join public.bookings b on b.id = h.booking_id
  where h.booking_id = b4;
  r := r || case when t = 'released/expired' then 'ok stale request expires and refunds the hold; ' else 'FAIL expiry ' || t || '; ' end;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = bal0 - 180 then 'ok balance back to only the open hold; ' else 'FAIL balance ' || bal || '; ' end;

  -- ===== Two-party completion settles from the snapshot =====
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(b1, 'accept', null);
  reset role;
  update public.bookings set starts_at = now() - interval '3 hours', ends_at = now() - interval '90 minutes' where id = b1;
  update public.platform_settings set commission_pct = 30; -- later price change must not touch the snapshot
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  perform public.booking_complete(b1);
  select status into t from public.bookings where id = b1;
  r := r || case when t = 'accepted' then 'ok one confirmation does not complete a token booking; ' else 'FAIL completed by one: ' || t || '; ' end;
  select count(*) into n from public.creator_booking_earnings where booking_id = b1;
  r := r || case when n = 0 then 'ok no earnings before both confirm; ' else 'FAIL early earnings; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_complete(b1);
  select status into t from public.bookings where id = b1;
  select tokens into n from public.creator_booking_earnings where booking_id = b1;
  r := r || case when t = 'completed' and n = 153 then 'ok both confirmations complete, creator pending 153 from snapshot; '
              else 'FAIL completion ' || t || ' ' || coalesce(n::text, 'none') || '; ' end;
  select pending_tokens into n from public.my_creator_booking_earnings();
  r := r || case when n = 153 then 'ok creator sees own pending earnings; ' else 'FAIL creator summary; ' end;
  select status into t from public.booking_token_holds where booking_id = b1;
  r := r || case when t = 'settled' then 'ok hold settled; ' else 'FAIL hold ' || t || '; ' end;
  begin
    select count(*) into n from public.platform_commission_entries;
    r := r || 'FAIL commission readable by members; ';
  exception when insufficient_privilege then r := r || 'ok platform commission ledger is not readable by members; ';
  end;
  reset role;
  select commission_tokens into n from public.platform_commission_entries where booking_id = b1;
  r := r || case when n = 27 then 'ok platform commission 27 recorded separately; ' else 'FAIL commission ' || coalesce(n::text, 'none') || '; ' end;
  select count(*) into n from public.token_ledger where user_id = cm and reason <> 'registration_bonus';
  r := r || case when n = 0 then 'ok creator wallet untouched (earnings are a separate ledger); ' else 'FAIL creator wallet credited; ' end;
  begin
    update public.creator_booking_earnings set tokens = 999 where booking_id = b1;
    r := r || 'FAIL earnings edited; ';
  exception when insufficient_privilege then r := r || 'ok earnings are append-only; ';
  end;
  begin
    delete from public.platform_commission_entries where booking_id = b1;
    r := r || 'FAIL commission deleted; ';
  exception when insufficient_privilege then r := r || 'ok commission entries are append-only; ';
  end;
  begin
    update public.booking_token_quotes set gross_tokens = 1 where booking_id = b1;
    r := r || 'FAIL quote edited; ';
  exception when insufficient_privilege then r := r || 'ok quote snapshots are immutable; ';
  end;
  begin
    delete from public.booking_token_holds where booking_id = b1;
    r := r || 'FAIL hold deleted; ';
  exception when insufficient_privilege then r := r || 'ok holds cannot be deleted; ';
  end;
  update public.platform_settings set commission_pct = 15;
  set local role authenticated;

  -- ===== Dispute freezes; moderator decides =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  b5 := public.booking_request_with_tokens(svc, base + interval '1 day', 60, 'Cafe Good Luck, FC Road', '', 'req-b5-00001');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(b5, 'accept', null);
  reset role;
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = b5;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  perform public.booking_dispute(b5, 'The companion did not arrive at the venue.');
  select status into t from public.booking_token_holds where booking_id = b5;
  r := r || case when t = 'frozen' then 'ok dispute freezes the tokens; ' else 'FAIL dispute ' || t || '; ' end;
  begin
    perform public.admin_resolve_booking_tokens(b5, 'refund', 'Member asked');
    r := r || 'FAIL member resolved own dispute; ';
  exception when insufficient_privilege then r := r || 'ok only moderators decide frozen tokens; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_resolve_dispute(b5, 'cancelled', 'No-show confirmed');
  reset role; select status into t from public.booking_token_holds where booking_id = b5; set local role authenticated;
  r := r || case when t = 'released' then 'ok dispute cancelled by moderator refunds the member; ' else 'FAIL resolve ' || t || '; ' end;

  -- ===== Report freezes (participants only) =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  b6 := public.booking_request_with_tokens(svc, base + interval '1 day 3 hours', 60, 'Cafe Good Luck, FC Road', '', 'req-b6-00001');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(b6, 'accept', null);
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  insert into public.reports (reporter_id, reported_id, reason, booking_id) values (out_, cm, 'harassment', b6);
  reset role; select status into t from public.booking_token_holds where booking_id = b6; set local role authenticated;
  r := r || case when t = 'held' then 'ok outsiders cannot freeze a booking by reporting it; ' else 'FAIL outsider froze ' || t || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  insert into public.reports (reporter_id, reported_id, reason, booking_id) values (mb, cm, 'unsafe_behaviour', b6);
  select status into t from public.booking_token_holds where booking_id = b6;
  r := r || case when t = 'frozen' then 'ok participant safety report freezes the tokens; ' else 'FAIL report ' || t || '; ' end;
  reset role;
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = b6;
  set local role authenticated;
  begin
    perform public.booking_complete(b6);
    r := r || 'FAIL completed under review; ';
  exception when raise_exception then r := r || 'ok frozen booking cannot be completed; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_resolve_booking_tokens(b6, 'settle', '');
    r := r || 'FAIL decision without reason; ';
  exception when invalid_parameter_value then r := r || 'ok moderator decisions need a reason; ';
  end;
  perform public.admin_resolve_booking_tokens(b6, 'settle', 'Reviewed: report unfounded, meeting happened');
  select status into t from public.booking_token_holds where booking_id = b6;
  reset role; select status into t from public.booking_token_holds where booking_id = b6; set local role authenticated;
  r := r || case when t = 'settled' then 'ok moderator can settle after review; ' else 'FAIL settle ' || t || '; ' end;
  reset role; select status into t from public.bookings where id = b6; set local role authenticated;
  r := r || case when t = 'completed' then 'ok booking completes with the moderator decision; ' else 'FAIL booking ' || coalesce(t, 'none') || '; ' end;
  select count(*) into n from public.admin_booking_token_reconciliation() where not balanced;
  r := r || case when n = 0 then 'ok every hold reconciles; ' else 'FAIL unbalanced ' || n || '; ' end;

  -- ===== RLS: holds, quotes, chat =====
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  select count(*) into n from public.booking_token_holds where booking_id in (b1, b2, b3);
  r := r || case when n = 0 then 'ok outsiders see no holds; ' else 'FAIL holds visible; ' end;
  select count(*) into n from public.booking_token_quotes where booking_id = b1;
  r := r || case when n = 0 then 'ok outsiders see no quotes; ' else 'FAIL quotes visible; ' end;
  select count(*) into n from public.booking_messages where booking_id = b1;
  r := r || case when n = 0 then 'ok outsiders cannot read booking chat; ' else 'FAIL chat visible; ' end;
  begin
    insert into public.booking_messages (booking_id, body) values (b6, 'Hi from outside');
    r := r || 'FAIL outsider posted; ';
  exception when insufficient_privilege then r := r || 'ok outsiders cannot post in booking chat; ';
  end;
  select count(*) into n from public.creator_booking_earnings;
  r := r || case when n = 0 then 'ok others cannot read creator earnings; ' else 'FAIL earnings visible; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  b7 := public.booking_request_with_tokens(svc, base + interval '2 days', 60, 'Cafe Good Luck, FC Road', '', 'req-b7-00001');
  insert into public.booking_messages (booking_id, body) values (b7, 'See you at the cafe entrance.');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.booking_messages (booking_id, body) values (b7, 'Great, see you there.');
  select count(*) filter (where kind = 'text'), count(*) filter (where kind = 'system') into n, bal
  from public.booking_messages where booking_id = b7;
  r := r || case when n = 2 and bal >= 1 then 'ok participants chat, system events recorded; ' else 'FAIL chat ' || n || '/' || bal || '; ' end;
  select count(*) into n from public.booking_messages where booking_id = b7 and sender_id = mb;
  r := r || case when n = 1 then 'ok sender is set by the server; ' else 'FAIL sender; ' end;
  begin
    insert into public.booking_messages (booking_id, body, kind) values (b7, 'fake system', 'system');
    r := r || 'FAIL spoofed system message; ';
  exception when insufficient_privilege then r := r || 'ok members cannot write system events; ';
  end;
  begin
    insert into public.booking_messages (booking_id, body) values (b7, 'escort services available'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL prohibited text; ';
  exception when check_violation then r := r || 'ok prohibited wording refused in booking chat; ';
  end;
  select count(*) into n from public.booking_messages where booking_id = b1;
  r := r || case when n >= 1 then 'ok companion reads its own earlier booking chat; ' else 'FAIL own chat hidden; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  insert into public.blocks (blocker_id, blocked_id) values (mb, cm);
  select status into t from public.booking_token_holds where booking_id = b7;
  r := r || case when t = 'released' then 'ok blocking cancels the request and refunds the hold; ' else 'FAIL block ' || t || '; ' end;
  begin
    insert into public.booking_messages (booking_id, body) values (b7, 'Still there?');
    r := r || 'FAIL posted after block; ';
  exception when insufficient_privilege then r := r || 'ok blocked pair cannot use booking chat; ';
  end;

  select balance into bal from public.token_wallets where user_id = mb;
  -- 1100 start - 180 (b1 settled) - 120 (b6 settled after review); b2, b3, b4, b5, b7 refunded.
  r := r || case when bal = bal0 - 300 then 'ok final member balance is exact; ' else 'FAIL final balance ' || bal || '; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
exception when others then
  if sqlerrm like 'ROLLED BACK.%' then raise; end if;
  raise exception 'ROLLED BACK. RESULTS: %FAIL unexpected error: %', r, sqlerrm;
end $$;
