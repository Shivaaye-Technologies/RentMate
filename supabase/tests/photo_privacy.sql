-- Photo privacy (migration 20261123110000_photo_privacy.sql). Always rolls back.
-- Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid();    -- the viewer
  b uuid := gen_random_uuid();    -- visible member (not hidden)
  h uuid := gen_random_uuid();    -- hidden member, no relationship with a
  k uuid := gen_random_uuid();    -- visible member who blocked a
  m uuid := gen_random_uuid();    -- hidden member matched with a
  l uuid := gen_random_uuid();    -- hidden member who liked a
  c uuid := gen_random_uuid();    -- hidden member who is an approved companion
  n uuid := gen_random_uuid();    -- visible member with no main photo (photo_path null)
  x uuid := gen_random_uuid();    -- an account deleted before this change: files left, no profile, no user
  r text := ''; cnt int; names text[]; ok boolean;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@photos.test', 'authenticated', 'authenticated' from unnest(array[a, b, h, k, m, l, c, n]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[a, b, h, k, m, l, c, n]) u;
  update public.profiles set hidden = true where id in (h, m, l, c);
  update public.profiles set photo_path = id::text || '/main.jpg', photos = array[id::text || '/main.jpg', id::text || '/second.jpg']
  where id in (a, b, h, k, m, l, c);
  update public.profiles set photos = array[n::text || '/listed.jpg'] where id = n;
  insert into public.blocks (blocker_id, blocked_id) values (k, a);
  insert into public.matches (user_a, user_b) values (least(a, m), greatest(a, m));
  insert into public.likes (liker_id, liked_id) values (l, a);
  insert into public.companion_profiles (user_id, headline, city, status) values (c, 'City walks and museums', 'Pune', 'approved');
  -- Files: every member has a published main photo, a published second photo and an unpublished stray upload.
  insert into storage.objects (bucket_id, name, owner)
  select 'photos', u::text || f, u
  from unnest(array[a, b, h, k, m, l, c]) u cross join unnest(array['/main.jpg', '/second.jpg', '/stray.jpg']) f;
  insert into storage.objects (bucket_id, name, owner) values
    ('photos', n::text || '/listed.jpg', n), ('photos', n::text || '/stray.jpg', n),
    ('photos', x::text || '/left-behind.jpg', x), ('photos', 'not-a-uuid/file.jpg', null);

  -- ===== Reading as member a =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into cnt from storage.objects where name like a::text || '/%';
  r := r || case when cnt = 3 then 'ok a sees all 3 of their own files, including unpublished ones; '
                 else 'FAIL own files ' || cnt || '; ' end;
  select array_agg(split_part(name, '/', 2) order by name) into names from storage.objects where name like b::text || '/%';
  r := r || case when names = array['main.jpg', 'second.jpg'] then 'ok a sees a visible member''s published photos only; '
                 else 'FAIL visible member ' || coalesce(names::text, 'none') || '; ' end;
  select count(*) into cnt from storage.objects where name like h::text || '/%';
  r := r || case when cnt = 0 then 'ok a hidden member''s photos are not readable; ' else 'FAIL hidden ' || cnt || '; ' end;
  select count(*) into cnt from storage.objects where name like k::text || '/%';
  r := r || case when cnt = 0 then 'ok photos of someone who blocked a are not readable; ' else 'FAIL blocked ' || cnt || '; ' end;
  select count(*) into cnt from storage.objects where name like m::text || '/%';
  r := r || case when cnt = 2 then 'ok a match''s published photos are readable even when hidden; ' else 'FAIL match ' || cnt || '; ' end;
  select count(*) into cnt from storage.objects where name like l::text || '/%';
  r := r || case when cnt = 2 then 'ok someone who liked a is readable even when hidden; ' else 'FAIL liker ' || cnt || '; ' end;
  select count(*) into cnt from storage.objects where name like c::text || '/%';
  r := r || case when cnt = 2 then 'ok an approved companion''s published photos are readable; ' else 'FAIL companion ' || cnt || '; ' end;
  select array_agg(split_part(name, '/', 2)) into names from storage.objects where name like n::text || '/%';
  r := r || case when names = array['listed.jpg'] then 'ok with no main photo, only listed photos are readable (null-safe check); '
                 else 'FAIL null photo_path ' || coalesce(names::text, 'none') || '; ' end;
  select count(*) into cnt from storage.objects where name like x::text || '/%';
  r := r || case when cnt = 0 then 'ok files of a deleted account are not readable; ' else 'FAIL orphan ' || cnt || '; ' end;
  select count(*) into cnt from storage.objects where name like 'not-a-uuid/%';
  r := r || case when cnt = 0 then 'ok a malformed folder is refused without an error; ' else 'FAIL malformed ' || cnt || '; ' end;
  -- Enumeration: listing the whole bucket returns only what a may see.
  select count(*) into cnt from storage.objects where bucket_id = 'photos';
  r := r || case when cnt = 3 + 2 + 2 + 2 + 2 + 1 then 'ok listing the bucket returns only own and visible published photos (12); '
                 else 'FAIL bucket listing ' || cnt || '; ' end;

  -- Blocking takes effect at once.
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (a, b);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into cnt from storage.objects where name like b::text || '/%';
  r := r || case when cnt = 0 then 'ok blocking someone hides their photos immediately; ' else 'FAIL after block ' || cnt || '; ' end;
  -- Hiding takes effect at once for people without a relationship.
  reset role;
  delete from public.blocks where blocker_id = a and blocked_id = b;
  update public.profiles set hidden = true where id = b;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into cnt from storage.objects where name like b::text || '/%';
  r := r || case when cnt = 0 then 'ok hiding a profile hides its photos from strangers; ' else 'FAIL after hide ' || cnt || '; ' end;

  -- Signed out: nothing.
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into cnt from storage.objects where bucket_id = 'photos';
  r := r || case when cnt = 0 then 'ok signed-out visitors read no photos; ' else 'FAIL anon ' || cnt || '; ' end;

  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
