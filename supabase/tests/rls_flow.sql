-- Database permission test. Always rolls back (see README.md).
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); e uuid := gen_random_uuid();
  r text := ''; mid uuid; n int; ok boolean;
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
    insert into public.profiles (id, display_name, age, interests, looking_for, age_min, age_max)
    values ((auth.uid()), 'User '||act, 28, '{hiking}', 'relationship', 20, 40);
  end loop;

  -- as A
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  begin insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (gen_random_uuid(),'Fake',30,'casual',20,40); r := r||'FAIL impersonate; '; exception when others then r := r||'ok profile-for-someone-else blocked; '; end;
  begin update public.profiles set verified = true where id = a; r := r||'FAIL self-verify; '; exception when insufficient_privilege then r := r||'ok self-verify blocked; '; end;
  begin update public.profiles set age = 17 where id = a; r := r||'FAIL underage; '; exception when check_violation then r := r||'ok under-18 blocked; '; end;
  update public.profiles set display_name = 'Hacked' where id = b; get diagnostics n = row_count;
  r := r || case when n = 0 then 'ok cannot edit others profile; ' else 'FAIL edit other; ' end;
  update public.profiles set lat = 12.971599, lng = 77.594566 where id = a;
  select (lat = 12.97 and lng = 77.59) into ok from public.profiles where id = a;
  r := r || case when ok then 'ok location rounded to ~1km; ' else 'FAIL location precision; ' end;

  insert into public.likes (liker_id, liked_id, is_super, message) values (a, b, true, 'Hi from A');
  begin insert into public.likes (liker_id, liked_id) values (b, a); r := r||'FAIL like-as-other; '; exception when others then r := r||'ok cannot like on behalf of others; '; end;

  -- as C: cannot see A's like to B
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  select count(*) into n from public.likes where liker_id = a; r := r || case when n = 0 then 'ok others likes hidden; ' else 'FAIL likes leak; ' end;

  -- as B: sees received super like, likes back -> match
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  select count(*) into n from public.likes where liker_id = a and liked_id = b and is_super and message = 'Hi from A';
  r := r || case when n = 1 then 'ok received super like visible; ' else 'FAIL received like; ' end;
  insert into public.likes (liker_id, liked_id) values (b, a);
  select id into mid from public.matches where (user_a, user_b) = (least(a,b), greatest(a,b));
  r := r || case when mid is not null then 'ok mutual like created match; ' else 'FAIL no match; ' end;

  -- messages
  insert into public.messages (match_id, sender_id, body) values (mid, b, 'Hello A!');
  begin insert into public.messages (match_id, sender_id, body) values (mid, a, 'spoof'); r := r||'FAIL spoof sender; '; exception when others then r := r||'ok cannot send as someone else; '; end;

  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  select count(*) into n from public.matches; r := r || case when n = 0 then 'ok outsider sees no matches; ' else 'FAIL match leak; ' end;
  select count(*) into n from public.messages; r := r || case when n = 0 then 'ok outsider sees no messages; ' else 'FAIL message leak; ' end;
  begin insert into public.messages (match_id, sender_id, body) values (mid, c, 'intrude'); r := r||'FAIL outsider message; '; exception when others then r := r||'ok outsider cannot message; '; end;
  begin perform public.set_ready_to_meet(mid, true); r := r||'FAIL outsider ready; '; exception when others then r := r||'ok outsider cannot set ready; '; end;

  -- ready to meet
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  select count(*) into n from public.messages where match_id = mid; r := r || case when n = 1 then 'ok participant reads chat; ' else 'FAIL chat read; ' end;
  perform public.set_ready_to_meet(mid, true);
  begin
    if a = least(a,b) then update public.matches set ready_b = true where id = mid; else update public.matches set ready_a = true where id = mid; end if;
    r := r||'FAIL set other flag; ';
  exception when insufficient_privilege then r := r||'ok cannot set partner ready flag; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub',b,'role','authenticated')::text, true);
  perform public.set_ready_to_meet(mid, true);
  select ready_a and ready_b into ok from public.matches where id = mid;
  r := r || case when ok then 'ok both ready to meet; ' else 'FAIL ready flags; ' end;

  -- super like limit (A already sent 1)
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  insert into public.likes (liker_id, liked_id, is_super) values (a, c, true), (a, d, true);
  begin insert into public.likes (liker_id, liked_id, is_super) values (a, e, true); r := r||'FAIL super limit; '; exception when raise_exception then r := r||'ok 4th super like per day blocked; '; end;

  -- pass + rewind
  insert into public.passes (passer_id, passed_id) values (a, e);
  delete from public.passes where passer_id = a and passed_id = e; get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok rewind pass; ' else 'FAIL rewind; ' end;

  -- photo storage folders
  insert into storage.objects (bucket_id, name) values ('photos', a::text || '/me.jpg');
  r := r || 'ok upload to own folder; ';
  begin insert into storage.objects (bucket_id, name) values ('photos', b::text || '/x.jpg'); r := r||'FAIL upload other folder; '; exception when others then r := r||'ok cannot upload to others folder; '; end;

  -- anonymous visitors
  reset role;
  set local role anon;
  select count(*) into n from public.profiles; r := r || case when n = 0 then 'ok anon sees no profiles; ' else 'FAIL anon profiles; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
