-- Account deletion removes photos first (migration 20261123120000_account_deletion_photos.sql). Always rolls back.
-- Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid();    -- the member deleting their account
  b uuid := gen_random_uuid();    -- another member
  x uuid := gen_random_uuid();    -- an account deleted before this change: files left, no profile, no user
  adm uuid := gen_random_uuid();
  r text := ''; cnt int; names text[]; ok boolean;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@deletion.test', 'authenticated', 'authenticated' from unnest(array[a, b, adm]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[a, b, adm]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');
  insert into storage.objects (bucket_id, name, owner)
  select 'photos', u::text || f, u from unnest(array[a, b]) u cross join unnest(array['/main.jpg', '/second.jpg', '/stray.jpg']) f;
  insert into storage.objects (bucket_id, name, owner) values
    ('photos', x::text || '/left-behind.jpg', x), ('photos', 'not-a-uuid/file.jpg', null);

  -- ===== Account deletion =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_my_account();
    r := r || 'FAIL deleted an account that still has photos; ';
  exception when raise_exception then
    r := r || case when sqlerrm like '%(3 left)%' then 'ok deletion is refused while 3 photos remain; '
                   else 'FAIL message ' || sqlerrm || '; ' end;
  end;
  reset role;
  select exists (select 1 from auth.users where id = a) into ok;
  r := r || case when ok then 'ok the refused deletion left the account intact; ' else 'FAIL account gone; ' end;

  -- Partial failure: one photo removed, two remain; still refused.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from storage.objects where name = a::text || '/stray.jpg';
  begin
    perform public.delete_my_account();
    r := r || 'FAIL deleted with 2 photos left; ';
  exception when raise_exception then
    r := r || case when sqlerrm like '%(2 left)%' then 'ok after a partial photo removal, deletion is still refused; '
                   else 'FAIL message ' || sqlerrm || '; ' end;
  end;
  -- Remaining photos removed (as the Storage API does with the member's own session), then the account goes.
  delete from storage.objects where name like a::text || '/%';
  perform public.delete_my_account();
  reset role;
  select count(*) into cnt from auth.users where id = a;
  r := r || case when cnt = 0 then 'ok the account is deleted once its photos are gone; ' else 'FAIL account remains; ' end;
  select count(*) into cnt from public.profiles where id = a;
  r := r || case when cnt = 0 then 'ok the profile went with it; ' else 'FAIL profile remains; ' end;
  select count(*) into cnt from storage.objects where name like a::text || '/%';
  r := r || case when cnt = 0 then 'ok no photo of the deleted account remains; ' else 'FAIL orphaned ' || cnt || '; ' end;
  -- Retry: repeating the call after a completed deletion is harmless.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.delete_my_account();
  r := r || 'ok repeating a completed deletion is harmless; ';
  reset role;
  select count(*) into cnt from storage.objects where name like b::text || '/%';
  r := r || case when cnt = 3 then 'ok another member''s photos are untouched; ' else 'FAIL other member ' || cnt || '; ' end;

  -- ===== Orphaned photos (admins only) =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_orphaned_photos();
    r := r || 'FAIL a member listed orphaned photos; ';
  exception when insufficient_privilege then r := r || 'ok members cannot list orphaned photos; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  select array_agg(o.name order by o.name) into names from public.admin_orphaned_photos() o;
  r := r || case when x::text || '/left-behind.jpg' = any (names) and 'not-a-uuid/file.jpg' = any (names)
                      and not (b::text || '/main.jpg' = any (names))
                 then 'ok admins see photos left by deleted accounts, not live members'' photos; '
                 else 'FAIL orphan list ' || coalesce(names::text, 'none') || '; ' end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
