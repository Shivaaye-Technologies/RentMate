-- Profile details test (migration 20261024090000): new fields are owner-written,
-- validated on the server, exposed to others only through the discovery
-- functions, paused profiles leave Discover, read markers and the blocked list
-- are private. Always rolls back. Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  r text := ''; n int; t text; j jsonb; mid uuid; other_mid uuid;
begin
  insert into auth.users (id, email, aud, role, instance_id) values
    (a, 'a@details.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (b, 'b@details.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (c, 'c@details.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, display_name, age, interests, looking_for, age_min, age_max) values
    (a, 'Asha', 28, '{Hiking}', 'relationship', 18, 45),
    (b, 'Bilal', 29, '{Travel}', 'relationship', 18, 45),
    (c, 'Chitra', 30, '{Books}', 'friendship', 18, 45);

  set local role authenticated;

  -- ---- A fills in the new fields ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.profiles set
    gender = 'woman', show_me = 'men', height_cm = 165, job = 'Architect', education = 'postgraduate',
    exercise = 'often', smoking = 'never', children = 'open', city = 'Pune',
    neighbourhoods = '{Koregaon Park,Baner}', favourite_places = '{Specialty coffee,Hiking trails}',
    prompts = '[{"q":"My ideal Sunday","a":"Sunrise trek, then dosa."}]',
    photos = array[a::text || '/one.jpg', a::text || '/two.jpg'],
    notify_prefs = '{"likes": true, "matches": true, "messages": false}'
  where id = a;
  get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok owner saves new fields; ' else 'FAIL owner save ' || n || '; ' end;
  select city, prompts into t, j from public.get_my_profile();
  r := r || case when t = 'Pune' and jsonb_array_length(j) = 1 then 'ok owner reads own fields; ' else 'FAIL own read; ' end;

  -- ---- Server-side validation ----
  begin
    update public.profiles set photos = array[b::text || '/x.jpg'] where id = a;
    r := r || 'FAIL photo in someone else''s folder accepted; ';
  exception when check_violation then r := r || 'ok photos must be in own folder; ';
  end;
  begin
    update public.profiles set photo_path = b::text || '/x.jpg' where id = a;
    r := r || 'FAIL foreign primary photo accepted; ';
  exception when check_violation then r := r || 'ok primary photo must be own; ';
  end;
  begin
    update public.profiles set photos = array[a::text || '/../x.jpg'] where id = a;
    r := r || 'FAIL path traversal accepted; ';
  exception when check_violation then r := r || 'ok no .. in photo paths; ';
  end;
  begin
    update public.profiles set prompts =
      '[{"q":"a","a":"1"},{"q":"b","a":"2"},{"q":"c","a":"3"},{"q":"d","a":"4"}]' where id = a;
    r := r || 'FAIL 4 prompts accepted; ';
  exception when check_violation then r := r || 'ok max 3 prompts; ';
  end;
  begin
    update public.profiles set prompts = jsonb_build_array(jsonb_build_object('q', 'Q', 'a', repeat('x', 201)))
    where id = a;
    r := r || 'FAIL long prompt answer accepted; ';
  exception when check_violation then r := r || 'ok prompt answer max 200; ';
  end;
  begin
    update public.profiles set prompts = '[{"q":"Q","a":"A","html":"<b>"}]' where id = a;
    r := r || 'FAIL extra prompt key accepted; ';
  exception when check_violation then r := r || 'ok prompt shape enforced; ';
  end;
  begin
    update public.profiles set favourite_places = '{a,b,c,d,e,f,g,h,i,j,k}' where id = a;
    r := r || 'FAIL 11 places accepted; ';
  exception when check_violation then r := r || 'ok max 10 places; ';
  end;
  begin
    update public.profiles set interests = '{a,b,c,d,e,f,g,h,i,j,k}' where id = a;
    r := r || 'FAIL 11 interests accepted; ';
  exception when check_violation then r := r || 'ok max 10 interests; ';
  end;
  begin
    update public.profiles set height_cm = 300 where id = a;
    r := r || 'FAIL height 300 accepted; ';
  exception when check_violation then r := r || 'ok height range; ';
  end;
  begin
    update public.profiles set notify_prefs = '{"likes": "yes"}' where id = a;
    r := r || 'FAIL bad notify prefs accepted; ';
  exception when check_violation then r := r || 'ok notify prefs shape; ';
  end;
  begin
    update public.profiles set age = 17 where id = a;
    r := r || 'FAIL under-18 accepted; ';
  exception when check_violation then r := r || 'ok 18+ still enforced; ';
  end;
  begin
    update public.profiles set is_tester = true where id = a;
    r := r || 'FAIL is_tester writable; ';
  exception when insufficient_privilege then r := r || 'ok is_tester not writable; ';
  end;

  -- ---- What B can see of A ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select city, prompts into t, j from public.discover_profiles() where id = a;
  r := r || case when t = 'Pune' and j -> 0 ->> 'q' = 'My ideal Sunday' then 'ok others see public fields; ' else 'FAIL public fields; ' end;
  begin
    perform show_me from public.discover_profiles();
    r := r || 'FAIL show_me exposed; ';
  exception when undefined_column then r := r || 'ok show_me not exposed; ';
  end;
  begin
    perform notify_prefs from public.profiles where id = a;
    r := r || 'FAIL notify_prefs readable by others; ';
  exception when insufficient_privilege then r := r || 'ok private columns not readable; ';
  end;
  update public.profiles set city = 'Hacked' where id = a;
  get diagnostics n = row_count;
  r := r || case when n = 0 then 'ok cannot edit someone else''s profile; ' else 'FAIL edited A; ' end;

  -- ---- Pause: A hides; B no longer discovers A, but a match still can see A ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  update public.profiles set hidden = true where id = a;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.discover_profiles() where id = a;
  r := r || case when n = 0 then 'ok paused profile not in Discover; ' else 'FAIL paused profile shown; ' end;

  reset role;
  insert into public.likes (liker_id, liked_id) values (a, b), (b, a);
  select id into mid from public.matches where user_a = least(a, b) and user_b = greatest(a, b);
  insert into public.likes (liker_id, liked_id) values (b, c), (c, b);
  select id into other_mid from public.matches where user_a = least(b, c) and user_b = greatest(b, c);
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.profiles_by_ids(array[a]);
  r := r || case when n = 1 then 'ok match still sees paused profile; ' else 'FAIL match lost paused profile; ' end;

  -- ---- Read markers ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.match_reads (match_id, user_id) values (mid, a)
    on conflict (match_id, user_id) do update set read_at = now();
  select count(*) into n from public.match_reads;
  r := r || case when n = 1 then 'ok own read marker saved; ' else 'FAIL read marker ' || n || '; ' end;
  begin
    insert into public.match_reads (match_id, user_id) values (mid, b);
    r := r || 'FAIL wrote read marker for someone else; ';
  exception when insufficient_privilege then r := r || 'ok cannot mark for someone else; ';
  end;
  begin
    insert into public.match_reads (match_id, user_id) values (other_mid, a);
    r := r || 'FAIL read marker on a stranger''s match; ';
  exception when insufficient_privilege then r := r || 'ok cannot mark others'' matches; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.match_reads where user_id = a;
  r := r || case when n = 0 then 'ok read markers are private; ' else 'FAIL saw A''s read marker; ' end;

  -- ---- Blocked list ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  insert into public.blocks (blocker_id, blocked_id) values (c, a);
  select count(*), max(display_name) into n, t from public.my_blocked_users();
  r := r || case when n = 1 and t = 'Asha' then 'ok blocked list shows own blocks; ' else 'FAIL blocked list; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.my_blocked_users();
  r := r || case when n = 0 then 'ok others'' blocks not listed; ' else 'FAIL saw others'' blocks; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  delete from public.blocks where blocked_id = a;
  get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok unblock works; ' else 'FAIL unblock ' || n || '; ' end;

  -- ---- Visitors ----
  reset role;
  set local role anon;
  begin
    perform 1 from public.my_blocked_users();
    r := r || 'FAIL anon read blocked list; ';
  exception when insufficient_privilege then r := r || 'ok anon cannot read blocked list; ';
  end;
  begin
    perform 1 from public.discover_profiles();
    r := r || 'FAIL anon discovered; ';
  exception when insufficient_privilege then r := r || 'ok anon cannot discover; ';
  end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
