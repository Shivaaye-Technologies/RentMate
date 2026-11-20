-- Database-level age attestation with the requirement ON (migration 20261123140000_age_attestation_enforcement.sql).
-- Staging test: the switch is turned on inside this transaction only, and everything always rolls back. Every
-- result must start with "ok". "As a member" means role authenticated with that member's JWT claims, which is what a
-- direct Supabase REST request runs as.
do $$
declare
  a uuid := gen_random_uuid();    -- adult who attests, then creates a profile
  y uuid := gen_random_uuid();    -- under-18 date of birth
  c uuid := gen_random_uuid();    -- no 18+ confirmation
  m uuid := gen_random_uuid();    -- no date of birth
  n uuid := gen_random_uuid();    -- never attests
  e uuid := gen_random_uuid();    -- existing member, profile created before the switch, never attested
  w uuid := gen_random_uuid();    -- invalid attestation written directly by the owner
  d uuid := gen_random_uuid();    -- reserved demo account
  f uuid := gen_random_uuid();    -- real-looking account marked is_demo by a privileged client
  r text := ''; cnt int; demo0 int; yrs int; ok boolean; born date := (current_date - interval '25 years')::date;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@enforce.test', 'authenticated', 'authenticated' from unnest(array[a, y, c, m, n, e, w, f]) u;
  insert into auth.users (id, email, aud, role) values (d, 'demo-901@demo.soulmate.invalid', 'authenticated', 'authenticated');
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
    values (e, 'Existing', 33, 'friendship', 18, 60);

  select count(*) into demo0 from public.profiles where is_demo;

  -- ===== Default and switch =====
  select private.age_attestation_required() into ok;
  r := r || case when not ok then 'ok the requirement is off by default; ' else 'FAIL default on; ' end;
  update public.platform_settings set require_age_attestation = true;
  select private.age_attestation_required() into ok;
  r := r || case when ok then 'ok staging: require_age_attestation = true; ' else 'FAIL switch not on; ' end;

  -- ===== Members cannot change the switch =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', n, 'role', 'authenticated')::text, true);
  begin
    update public.platform_settings set require_age_attestation = false;
    r := r || 'FAIL a member changed the switch; ';
  exception when insufficient_privilege then r := r || 'ok members cannot change the switch; ';
  end;

  -- ===== Direct profile creation without an attestation =====
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (n, 'Nina', 30, 'friendship', 18, 60);
    r := r || 'FAIL a direct insert without an attestation was accepted; ';
  exception when raise_exception then r := r || 'ok a direct insert without an attestation is refused; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (n, 'Nina', 30, 'friendship', 18, 60)
      on conflict (id) do update set bio = 'x';
    r := r || 'FAIL a direct upsert without an attestation was accepted; ';
  exception when raise_exception then r := r || 'ok a direct upsert without an attestation is refused; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max, is_demo) values (n, 'Nina', 30, 'friendship', 18, 60, true);
    r := r || 'FAIL a member set is_demo; ';
  exception when insufficient_privilege then r := r || 'ok members cannot mark their own profile as demo; ';
  end;

  -- ===== Under 18, no confirmation, no date of birth: refused, nothing stored, no profile =====
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  begin
    perform public.attest_adult((current_date - interval '17 years')::date, true);
    r := r || 'FAIL under-18 accepted; ';
  exception when raise_exception then r := r || 'ok an under-18 date of birth is refused; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (y, 'Yash', 18, 'friendship', 18, 60);
    r := r || 'FAIL profile created after an under-18 refusal; ';
  exception when raise_exception then r := r || 'ok no profile after an under-18 refusal; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  begin
    perform public.attest_adult(born, false);
    r := r || 'FAIL accepted without confirmation; ';
  exception when raise_exception then r := r || 'ok a missing 18+ confirmation is refused; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (c, 'Chirag', 25, 'friendship', 18, 60);
    r := r || 'FAIL profile created without confirmation; ';
  exception when raise_exception then r := r || 'ok no profile without the confirmation; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  begin
    perform public.attest_adult(null, true);
    r := r || 'FAIL accepted without a date of birth; ';
  exception when invalid_parameter_value then r := r || 'ok a missing date of birth is refused; ';
  end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (m, 'Mira', 25, 'friendship', 18, 60);
    r := r || 'FAIL profile created without a date of birth; ';
  exception when raise_exception then r := r || 'ok no profile without a date of birth; ';
  end;

  -- ===== Normal sign-up: attest, then create the profile (as onboarding and PUT /api/v1/profile do) =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  yrs := public.attest_adult(born, true);
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (a, 'Asha', 30, 'friendship', 18, 60)
    on conflict (id) do update set display_name = excluded.display_name;
  select age into yrs from public.profiles where id = a;
  r := r || case when yrs = 25 then 'ok a valid adult attestation creates the profile, with the attested age; '
              else 'FAIL attested profile age ' || coalesce(yrs::text, 'missing') || '; ' end;
  select count(*) into cnt from public.my_age_attestation() where method = 'self_declared';
  r := r || case when cnt = 1 then 'ok the record is labelled self_declared, not verified; ' else 'FAIL method; ' end;

  -- ===== Existing members are not locked out =====
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  select count(*) into cnt from public.profiles where id = e;
  r := r || case when cnt = 1 then 'ok an existing member can still read their profile; ' else 'FAIL existing read; ' end;
  update public.profiles set bio = 'Still here' where id = e;
  update public.profiles set age = 34 where id = e;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (e, 'Existing', 34, 'friendship', 18, 60)
    on conflict (id) do update set display_name = 'Existing again';
  select count(*) into cnt from public.profiles where id = e and bio = 'Still here' and age = 34 and display_name = 'Existing again';
  r := r || case when cnt = 1 then 'ok an existing member can still update and upsert their profile; ' else 'FAIL existing update; ' end;

  -- ===== Private date of birth =====
  begin
    select count(*) into cnt from private.age_attestations;
    r := r || 'FAIL members can read the attestation table; ';
  exception when insufficient_privilege then r := r || 'ok the attestation table stays closed to members; ';
  end;
  select count(*) into cnt from public.my_age_attestation();
  r := r || case when cnt = 0 then 'ok another member sees no date of birth; ' else 'FAIL leak; ' end;
  reset role;
  select count(*) into cnt from public.profiles where id = e and not hidden;
  r := r || case when cnt = 1 then 'ok existing profiles are not hidden or changed by the switch; ' else 'FAIL existing hidden; ' end;

  -- ===== No exception for the owner or service role =====
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (n, 'Nina', 30, 'friendship', 18, 60);
    r := r || 'FAIL the owner created an unattested profile; ';
  exception when raise_exception then r := r || 'ok the owner/service role cannot create an unattested profile either; ';
  end;
  insert into private.age_attestations (user_id, birth_date) values (w, (current_date - interval '16 years')::date);
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (w, 'Wren', 30, 'friendship', 18, 60);
    r := r || 'FAIL an invalid (under-18) attestation was accepted; ';
  exception when raise_exception then r := r || 'ok an invalid attestation is refused; ';
  end;

  -- ===== Demo profiles: reserved demo accounts only =====
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max, is_demo) values (d, 'Demo', 26, 'friendship', 18, 60, true);
  select count(*) into cnt from public.profiles where id = d and is_demo;
  r := r || case when cnt = 1 then 'ok a reserved demo account can have a demo profile without an attestation; ' else 'FAIL demo; ' end;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max, is_demo) values (f, 'Farah', 30, 'friendship', 18, 60, true);
    r := r || 'FAIL is_demo exempted a non-demo account; ';
  exception when raise_exception then r := r || 'ok is_demo alone does not exempt a real account; ';
  end;
  delete from public.profiles where id = d;
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (d, 'Demo', 26, 'friendship', 18, 60);
    r := r || 'FAIL a reserved account without is_demo was exempted; ';
  exception when raise_exception then r := r || 'ok a reserved demo account still needs is_demo; ';
  end;
  select count(*) into cnt from public.profiles where is_demo;
  r := r || case when cnt = demo0 then 'ok the existing demo profiles are untouched; ' else 'FAIL demo profiles ' || cnt || ' vs ' || demo0 || '; ' end;

  -- ===== Fail closed if the settings row is missing =====
  delete from public.platform_settings;
  select private.age_attestation_required() into ok;
  r := r || case when ok then 'ok a missing settings row means required (fail closed); ' else 'FAIL missing row is off; ' end;
  insert into public.platform_settings default values;

  -- ===== Turning the switch off restores the previous behaviour =====
  update public.platform_settings set require_age_attestation = false;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (n, 'Nina', 30, 'friendship', 18, 60);
  select count(*) into cnt from public.profiles where id = n;
  r := r || case when cnt = 1 then 'ok with the switch off again, profiles are created as before; ' else 'FAIL switch off; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
