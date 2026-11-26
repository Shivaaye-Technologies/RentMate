-- System-wide booking expiry job (migration 20261126120000). Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  cm uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();
  sec text := 'Zt8Qw2Lr7Xp4Vv1Tn9Bs5Hd3Jf6Gm0Ca8Ue2Yi7Ro4Wl1Pq8Nt5Kb3Mc6Vx0Az2';
  r text := ''; n bigint; t text; bal bigint; bal0 bigint;
  base timestamptz; svc uuid; b1 uuid; b2 uuid; b3 uuid;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@expiry.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, modr, cm, mb]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, modr, cm, mb]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin'), (modr, 'moderator');
  update public.profiles set is_tester = true where id in (cm, mb);
  perform private.set_integration_secret('booking_jobs', sec);
  base := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 days 11 hours') at time zone 'Asia/Kolkata';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_profiles (user_id, headline, city, area) values (cm, 'Friendly city guide', 'Pune', 'Baner');
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_review_companion(cm, 'approved', true, 'Identity and age checked');
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, price_tokens, min_minutes, max_minutes)
    values (cm, 'coffee', 'Coffee and conversation', 'hourly', 900, 120, 60, 180) returning id into svc;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute)
    select cm, d, 0, 1440 from generate_series(0, 6) d;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_set_booking_token_sandbox(true);
  perform public.admin_grant_sandbox_tokens(mb, 1000, 'expiry-grant-1');

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select balance into bal0 from public.token_wallets where user_id = mb;
  b1 := public.booking_request_with_tokens(svc, base, 60, 'Cafe Good Luck, FC Road', '', 'exp-b1-00001');
  b2 := public.booking_request_with_tokens(svc, base + interval '3 hours', 60, 'Cafe Good Luck, FC Road', '', 'exp-b2-00001');
  b3 := public.booking_request(svc, base + interval '6 hours', 60, 'Cafe Good Luck, FC Road', '', 'exp-b3-00001');
  reset role;
  -- b1 and b3 are now in the past and nobody answered them; b2 stays in the future.
  update public.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id in (b1, b3);

  set local role anon;
  begin
    perform public.booking_jobs_expire('wrong-secret-wrong-secret-wrong-secret-0000', 100);
    r := r || 'FAIL ran without secret; ';
  exception when insufficient_privilege then r := r || 'ok the job needs its integration secret; ';
  end;
  n := public.booking_jobs_expire(sec, 100);
  r := r || case when n = 2 then 'ok both stale requests expired (token and plain); ' else 'FAIL expired ' || n || '; ' end;
  n := public.booking_jobs_expire(sec, 100);
  r := r || case when n = 0 then 'ok re-running is a no-op; ' else 'FAIL second run ' || n || '; ' end;
  reset role;

  select string_agg(b.status, ',' order by b.starts_at) into t from public.bookings b where b.id in (b1, b2, b3);
  r := r || case when t = 'expired,expired,requested' then 'ok future request untouched; ' else 'FAIL statuses ' || t || '; ' end;
  select status into t from public.booking_token_holds where booking_id = b1;
  r := r || case when t = 'released' then 'ok expired hold released; ' else 'FAIL hold ' || t || '; ' end;
  select count(*) into n from public.token_ledger where idempotency_key = 'booking_refund:' || b1;
  r := r || case when n = 1 then 'ok refunded exactly once; ' else 'FAIL refunds ' || n || '; ' end;
  select balance into bal from public.token_wallets where user_id = mb;
  r := r || case when bal = bal0 - 120 then 'ok only the open future hold remains; ' else 'FAIL balance ' || bal || ' vs ' || bal0 || '; ' end;
  select count(*) into n from private.booking_job_runs where affected = 2;
  r := r || case when n = 1 then 'ok the run is recorded; ' else 'FAIL runs ' || n || '; ' end;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  select count(*) into n from public.admin_booking_job_runs(10);
  r := r || case when n = 1 then 'ok moderators can see job runs; ' else 'FAIL runs view ' || n || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_booking_job_runs(10);
    r := r || 'FAIL member read job runs; ';
  exception when insufficient_privilege then r := r || 'ok members cannot read job runs; ';
  end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
