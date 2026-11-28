-- Date of birth and 18+ confirmation (migration 20261123130000_age_attestation.sql). Always rolls back. Every result
-- must start with "ok". This is a self-declaration, not verification; the tests check the rules around it.
do $$
declare
  a uuid := gen_random_uuid();    -- adult member, profile created after attesting
  y uuid := gen_random_uuid();    -- tries an under-18 date
  o uuid := gen_random_uuid();    -- other member
  n uuid := gen_random_uuid();    -- new member while the switch is on
  r text := ''; cnt int; yrs int; d date; born date := (current_date - interval '25 years')::date;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@age.test', 'authenticated', 'authenticated' from unnest(array[a, y, o, n]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[a, o]) u;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  -- ===== Refusals store nothing =====
  begin
    perform public.attest_adult((current_date - interval '17 years')::date, true);
    r := r || 'FAIL accepted a 17-year-old; ';
  exception when raise_exception then r := r || 'ok an under-18 date is refused; ';
  end;
  begin
    perform public.attest_adult((current_date - interval '18 years' + interval '1 day')::date, true);
    r := r || 'FAIL accepted the day before an 18th birthday; ';
  exception when raise_exception then r := r || 'ok the day before an 18th birthday is refused; ';
  end;
  begin
    perform public.attest_adult(born, false);
    r := r || 'FAIL accepted without confirmation; ';
  exception when raise_exception then r := r || 'ok the 18+ confirmation is required; ';
  end;
  begin
    perform public.attest_adult(current_date + 1, true);
    r := r || 'FAIL accepted a future date; ';
  exception when invalid_parameter_value then r := r || 'ok a future date is refused; ';
  end;
  begin
    perform public.attest_adult((current_date - interval '101 years')::date, true);
    r := r || 'FAIL accepted an impossible age; ';
  exception when invalid_parameter_value then r := r || 'ok an age over 100 is refused; ';
  end;
  reset role;
  select count(*) into cnt from private.age_attestations where user_id = y;
  r := r || case when cnt = 0 then 'ok nothing is stored for refused attempts; ' else 'FAIL stored a refusal; ' end;

  -- ===== An adult attests =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', y, 'role', 'authenticated')::text, true);
  yrs := public.attest_adult((current_date - interval '18 years')::date, true);
  r := r || case when yrs = 18 then 'ok an 18th birthday today is accepted; ' else 'FAIL 18th birthday ' || yrs || '; ' end;
  begin
    perform public.attest_adult((current_date - interval '30 years')::date, true);
    r := r || 'FAIL the member changed their recorded date; ';
  exception when raise_exception then r := r || 'ok a recorded date cannot be changed by the member; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  yrs := public.attest_adult(born, true);
  r := r || case when yrs = 25 then 'ok attesting returns the age; ' else 'FAIL age ' || yrs || '; ' end;
  yrs := public.attest_adult(born, true);
  r := r || case when yrs = 25 then 'ok repeating the same date is harmless; ' else 'FAIL repeat ' || yrs || '; ' end;
  select birth_date into d from public.my_age_attestation();
  r := r || case when d = born then 'ok members can read their own date of birth; ' else 'FAIL own read; ' end;
  select age into yrs from public.profiles where id = a;
  r := r || case when yrs = 25 then 'ok the profile age now matches the date of birth (was 30); ' else 'FAIL profile age ' || yrs || '; ' end;
  update public.profiles set age = 40 where id = a;
  select age into yrs from public.profiles where id = a;
  r := r || case when yrs = 25 then 'ok an attested member cannot set a different age; ' else 'FAIL age edit ' || yrs || '; ' end;

  -- ===== Privacy =====
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  select count(*) into cnt from public.my_age_attestation();
  r := r || case when cnt = 0 then 'ok another member sees no date of birth through the function; ' else 'FAIL leak ' || cnt || '; ' end;
  begin
    select count(*) into cnt from private.age_attestations;
    r := r || 'FAIL members can read the attestation table; ';
  exception when insufficient_privilege then r := r || 'ok the attestation table is closed to members; ';
  end;
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.attest_adult(born, true);
    r := r || 'FAIL signed-out call accepted; ';
  exception when insufficient_privilege then r := r || 'ok signed-out visitors cannot attest; ';
  end;
  reset role;
  select count(*) into cnt from private.age_attestations where user_id = a and method = 'self_declared';
  r := r || case when cnt = 1 then 'ok the record is labelled self_declared, not verified; ' else 'FAIL method; ' end;

  -- ===== Switch for new profiles (off by default) =====
  select count(*) into cnt from public.platform_settings where not require_age_attestation;
  r := r || case when cnt = 1 then 'ok the requirement is off by default; ' else 'FAIL default on; ' end;
  update public.platform_settings set require_age_attestation = true;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', n, 'role', 'authenticated')::text, true);
  begin
    insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (n, 'New', 30, 'friendship', 18, 60);
    r := r || 'FAIL a profile was created without an attestation while required; ';
  exception when raise_exception then r := r || 'ok when switched on, a new profile needs an attestation; ';
  end;
  perform public.attest_adult((current_date - interval '22 years')::date, true);
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (n, 'New', 30, 'friendship', 18, 60);
  select age into yrs from public.profiles where id = n;
  r := r || case when yrs = 22 then 'ok after attesting the profile is created with the attested age; ' else 'FAIL new age ' || yrs || '; ' end;
  reset role;
  select count(*) into cnt from public.profiles where id = o;
  r := r || case when cnt = 1 then 'ok existing profiles are unaffected by the switch; ' else 'FAIL existing; ' end;
  update public.platform_settings set require_age_attestation = false;

  -- ===== Deletion =====
  delete from auth.users where id = a;
  select count(*) into cnt from private.age_attestations where user_id = a;
  r := r || case when cnt = 0 then 'ok the date of birth is deleted with the account; ' else 'FAIL attestation survived; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
