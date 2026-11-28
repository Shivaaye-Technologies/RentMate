-- Meetup check-in codes and the settlement job (migration 20261126140000). Always rolls back.
-- Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  cm uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();
  sec text := 'Qm4Xr8Lt2Vp7Wz1Kn5Bs9Hd3Jf6Gc0Ya8Ue2Ti7Ro4Wl1Pq8Nv5Kb3Mc6Vx0Az2';
  r text := ''; n bigint; t text; ok boolean; code text; code2 text; bal bigint; bal0 bigint;
  base timestamptz; svc uuid; b1 uuid; b2 uuid; b3 uuid; b4 uuid; res record;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@checkin.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, cm, mb]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, cm, mb]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');
  update public.profiles set is_tester = true where id in (cm, mb);
  perform private.set_integration_secret('booking_jobs', sec);
  base := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 days 9 hours') at time zone 'Asia/Kolkata';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_profiles (user_id, headline, city, area) values (cm, 'Friendly city guide', 'Pune', 'Baner');
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_review_companion(cm, 'approved', true, 'Identity and age checked');
  perform public.admin_set_booking_token_sandbox(true);
  perform public.admin_grant_sandbox_tokens(mb, 1000, 'checkin-grant-1');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, price_tokens, min_minutes, max_minutes)
    values (cm, 'coffee', 'Coffee and conversation', 'hourly', 900, 120, 60, 180) returning id into svc;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute)
    select cm, d, 0, 1440 from generate_series(0, 6) d;

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select balance into bal0 from public.token_wallets where user_id = mb;
  b1 := public.booking_request_with_tokens(svc, base, 60, 'Cafe Good Luck, FC Road', '', 'chk-b1-00001');
  b2 := public.booking_request_with_tokens(svc, base + interval '2 hours', 60, 'Cafe Good Luck, FC Road', '', 'chk-b2-00001');
  b3 := public.booking_request_with_tokens(svc, base + interval '4 hours', 60, 'Cafe Good Luck, FC Road', '', 'chk-b3-00001');
  b4 := public.booking_request_with_tokens(svc, base + interval '6 hours', 60, 'Cafe Good Luck, FC Road', '', 'chk-b4-00001');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(b1, 'accept', null);
  perform public.booking_respond(b2, 'accept', null);
  perform public.booking_respond(b3, 'accept', null);
  perform public.booking_respond(b4, 'accept', null);

  -- ===== Check-in =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_checkin_code(b1);
    r := r || 'FAIL code issued days before the meetup; ';
  exception when raise_exception then r := r || 'ok no code outside the meetup window; ';
  end;
  reset role;
  update public.bookings set starts_at = now() - interval '10 minutes', ends_at = now() + interval '50 minutes'
    where id = b1;
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_checkin_code(b1);
    r := r || 'FAIL companion issued a code; ';
  exception when insufficient_privilege then r := r || 'ok only the member can issue a code; ';
  end;
  begin
    ok := public.booking_check_in(b1, '123456');
    r := r || 'FAIL check-in without any code; ';
  exception when raise_exception then r := r || 'ok check-in needs an issued code; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  code := public.booking_checkin_code(b1);
  r := r || case when code ~ '^[0-9]{6}$' then 'ok six-digit code; ' else 'FAIL code ' || coalesce(code, 'null') || '; ' end;
  begin
    ok := public.booking_check_in(b1, code);
    r := r || 'FAIL member checked themselves in; ';
  exception when insufficient_privilege then r := r || 'ok the member cannot check in; ';
  end;
  reset role;
  select count(*) into n from private.booking_checkin_codes where booking_id = b1 and code_hash <> code and code_hash ~ '^[0-9a-f]{64}$';
  r := r || case when n = 1 then 'ok only a hash is stored; ' else 'FAIL stored code ' || n || '; ' end;
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  ok := public.booking_check_in(b1, case when code = '000000' then '000001' else '000000' end);
  r := r || case when not ok then 'ok a wrong code is refused; ' else 'FAIL wrong code accepted; ' end;
  reset role;
  select attempts into n from private.booking_checkin_codes where booking_id = b1;
  r := r || case when n = 1 then 'ok the wrong try is counted; ' else 'FAIL attempts ' || n || '; ' end;
  update private.booking_checkin_codes set attempts = 5 where booking_id = b1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  begin
    ok := public.booking_check_in(b1, code);
    r := r || 'FAIL accepted after five wrong tries; ';
  exception when raise_exception then r := r || 'ok locked after five wrong tries; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  code2 := public.booking_checkin_code(b1);
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  if code2 <> code then
    ok := public.booking_check_in(b1, code);
    r := r || case when not ok then 'ok a replaced code stops working; ' else 'FAIL old code still works; ' end;
  else
    r := r || 'ok a replaced code stops working (same digits drawn); ';
  end if;
  ok := public.booking_check_in(b1, code2);
  r := r || case when ok then 'ok the right code checks in; ' else 'FAIL right code refused; ' end;
  ok := public.booking_check_in(b1, '999999');
  r := r || case when ok then 'ok checking in again is a no-op; ' else 'FAIL repeat check-in; ' end;
  reset role;
  select count(*) into n from public.bookings where id = b1 and checked_in_at is not null;
  r := r || case when n = 1 then 'ok booking marked checked in; ' else 'FAIL not checked in; ' end;
  select count(*) into n from private.booking_checkin_codes where booking_id = b1 and code_hash is null and used_at is not null;
  r := r || case when n = 1 then 'ok the code is spent; ' else 'FAIL code not spent; ' end;
  select count(*) into n from public.notifications where user_id = mb and booking_id = b1 and kind = 'booking_checked_in';
  r := r || case when n = 1 then 'ok the member is notified; ' else 'FAIL check-in notices ' || n || '; ' end;

  -- ===== Settlement =====
  -- b1 checked in; b2 member confirmed; b3 only the companion confirmed; b4 ended an hour ago (inside the window).
  update public.bookings set starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '1 hour'
    where id = b1;
  update public.bookings set starts_at = now() - interval '4 days', ends_at = now() - interval '4 days' + interval '1 hour'
    where id = b2;
  update public.bookings set starts_at = now() - interval '5 days', ends_at = now() - interval '5 days' + interval '1 hour'
    where id = b3;
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = b4;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  perform public.booking_complete(b2);
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_complete(b3);

  set local role anon;
  begin
    perform public.booking_jobs_settle('wrong-secret-wrong-secret-wrong-secret-0000', 100);
    r := r || 'FAIL settled without secret; ';
  exception when insufficient_privilege then r := r || 'ok the job needs its integration secret; ';
  end;
  select * into res from public.booking_jobs_settle(sec, 100);
  r := r || case when res.completed = 2 and res.held_for_review = 1 then 'ok two completed, one held for review; '
                 else 'FAIL settle ' || res.completed || '/' || res.held_for_review || '; ' end;
  select * into res from public.booking_jobs_settle(sec, 100);
  r := r || case when res.completed = 0 and res.held_for_review = 0 then 'ok re-running is a no-op; '
                 else 'FAIL second run ' || res.completed || '/' || res.held_for_review || '; ' end;
  reset role;

  select string_agg(b.status || ':' || h.status, ',' order by b.reference = '', array_position(array[b1, b2, b3, b4], b.id))
    into t from public.bookings b join public.booking_token_holds h on h.booking_id = b.id where b.id in (b1, b2, b3, b4);
  r := r || case when t = 'completed:settled,completed:settled,accepted:frozen,accepted:held'
                 then 'ok statuses and holds as expected; ' else 'FAIL ' || t || '; ' end;
  select count(*) into n from public.creator_booking_earnings where booking_id in (b1, b2);
  r := r || case when n = 2 then 'ok companion credited once per settled booking; ' else 'FAIL earnings ' || n || '; ' end;
  select count(*) into n from public.creator_booking_earnings where booking_id in (b3, b4);
  r := r || case when n = 0 then 'ok nothing credited without evidence; ' else 'FAIL unexpected earnings ' || n || '; ' end;
  select count(*) into n from public.platform_commission_entries where booking_id in (b1, b2);
  r := r || case when n = 2 then 'ok commission recorded; ' else 'FAIL commission ' || n || '; ' end;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = bal0 - 480 then 'ok no refunds or double charges; ' else 'FAIL balance ' || bal || ' vs ' || bal0 || '; ' end;
  select count(*) into n from public.notifications where booking_id = b3 and kind = 'booking_under_review';
  r := r || case when n = 2 then 'ok both told the booking is under review; ' else 'FAIL review notices ' || n || '; ' end;
  select count(*) into n from private.booking_job_runs where job in ('settle', 'review');
  r := r || case when n = 2 then 'ok runs recorded; ' else 'FAIL runs ' || n || '; ' end;

  -- The moderator's existing decision path still works on a held-for-review booking.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_resolve_booking_tokens(b3, 'refund', 'Member did not attend; refund');
  reset role;
  select b.status || ':' || h.status into t from public.bookings b join public.booking_token_holds h on h.booking_id = b.id
    where b.id = b3;
  r := r || case when t = 'cancelled:released' then 'ok a moderator can refund it; ' else 'FAIL resolve ' || t || '; ' end;

  -- ===== Dispute window setting =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_set_booking_dispute_window(2);
    r := r || 'FAIL member changed the window; ';
  exception when insufficient_privilege then r := r || 'ok members cannot change the window; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_set_booking_dispute_window(0);
    r := r || 'FAIL zero-hour window; ';
  exception when invalid_parameter_value then r := r || 'ok the window has bounds; ';
  end;
  perform public.admin_set_booking_dispute_window(1);
  reset role;
  set local role anon;
  select * into res from public.booking_jobs_settle(sec, 100);
  reset role;
  select h.status into t from public.booking_token_holds h where h.booking_id = b4;
  r := r || case when res.held_for_review = 1 and t = 'frozen'
                 then 'ok a shorter window applies on the next run; ' else 'FAIL window ' || coalesce(t, 'null') || '; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
