-- Database permission test. Always rolls back (see README.md).
-- Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  r text := ''; mid uuid; mid2 uuid; n int; ok boolean; i int;
  act text;
begin
  insert into auth.users (id, email, aud, role, instance_id) values
    (a,'a@rls.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (b,'b@rls.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (c,'c@rls.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (d,'d@rls.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (e,'e@rls.test','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

  set local role authenticated;
  foreach act in array array['a','b','c','d','e'] loop
    perform set_config('request.jwt.claims', json_build_object('sub',
      case act when 'a' then a when 'b' then b when 'c' then c when 'd' then d else e end, 'role','authenticated')::text, true);
    -- Same statement shape PostgREST uses for upsert.
    insert into public.profiles (id, display_name, age, interests, looking_for, age_min, age_max)
    values ((auth.uid()), 'User '||act, 28, '{hiking}', 'relationship', 20, 40)
    on conflict (id) do update set display_name = excluded.display_name;
  end loop;
  r := r || 'ok upsert works with column grants; ';

  -- ===== Profiles (as A) =====
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  begin insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (gen_random_uuid(),'Fake',30,'casual',20,40); r := r||'FAIL impersonate; '; exception when others then r := r||'ok profile-for-someone-else blocked; '; end;
  begin update public.profiles set verified = true where id = a; r := r||'FAIL self-verify; '; exception when insufficient_privilege then r := r||'ok self-verify blocked; '; end;
  begin update public.profiles set age = 17 where id = a; r := r||'FAIL underage; '; exception when check_violation then r := r||'ok under-18 blocked; '; end;
  update public.profiles set display_name = 'Hacked' where id = b; get diagnostics n = row_count;
  r := r || case when n = 0 then 'ok cannot edit others profile; ' else 'FAIL edit other; ' end;

  update public.profiles set lat = 12.971599, lng = 77.594566 where id = a;
  select (lat = 12.97 and lng = 77.59) into ok from public.get_my_profile();
  r := r || case when ok then 'ok location rounded to ~1km, readable by owner; ' else 'FAIL location precision; ' end;
  begin perform lat from public.profiles where id = b; r := r||'FAIL others coordinates readable; '; exception when insufficient_privilege then r := r||'ok others coordinates hidden; '; end;
  begin perform last_seen_at from public.profiles where id = b; r := r||'FAIL last_seen readable; '; exception when insufficient_privilege then r := r||'ok others last-seen hidden; '; end;

  -- B shares a location ~5.5 km away; A sees only a bucket (rounds to 6).
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  update public.profiles set lat = 13.01, lng = 77.62 where id = b;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  select distance_km, online into n, ok from public.discover_profiles() where id = b;
  r := r || case when n = 6 and ok then 'ok distance bucket + online flag; ' else format('FAIL distance %s online %s; ', n, ok) end;
  select count(*) into n from public.discover_profiles() where id in (b, c, d, e); r := r || case when n = 4 then 'ok discover lists the other 4 test users; ' else format('FAIL discover count %s; ', n) end;
  select count(*) into n from public.profiles_by_ids(array[b, c]); r := r || case when n = 0 then 'ok profiles_by_ids needs a relationship; ' else 'FAIL by_ids leak; ' end;

  -- ===== Likes, Super Likes, matches =====
  insert into public.likes (liker_id, liked_id, is_super, message) values (a, b, true, 'Hi from A');
  begin insert into public.likes (liker_id, liked_id) values (b, a); r := r||'FAIL like-as-other; '; exception when others then r := r||'ok cannot like on behalf of others; '; end;
  select count(*) into n from public.discover_profiles() where id = b; r := r || case when n = 0 then 'ok liked people leave discover; ' else 'FAIL liked still in discover; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  select count(*) into n from public.likes where liker_id = a; r := r || case when n = 0 then 'ok others likes hidden; ' else 'FAIL likes leak; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  select count(*) into n from public.likes where liker_id = a and liked_id = b and is_super and message = 'Hi from A';
  r := r || case when n = 1 then 'ok received super like visible; ' else 'FAIL received like; ' end;
  select count(*) into n from public.profiles_by_ids(array[a]); r := r || case when n = 1 then 'ok by_ids shows someone who liked you; ' else 'FAIL by_ids liker; ' end;
  insert into public.likes (liker_id, liked_id) values (b, a);
  select id into mid from public.matches where (user_a, user_b) = (least(a,b), greatest(a,b));
  r := r || case when mid is not null then 'ok mutual like created match; ' else 'FAIL no match; ' end;

  -- ===== Messages =====
  insert into public.messages (match_id, sender_id, body) values (mid, b, 'Hello A!');
  begin insert into public.messages (match_id, sender_id, body) values (mid, a, 'spoof'); r := r||'FAIL spoof sender; '; exception when others then r := r||'ok cannot send as someone else; '; end;
  begin
    for i in 1..19 loop insert into public.messages (match_id, sender_id, body) values (mid, b, 'm'||i); end loop;
    insert into public.messages (match_id, sender_id, body) values (mid, b, 'one too many');
    r := r||'FAIL message rate limit; ';
  exception when raise_exception then r := r||'ok 21st message in a minute blocked; '; end;

  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  select count(*) into n from public.matches; r := r || case when n = 0 then 'ok outsider sees no matches; ' else 'FAIL match leak; ' end;
  select count(*) into n from public.messages; r := r || case when n = 0 then 'ok outsider sees no messages; ' else 'FAIL message leak; ' end;
  begin insert into public.messages (match_id, sender_id, body) values (mid, c, 'intrude'); r := r||'FAIL outsider message; '; exception when others then r := r||'ok outsider cannot message; '; end;
  begin perform public.set_ready_to_meet(mid, true); r := r||'FAIL outsider ready; '; exception when others then r := r||'ok outsider cannot set ready; '; end;
  delete from public.matches where id = mid; get diagnostics n = row_count;
  r := r || case when n = 0 then 'ok outsider cannot unmatch; ' else 'FAIL outsider unmatch; ' end;

  -- ===== Ready to meet =====
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  -- 1, not 20: the rate-limit block above rolls back its own 19 inserts when the 21st fails.
  select count(*) into n from public.messages where match_id = mid; r := r || case when n = 1 then 'ok participant reads chat; ' else format('FAIL chat read %s; ', n) end;
  perform public.set_ready_to_meet(mid, true);
  begin
    if a = least(a,b) then update public.matches set ready_b = true where id = mid; else update public.matches set ready_a = true where id = mid; end if;
    r := r||'FAIL set other flag; ';
  exception when insufficient_privilege then r := r||'ok cannot set partner ready flag; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  perform public.set_ready_to_meet(mid, true);
  select ready_a and ready_b into ok from public.matches where id = mid;
  r := r || case when ok then 'ok both ready to meet; ' else 'FAIL ready flags; ' end;

  -- ===== Super Like limit, pass + rewind =====
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  insert into public.likes (liker_id, liked_id, is_super) values (a, c, true), (a, d, true);
  begin insert into public.likes (liker_id, liked_id, is_super) values (a, e, true); r := r||'FAIL super limit; '; exception when raise_exception then r := r||'ok 4th super like per day blocked; '; end;
  insert into public.passes (passer_id, passed_id) values (a, e);
  delete from public.passes where passer_id = a and passed_id = e; get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok rewind pass; ' else 'FAIL rewind; ' end;

  -- ===== Photos =====
  insert into storage.objects (bucket_id, name) values ('photos', a::text || '/me.jpg');
  r := r || 'ok upload to own folder; ';
  begin insert into storage.objects (bucket_id, name) values ('photos', b::text || '/x.jpg'); r := r||'FAIL upload other folder; '; exception when others then r := r||'ok cannot upload to others folder; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'photos' and name = a::text || '/me.jpg';
  r := r || case when n = 1 then 'ok signed-in member can read photo; ' else 'FAIL photo read; ' end;
  select not public into ok from storage.buckets where id = 'photos';
  r := r || case when ok then 'ok photos bucket private; ' else 'FAIL photos bucket public; ' end;

  -- ===== Reports =====
  insert into public.reports (reporter_id, reported_id, reason, details) values (c, d, 'fake', 'stock photo');
  r := r || 'ok report filed; ';
  begin insert into public.reports (reporter_id, reported_id, reason) values (d, c, 'scam'); r := r||'FAIL report as other; '; exception when others then r := r||'ok cannot report as someone else; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',d,'role','authenticated')::text, true);
  select count(*) into n from public.reports; r := r || case when n = 0 then 'ok reported person cannot see report; ' else 'FAIL report leak; ' end;

  -- ===== Blocks (B blocks A: A must lose B everywhere) =====
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  insert into public.blocks (blocker_id, blocked_id) values (b, a);
  begin insert into public.blocks (blocker_id, blocked_id) values (b, b); r := r||'FAIL self block; '; exception when check_violation then r := r||'ok cannot block yourself; '; end;
  select count(*) into n from public.profiles where id = a; r := r || case when n = 0 then 'ok blocker no longer sees blocked; ' else 'FAIL blocker sees blocked; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  select count(*) into n from public.profiles where id = b; r := r || case when n = 0 then 'ok blocked user cannot see blocker; ' else 'FAIL blocked sees blocker; ' end;
  select count(*) into n from public.matches where id = mid; r := r || case when n = 0 then 'ok match hidden after block; ' else 'FAIL match visible after block; ' end;
  select count(*) into n from public.messages where match_id = mid; r := r || case when n = 0 then 'ok chat hidden after block; ' else 'FAIL chat visible after block; ' end;
  begin insert into public.messages (match_id, sender_id, body) values (mid, a, 'still there?'); r := r||'FAIL message after block; '; exception when others then r := r||'ok cannot message after block; '; end;
  select count(*) into n from public.profiles_by_ids(array[b]); r := r || case when n = 0 then 'ok blocker hidden from by_ids; ' else 'FAIL by_ids after block; ' end;
  select count(*) into n from storage.objects where bucket_id = 'photos' and name like b::text || '/%';
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  select count(*) into n from storage.objects where name = a::text || '/me.jpg'; r := r || case when n = 0 then 'ok blocked photo unreadable; ' else 'FAIL photo after block; ' end;
  select count(*) into n from public.likes where liker_id = a and liked_id = b; r := r || case when n = 0 then 'ok likes from blocked hidden; ' else 'FAIL likes after block; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  begin insert into public.likes (liker_id, liked_id) values (a, b); r := r||'FAIL like blocked; '; exception when others then r := r||'ok cannot like someone in a block; '; end;

  -- ===== Unmatch (A and C) =====
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  insert into public.likes (liker_id, liked_id) values (c, a);
  select id into mid2 from public.matches where (user_a, user_b) = (least(a,c), greatest(a,c));
  insert into public.messages (match_id, sender_id, body) values (mid2, c, 'hey');
  delete from public.matches where id = mid2; get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok participant can unmatch; ' else 'FAIL unmatch; ' end;
  reset role;
  select count(*) into n from public.messages where match_id = mid2;
  r := r || case when n = 0 then 'ok unmatch removed conversation; ' else 'FAIL unmatch messages left; ' end;

  -- ===== Delete account (E) =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',e,'role','authenticated')::text, true);
  perform public.delete_my_account();
  reset role;
  select count(*) into n from auth.users where id = e; r := r || case when n = 0 then 'ok account deleted; ' else 'FAIL account remains; ' end;
  select count(*) into n from public.profiles where id = e; r := r || case when n = 0 then 'ok profile removed with account; ' else 'FAIL profile remains; ' end;
  set local role anon;
  begin perform public.delete_my_account(); r := r||'FAIL anon delete; '; exception when others then r := r||'ok anonymous cannot delete accounts; '; end;

  -- ===== Anonymous visitors =====
  begin select count(*) into n from public.profiles; r := r || case when n = 0 then 'ok anon sees no profiles; ' else 'FAIL anon profiles; ' end;
  exception when insufficient_privilege then r := r||'ok anon sees no profiles; '; end;
  begin perform * from public.discover_profiles(); r := r||'FAIL anon discover; '; exception when insufficient_privilege then r := r||'ok anon cannot call discover; '; end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
