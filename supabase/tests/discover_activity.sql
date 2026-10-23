-- Discover activity test: the counts behind the honest empty states, and
-- "Review passed profiles", only ever see or change the caller's own rows.
-- Always rolls back. Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  r text := ''; n int;
begin
  insert into auth.users (id, email, aud, role, instance_id) values
    (a, 'a@activity.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (b, 'b@activity.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (c, 'c@activity.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, display_name, age, interests, looking_for, age_min, age_max) values
    (a, 'Aa', 28, '{Hiking}', 'relationship', 18, 45),
    (b, 'Bb', 29, '{Travel}', 'casual', 18, 45),
    (c, 'Cc', 30, '{Books}', 'friendship', 18, 45);

  set local role authenticated;
  -- B passes A and C; B likes C.
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  insert into public.passes (passer_id, passed_id) values (b, a), (b, c);
  insert into public.likes (liker_id, liked_id) values (b, c);
  -- A passes B, likes C.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.passes (passer_id, passed_id) values (a, b);
  insert into public.likes (liker_id, liked_id) values (a, c);

  -- What A can count.
  select count(*) into n from public.passes;
  r := r || case when n = 1 then 'ok A sees only own passes; ' else 'FAIL A sees ' || n || ' passes; ' end;
  select count(*) into n from public.passes where passer_id = b;
  r := r || case when n = 0 then 'ok A cannot see B passing A; ' else 'FAIL pass leak; ' end;
  select count(*) into n from public.likes where liker_id = b;
  r := r || case when n = 0 then 'ok A cannot see likes B sent to others; ' else 'FAIL like leak; ' end;
  select count(*) into n from public.likes l where l.liker_id = a
    and not exists (select 1 from public.likes x where x.liker_id = l.liked_id and x.liked_id = a);
  r := r || case when n = 1 then 'ok one like awaiting reply; ' else 'FAIL awaiting ' || n || '; ' end;

  -- "Review passed profiles" as A, even without a filter, removes only A's pass.
  delete from public.passes; get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok unfiltered delete removed only own pass; ' else 'FAIL deleted ' || n || '; ' end;
  delete from public.passes where passer_id = b; get diagnostics n = row_count;
  r := r || case when n = 0 then 'ok cannot delete another member''s passes; ' else 'FAIL deleted others ' || n || '; ' end;
  select count(*) into n from public.discover_profiles() where id = b;
  r := r || case when n = 1 then 'ok passed person back in Discover; ' else 'FAIL not back; ' end;

  reset role;
  select count(*) into n from public.passes where passer_id = b;
  r := r || case when n = 2 then 'ok B''s passes untouched; ' else 'FAIL B passes ' || n || '; ' end;
  select count(*) into n from public.likes;
  r := r || case when n >= 2 then 'ok likes untouched by review; ' else 'FAIL likes changed; ' end;

  -- Still invisible to A: B passed A, so A must not learn that from Discover data.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.discover_profiles() where id = a;
  r := r || case when n = 0 then 'ok B still does not see A after A reviewed passes; ' else 'FAIL B sees A; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
