-- Regression tests for supabase/migrations/20261120090000_audit_hardening.sql (deep audit findings SEC-01, SEC-02,
-- SEC-03, BKG-01). Always rolls back. Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid();    -- member
  b uuid := gen_random_uuid();    -- member matched with a
  s uuid := gen_random_uuid();    -- member who gets suspended
  adm uuid := gen_random_uuid();  -- admin
  cm uuid := gen_random_uuid();   -- companion
  r text := ''; n int; t timestamptz; arr text[]; m uuid; svc uuid; bk uuid; bk2 uuid; i int; base timestamptz;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@audit.test', 'authenticated', 'authenticated' from unnest(array[a, b, s, adm, cm]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[a, b, s, adm, cm]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');
  -- Superusers keep the timestamps they set (seeds and migrations rely on this).
  insert into public.likes (liker_id, liked_id, created_at) values (b, s, '2001-01-01');
  select created_at into t from public.likes where liker_id = b and liked_id = s;
  r := r || case when t = '2001-01-01' then 'ok seeds keep their own timestamps; ' else 'FAIL seed stamp ' || t || '; ' end;
  insert into public.likes (liker_id, liked_id) values (a, b), (b, a), (s, a), (a, s);
  select id into m from public.matches where (user_a, user_b) in ((a, b), (b, a));

  -- ===== SEC-01: server-owned timestamps =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.messages (match_id, sender_id, body, created_at) values (m, a, 'from the past', '1999-01-01');
  select created_at into t from public.messages where sender_id = a and body = 'from the past';
  r := r || case when t = now() then 'ok back-dated message gets the server time; ' else 'FAIL message time ' || t || '; ' end;
  insert into public.messages (match_id, sender_id, body, created_at) values (m, a, 'from the future', '2099-01-01');
  select created_at into t from public.messages where sender_id = a and body = 'from the future';
  r := r || case when t = now() then 'ok future-dated message gets the server time; ' else 'FAIL future ' || t || '; ' end;
  -- 20 messages a minute: back-dating no longer escapes the count.
  begin
    for i in 1..25 loop
      insert into public.messages (match_id, sender_id, body, created_at) values (m, a, 'spam ' || i, '1999-01-01');
    end loop;
    r := r || 'FAIL message limit bypassed with back-dated rows; ';
  exception when raise_exception then r := r || 'ok back-dated messages still hit the per-minute limit; ';
  end;
  insert into public.passes (passer_id, passed_id, created_at) values (a, cm, '1999-01-01');
  select created_at into t from public.passes where passer_id = a and passed_id = cm;
  r := r || case when t = now() then 'ok passes get the server time; ' else 'FAIL pass time; ' end;
  -- A forged report time is either refused (created_at is not granted to members) or overwritten by the server.
  begin
    insert into public.reports (reporter_id, reported_id, reason, created_at) values (a, cm, 'other', '1999-01-01');
    select created_at into t from public.reports where reporter_id = a and reported_id = cm;
    r := r || case when t = now() then 'ok a forged report time is overwritten; ' else 'FAIL report time; ' end;
  exception when insufficient_privilege then
    r := r || 'ok a forged report time is refused; ';
  end;
  if not exists (select 1 from public.reports where reporter_id = a and reported_id = cm) then
    insert into public.reports (reporter_id, reported_id, reason) values (a, cm, 'other');
  end if;
  select created_at into t from public.reports where reporter_id = a and reported_id = cm;
  r := r || case when t = now() then 'ok reports get the server time; ' else 'FAIL report time; ' end;
  insert into public.blocks (blocker_id, blocked_id, created_at) values (a, cm, '1999-01-01');
  select created_at into t from public.blocks where blocker_id = a and blocked_id = cm;
  r := r || case when t = now() then 'ok blocks get the server time; ' else 'FAIL block time; ' end;
  -- Rewriting a block's time is either refused (members have no UPDATE on blocks) or has no effect.
  begin
    update public.blocks set created_at = '1999-01-01' where blocker_id = a and blocked_id = cm;
  exception when insufficient_privilege then null;
  end;
  select created_at into t from public.blocks where blocker_id = a and blocked_id = cm;
  r := r || case when t = now() then 'ok block timestamps cannot be rewritten; ' else 'FAIL block rewrite; ' end;
  delete from public.blocks where blocker_id = a and blocked_id = cm;
  reset role;

  -- ===== SEC-02: suspension reaches dating, creator and live features =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_suspend_account(s, 'Audit regression test');
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  select id into m from public.matches where (user_a, user_b) in ((a, s), (s, a));
  begin
    insert into public.messages (match_id, sender_id, body) values (m, s, 'still here');
    r := r || 'FAIL suspended account sent a dating message; ';
  exception when insufficient_privilege then r := r || 'ok suspended accounts cannot send dating messages; ';
  end;
  begin
    insert into public.likes (liker_id, liked_id) values (s, b);
    r := r || 'FAIL suspended account liked someone; ';
  exception when insufficient_privilege then r := r || 'ok suspended accounts cannot like; ';
  end;
  begin
    insert into public.creators (user_id, stage_name, country_code, categories) values (s, 'Stage Name', 'IN', '{}');
    r := r || 'FAIL suspended account applied as a creator; ';
  exception when insufficient_privilege then r := r || 'ok suspended accounts cannot apply as creators; ';
  end;
  begin
    insert into public.reports (reporter_id, reported_id, reason) values (s, b, 'other');
    r := r || 'ok suspended accounts can still report; ';
  exception when others then r := r || 'FAIL report blocked: ' || sqlerrm || '; ';
  end;
  begin
    insert into public.blocks (blocker_id, blocked_id) values (s, b);
    r := r || 'ok suspended accounts can still block; ';
  exception when others then r := r || 'FAIL block blocked: ' || sqlerrm || '; ';
  end;
  begin
    perform public.appeal_suspension('I would like this reviewed please.');
    r := r || 'ok suspended accounts can still appeal; ';
  exception when others then r := r || 'FAIL appeal: ' || sqlerrm || '; ';
  end;
  reset role;
  arr := private.watch_problems(gen_random_uuid(), s, 'IN');
  r := r || case when 'account_suspended' = any (arr) then 'ok live watch checks refuse suspended viewers; '
                 else 'FAIL watch ' || arr::text || '; ' end;
  arr := private.broadcast_problems(gen_random_uuid(), s);
  r := r || case when 'account_suspended' = any (arr) then 'ok live broadcast checks refuse suspended creators; '
                 else 'FAIL broadcast ' || arr::text || '; ' end;
  arr := private.watch_problems(gen_random_uuid(), a, 'IN');
  r := r || case when not 'account_suspended' = any (arr) then 'ok other members are unaffected; '
                 else 'FAIL other member flagged; ' end;
  r := r || case when to_regprocedure('private.live_session_check_core(uuid,text)') is not null
                  and not has_function_privilege('authenticated', 'private.live_session_check_core(uuid,text)', 'execute')
                 then 'ok the unwrapped session check is not callable; ' else 'FAIL core callable; ' end;
  -- Lifting the suspension restores access.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_lift_suspension(s, 'Appeal upheld');
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin
    insert into public.messages (match_id, sender_id, body) values (m, s, 'back again');
    r := r || 'ok lifting a suspension restores messaging; ';
  exception when others then r := r || 'FAIL after lift: ' || sqlerrm || '; ';
  end;
  reset role;

  -- ===== SEC-03: least privilege =====
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
    and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER');
  r := r || case when n = 0 then 'ok API roles cannot truncate or add triggers; ' else 'FAIL ' || n || ' grants left; ' end;
  select count(*) into n from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  r := r || case when n = 0 then 'ok anonymous visitors have no write rights; ' else 'FAIL anon writes ' || n || '; ' end;

  -- ===== BKG-01: stale requests do not lock members out =====
  insert into public.companion_profiles (user_id, headline, city, status, verified) values (cm, 'City walks guide', 'Pune', 'approved', true);
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, min_minutes, max_minutes)
    values (cm, 'coffee', 'Coffee chat', 'hourly', 500, 60, 120) returning id into svc;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute, timezone)
    select cm, d, 0, 1440, 'Asia/Kolkata' from generate_series(0, 6) d;
  base := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 days 10 hours') at time zone 'Asia/Kolkata';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  for i in 1..10 loop
    perform public.booking_request(svc, base + make_interval(days => i), 60, 'Cafe on FC Road', '', 'audit-stale-' || i);
  end loop;
  begin
    perform public.booking_request(svc, base + interval '15 days', 60, 'Cafe on FC Road', '', 'audit-eleventh');
    r := r || 'FAIL 11th open future request accepted; ';
  exception when raise_exception then r := r || 'ok 10 open future requests is still the limit; ';
  end;
  reset role;
  -- Time passes: every open request is now in the past (simulated).
  update public.bookings set starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '1 hour'
  where member_id = b and status in ('requested', 'pending');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    bk := public.booking_request(svc, base + interval '16 days', 60, 'Cafe on FC Road', '', 'audit-after-expiry');
    r := r || 'ok expired requests no longer block new bookings; ';
  exception when others then r := r || 'FAIL still locked out: ' || sqlerrm || '; ';
  end;
  select id into bk2 from public.bookings where member_id = b and status = 'requested' and starts_at < now() limit 1;
  begin
    perform public.booking_cancel(bk2, 'No reply');
    r := r || 'ok a past unanswered request can be withdrawn; ';
  exception when others then r := r || 'FAIL withdraw: ' || sqlerrm || '; ';
  end;
  begin
    bk2 := public.booking_request(svc, base + interval '16 days', 60, 'Cafe on FC Road', '', 'audit-after-expiry');
    r := r || case when bk2 = bk then 'ok a repeated key returns the same booking; ' else 'FAIL idempotency; ' end;
  exception when others then r := r || 'FAIL repeat: ' || sqlerrm || '; ';
  end;
  reset role;
  if bk is null then raise exception 'ROLLED BACK. RESULTS: %', r; end if;
  -- Accepted bookings in the past still cannot be cancelled (completion or dispute instead).
  update public.bookings set status = 'accepted' where id = bk;
  update public.bookings set starts_at = now() - interval '1 hour', ends_at = now() where id = bk;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_cancel(bk, 'Too late');
    r := r || 'FAIL started accepted booking cancelled; ';
  exception when raise_exception then r := r || 'ok started accepted bookings cannot be cancelled; ';
  end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
