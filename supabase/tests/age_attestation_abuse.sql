-- Attempts to get around database-level age attestation (20261123140000_age_attestation_enforcement.sql) with the
-- requirement ON. Always rolls back. Every result must start with "ok".
--
-- Covers the two exemptions: (1) an upsert of an existing profile is an update, which must never let anyone create
-- a NEW unattested profile; (2) demo profiles need is_demo AND a reserved demo email, which ordinary members must not
-- be able to obtain.
do $$
declare
  e uuid := gen_random_uuid();    -- existing member with a profile, never attested
  n uuid := gen_random_uuid();    -- new member, never attested, no profile
  v uuid := gen_random_uuid();    -- another new member (victim id, no profile)
  w uuid := gen_random_uuid();    -- another member who already has a profile (victim id)
  q uuid := gen_random_uuid();    -- member who signed up with a reserved-looking demo email
  r text := ''; cnt int;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@abuse.test', 'authenticated', 'authenticated' from unnest(array[e, n, v, w]) u;
  insert into auth.users (id, email, aud, role) values (q, 'demo-977@demo.soulmate.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
    values (e, 'Existing', 33, 'friendship', 18, 60), (w, 'Wendy', 41, 'friendship', 18, 60);
  update public.platform_settings set require_age_attestation = true;

  -- ===== (1) The existing-profile upsert exemption =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', n, 'role', 'authenticated')::text, true);
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
      values (n, 'Nina', 30, 'friendship', 18, 60), (n, 'Nina', 30, 'friendship', 18, 60);
    r := r || 'FAIL a multi-row insert created an unattested profile; ';
  exception when raise_exception then r := r || 'ok a multi-row insert of a new id is refused at the first row; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
      values (n, 'Nina', 30, 'friendship', 18, 60) on conflict (id) do nothing;
    r := r || 'FAIL an upsert (do nothing) created an unattested profile; ';
  exception when raise_exception then r := r || 'ok an upsert (do nothing) of a new id is refused; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (v, 'Victim', 30, 'friendship', 18, 60);
    r := r || 'FAIL an existing member created a profile for another account; ';
  exception when insufficient_privilege or raise_exception then
    r := r || 'ok an existing member cannot create a profile for another account; ';
  end;
  -- The exemption applies when the row already exists, so try it on another member's existing profile: RLS must stop
  -- both the insert and the upsert, and nothing about that profile may change.
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (w, 'Hijack', 30, 'friendship', 18, 60);
    r := r || 'FAIL inserted over another member''s existing profile; ';
  exception when insufficient_privilege or unique_violation then
    r := r || 'ok the exemption does not let a member insert another member''s existing id; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (w, 'Hijack', 30, 'friendship', 18, 60)
      on conflict (id) do update set display_name = 'Hijack';
    r := r || 'FAIL upserted another member''s existing profile; ';
  exception when insufficient_privilege then
    r := r || 'ok the exemption does not let a member upsert another member''s profile (RLS); ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
      values (e, 'Existing', 33, 'friendship', 18, 60), (v, 'Victim', 30, 'friendship', 18, 60)
      on conflict (id) do update set bio = 'x';
    r := r || 'FAIL an existing row in the same upsert carried a new unattested row through; ';
  exception when insufficient_privilege or raise_exception then
    r := r || 'ok an existing row in the same upsert does not carry a new row through; ';
  end;
  delete from public.profiles where id = e;
  get diagnostics cnt = row_count;
  r := r || case when cnt = 0 then 'ok members cannot delete their own profile row (no delete policy); '
              else 'FAIL a member deleted their profile row; ' end;
  reset role;
  delete from public.profiles where id = e; -- a profile removed by the platform (owner)
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (e, 'Existing', 33, 'friendship', 18, 60);
    r := r || 'FAIL re-creating a removed profile skipped the attestation; ';
  exception when raise_exception then r := r || 'ok a removed and re-created profile counts as new and is refused; ';
  end;
  reset role;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
      values (n, 'Nina', 30, 'friendship', 18, 60), (n, 'Nina', 30, 'friendship', 18, 60);
    r := r || 'FAIL the owner created an unattested profile with a multi-row insert; ';
  exception when raise_exception then r := r || 'ok even the owner cannot use a multi-row insert to get past the check; ';
  end;
  select count(*) into cnt from public.profiles where id in (e, n, v);
  r := r || case when cnt = 0 then 'ok no unattested profile was created by any attempt; ' else 'FAIL ' || cnt || ' profiles created; ' end;
  select count(*) into cnt from public.profiles where id = w and display_name = 'Wendy';
  r := r || case when cnt = 1 then 'ok the other member''s profile is unchanged; ' else 'FAIL victim profile changed; ' end;

  -- ===== (2) The demo exemption =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', q, 'role', 'authenticated')::text, true);
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (q, 'Quinn', 30, 'friendship', 18, 60);
    r := r || 'FAIL a reserved-looking email alone exempted a member; ';
  exception when raise_exception then r := r || 'ok a member with a reserved-looking demo email still needs an attestation; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max, is_demo) values (q, 'Quinn', 30, 'friendship', 18, 60, true);
    r := r || 'FAIL a member set is_demo on insert; ';
  exception when insufficient_privilege then r := r || 'ok a member cannot set is_demo on insert; ';
  end;
  reset role;
  -- Setup only: restore the existing member's profile (the owner gets no exemption, so the switch is briefly off).
  update public.platform_settings set require_age_attestation = false;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (e, 'Existing', 33, 'friendship', 18, 60);
  update public.platform_settings set require_age_attestation = true;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set is_demo = true where id = e;
    r := r || 'FAIL a member set is_demo on update; ';
  exception when insufficient_privilege then r := r || 'ok a member cannot set is_demo on update; ';
  end;
  begin
    update auth.users set email = 'demo-978@demo.soulmate.invalid' where id = e;
    r := r || 'FAIL a member changed their auth email directly; ';
  exception when insufficient_privilege then r := r || 'ok a member cannot write auth.users directly; ';
  end;
  begin
    perform private.is_reserved_demo_account(e);
    r := r || 'FAIL members can call the demo-account helper; ';
  exception when insufficient_privilege then r := r || 'ok members cannot call the enforcement helpers; ';
  end;
  reset role;
  select count(*) into cnt from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and (p.prosrc ~* 'set\s+[^;]*is_demo\s*=' or p.prosrc ~* 'insert into public\.profiles');
  r := r || case when cnt = 0 then 'ok no function members can call sets is_demo or creates profiles; '
              else 'FAIL ' || cnt || ' member-callable functions write is_demo or profiles; ' end;
  select count(*) into cnt from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_demo'
    and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE');
  r := r || case when cnt = 0 then 'ok is_demo has no client write privilege; ' else 'FAIL is_demo writable; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
