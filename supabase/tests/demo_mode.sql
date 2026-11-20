-- Demo Mode test: the public demo list shows only fictional, released demo
-- profiles; visitors still cannot read real members. Always rolls back.
-- Every result must start with "ok".
do $$
declare
  u uuid := gen_random_uuid();
  r text := '';
  n int;
  released int;
  future uuid;
  bad_cols int;
begin
  select count(*) into released from public.profiles
  where is_demo and (demo_visible_from is null or demo_visible_from <= now());

  insert into auth.users (id, email, aud, role, instance_id)
  values (u, 'real@demo-mode.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, display_name, age, interests, looking_for, age_min, age_max, lat, lng)
  values (u, 'Real Member', 30, '{music}', 'relationship', 18, 45, 28.61, 77.21);

  -- A demo profile scheduled for tomorrow must stay hidden until then.
  select id into future from public.profiles where is_demo order by id limit 1;
  update public.profiles set demo_visible_from = now() + interval '1 day' where id = future;
  select count(*) into released from public.profiles
  where is_demo and (demo_visible_from is null or demo_visible_from <= now());

  -- ===== Visitors (not signed in) =====
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from public.demo_mode_profiles(500);
  r := r || case when n = released then 'ok visitor sees all released demo profiles (' || n || '); ' else 'FAIL visitor sees ' || n || ' of ' || released || '; ' end;
  select count(*) into n from public.demo_mode_profiles(500) where id = u;
  r := r || case when n = 0 then 'ok real member never in demo list; ' else 'FAIL real member listed; ' end;
  select count(*) into n from public.demo_mode_profiles(500) where id = future;
  r := r || case when n = 0 then 'ok scheduled demo profile hidden until release; ' else 'FAIL future profile shown; ' end;
  select count(*) into n from public.demo_mode_profiles(500) where photo_path !~ '^demo/avatars/[0-9]{3}\.svg$';
  r := r || case when n = 0 then 'ok demo photos are bundled illustrations; ' else 'FAIL photo paths; ' end;
  select count(*) into n from public.demo_mode_profiles(3);
  r := r || case when n = 3 then 'ok limit respected; ' else 'FAIL limit ' || n || '; ' end;
  begin
    select count(*) into n from public.profiles;
    r := r || case when n = 0 then 'ok visitor reads no profiles; ' else 'FAIL visitor reads profiles; ' end;
  exception when insufficient_privilege then r := r || 'ok visitor reads no profiles; ';
  end;
  begin perform * from public.discover_profiles(); r := r || 'FAIL visitor discover; ';
  exception when insufficient_privilege then r := r || 'ok visitor cannot use real discovery; '; end;
  begin perform * from public.demo_profile_ids(); r := r || 'FAIL visitor demo ids; ';
  exception when insufficient_privilege then r := r || 'ok visitor cannot call tester functions; '; end;
  begin perform private.is_tester(); r := r || 'FAIL visitor private fn; ';
  exception when insufficient_privilege then r := r || 'ok visitor cannot call other private functions; '; end;
  begin insert into public.likes (liker_id, liked_id) values (u, future); r := r || 'FAIL visitor wrote a like; ';
  exception when insufficient_privilege then r := r || 'ok visitor cannot write likes; '; end;

  -- ===== Signed-in ordinary member =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select count(*) into n from public.demo_mode_profiles(500);
  r := r || case when n = released then 'ok member can open Demo Mode; ' else 'FAIL member demo list ' || n || '; ' end;
  select count(*) into n from public.discover_profiles() where id in (select id from public.demo_mode_profiles(500));
  r := r || case when n = 0 then 'ok demo stays out of real discovery; ' else 'FAIL demo in real discovery ' || n || '; ' end;
  begin
    update public.profiles set demo_visible_from = now() where id = u;
    r := r || 'FAIL member set demo_visible_from; ';
  exception when insufficient_privilege then r := r || 'ok members cannot set release times; ';
  end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
