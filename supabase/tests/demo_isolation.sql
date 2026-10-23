-- Demo profile isolation test. Run AFTER the demo migration and seed are in place
-- (or inside a transaction that applies them). Always rolls back.
-- Every result must start with "ok".
do $$
declare
  t uuid := gen_random_uuid();  -- tester
  u uuid := gen_random_uuid();  -- ordinary user
  demo_ids uuid[];
  d uuid;
  mid uuid;
  r text := '';
  n int;
  i int;
begin
  select array_agg(id order by id) into demo_ids from public.profiles where is_demo;
  r := r || case when coalesce(array_length(demo_ids, 1), 0) = 100 then 'ok 100 demo profiles seeded; ' else 'FAIL demo count ' || coalesce(array_length(demo_ids, 1), 0) || '; ' end;

  insert into auth.users (id, email, aud, role, instance_id) values
    (t, 't@demo-test.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (u, 'u@demo-test.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, display_name, age, interests, looking_for, age_min, age_max, lat, lng)
  values (t, 'Tester', 28, '{music}', 'relationship', 18, 45, 28.61, 77.21),
         (u, 'Ordinary', 28, '{music}', 'relationship', 18, 45, 28.61, 77.21);
  update public.profiles set is_tester = true where id = t;

  -- ===== Ordinary user: demo profiles do not exist =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select count(*) into n from public.discover_profiles() where id = any (demo_ids);
  r := r || case when n = 0 then 'ok ordinary user discovers no demo; ' else 'FAIL ordinary discovers ' || n || ' demo; ' end;
  select count(*) into n from public.discover_profiles() where id = t;
  r := r || case when n = 1 then 'ok ordinary user still discovers real people; ' else 'FAIL ordinary cannot see tester; ' end;
  select count(*) into n from public.profiles where id = any (demo_ids);
  r := r || case when n = 0 then 'ok ordinary user cannot read demo rows; ' else 'FAIL ordinary reads ' || n || ' demo rows; ' end;
  select count(*) into n from public.profiles_by_ids(demo_ids);
  r := r || case when n = 0 then 'ok demo hidden by id; ' else 'FAIL by_ids shows demo; ' end;
  select count(*) into n from public.demo_profile_ids();
  r := r || case when n = 0 then 'ok ordinary user gets no demo ids; ' else 'FAIL demo ids leaked; ' end;
  begin
    insert into public.likes (liker_id, liked_id) values (u, demo_ids[1]);
    r := r || 'FAIL ordinary liked a demo; ';
  exception when others then r := r || 'ok ordinary user cannot like a demo; ';
  end;
  begin
    update public.profiles set is_tester = true where id = u;
    r := r || 'FAIL user made themself a tester; ';
  exception when insufficient_privilege then r := r || 'ok users cannot make themselves testers; ';
  end;
  begin
    update public.profiles set is_demo = true where id = u;
    r := r || 'FAIL user set is_demo; ';
  exception when insufficient_privilege then r := r || 'ok users cannot set is_demo; ';
  end;

  -- ===== Tester: sees demo profiles, they like back and reply =====
  perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
  select count(*) into n from public.discover_profiles() where id = any (demo_ids);
  r := r || case when n = 100 then 'ok tester discovers all 100 demo; ' else 'FAIL tester discovers ' || n || '; ' end;
  select count(*) into n from public.discover_profiles() where id = any (demo_ids) and distance_km is not null and distance_km <= 30;
  r := r || case when n = 100 then 'ok demo distances within 30 km; ' else 'FAIL distances ' || n || '; ' end;
  select count(*) into n from public.discover_profiles() where id = any (demo_ids) and online;
  r := r || case when n between 5 and 50 then 'ok some demo online (' || n || '); ' else 'FAIL online ' || n || '; ' end;
  select count(*) into n from public.demo_profile_ids();
  r := r || case when n = 100 then 'ok tester gets demo ids; ' else 'FAIL tester demo ids ' || n || '; ' end;

  d := demo_ids[1];
  insert into public.likes (liker_id, liked_id, is_super, message) values (t, d, true, 'Hi!');
  select id into mid from public.matches where (user_a, user_b) = (least(t, d), greatest(t, d));
  r := r || case when mid is not null then 'ok super like to demo creates match; ' else 'FAIL no match after super like; ' end;

  for i in 2..21 loop
    insert into public.likes (liker_id, liked_id) values (t, demo_ids[i]);
  end loop;
  select count(*) into n from public.matches where t in (user_a, user_b);
  r := r || case when n between 10 and 21 then 'ok most likes matched (' || n || ' of 21); ' else 'FAIL matches ' || n || '; ' end;
  select count(*) into n from public.likes where liked_id = t;
  r := r || case when n = (select count(*) from public.matches where t in (user_a, user_b)) then 'ok tester sees demo likes; ' else 'FAIL likes received ' || n || '; ' end;

  insert into public.messages (match_id, sender_id, body) values (mid, t, 'Hello!');
  select count(*) into n from public.messages where match_id = mid and sender_id = d;
  r := r || case when n = 1 then 'ok demo replies; ' else 'FAIL replies ' || n || '; ' end;
  for i in 1..11 loop
    insert into public.messages (match_id, sender_id, body) values (mid, t, 'msg ' || i);
  end loop;
  select count(*) into n from public.messages where match_id = mid and sender_id = d;
  r := r || case when n = 10 then 'ok replies stop at 10; ' else 'FAIL reply count ' || n || '; ' end;
  select count(*) into n from public.messages where match_id = mid and sender_id = d and body like '%demo profile%';
  r := r || case when n = 1 then 'ok last reply says it is a demo; ' else 'FAIL demo notice; ' end;

  -- Ordinary users never receive demo likes or replies.
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select count(*) into n from public.likes where liked_id = u;
  r := r || case when n = 0 then 'ok ordinary user got no demo likes; ' else 'FAIL ordinary got likes; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
