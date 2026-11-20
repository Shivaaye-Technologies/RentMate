-- Admin MFA (migration 20261121100000_admin_mfa.sql). Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  mb uuid := gen_random_uuid();
  r text := ''; n int; ok boolean; js jsonb; codes text[]; sess uuid;
  claims_aal1 text; claims_aal2 text;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@mfa.test', 'authenticated', 'authenticated' from unnest(array[adm, modr, mb]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, modr, mb]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin'), (modr, 'moderator');
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), adm), (gen_random_uuid(), adm), (gen_random_uuid(), modr);
  select id into sess from auth.sessions where user_id = adm limit 1;
  claims_aal1 := json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal1', 'session_id', sess)::text;
  claims_aal2 := json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sess)::text;

  set local role authenticated;
  -- ===== No lockout: MFA is not required until switched on =====
  perform set_config('request.jwt.claims', claims_aal1, true);
  r := r || case when private.has_role('admin') then 'ok admins keep access before MFA is switched on; ' else 'FAIL admin locked out; ' end;
  js := public.my_security_status();
  r := r || case when (js ->> 'privileged')::boolean and not (js ->> 'mfa_required')::boolean and not (js ->> 'has_factor')::boolean
                 then 'ok security status shows role, setting and missing factor; ' else 'FAIL status ' || js::text || '; ' end;
  begin
    perform public.admin_set_mfa_required(true);
    r := r || 'FAIL switched on from an aal1 session; ';
  exception when insufficient_privilege then r := r || 'ok MFA can only be switched on from a verified (aal2) session; ';
  end;
  perform set_config('request.jwt.claims', claims_aal2, true);
  begin
    perform public.admin_set_mfa_required(true);
    r := r || 'FAIL switched on while admins lack MFA; ';
  exception when raise_exception then r := r || 'ok MFA cannot be required while any admin or moderator lacks a factor; ';
  end;
  select count(*) into n from public.admin_mfa_readiness() where not has_factor;
  r := r || case when n = 2 then 'ok the readiness list shows who still needs MFA; ' else 'FAIL readiness ' || n || '; ' end;
  reset role;
  insert into auth.mfa_factors (user_id, status) values (adm, 'verified'), (modr, 'verified');
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_aal2, true);
  perform public.admin_set_mfa_required(true);
  r := r || 'ok MFA switches on once every privileged account has a factor; ';

  -- ===== Enforcement =====
  perform set_config('request.jwt.claims', claims_aal1, true);
  r := r || case when not private.has_role('admin') then 'ok a password-only session loses admin powers; ' else 'FAIL aal1 admin; ' end;
  begin
    perform public.admin_suspend_account(mb, 'MFA test');
    r := r || 'FAIL admin action at aal1; ';
  exception when insufficient_privilege then r := r || 'ok admin functions refuse password-only sessions; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  r := r || case when not private.has_role('moderator') then 'ok moderators need MFA too; ' else 'FAIL aal1 moderator; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  r := r || case when private.has_role('moderator') and not private.has_role('admin') then 'ok an aal2 moderator gets moderator powers only; ' else 'FAIL aal2 moderator; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  r := r || case when not private.has_role('moderator') then 'ok MFA never grants a role by itself; ' else 'FAIL member elevated; ' end;
  perform set_config('request.jwt.claims', claims_aal2, true);
  r := r || case when private.has_role('admin') then 'ok an aal2 admin keeps full access; ' else 'FAIL aal2 admin; ' end;

  -- ===== Recovery codes =====
  perform set_config('request.jwt.claims', claims_aal1, true);
  begin
    perform public.mfa_generate_recovery_codes();
    r := r || 'FAIL codes from aal1; ';
  exception when insufficient_privilege then r := r || 'ok recovery codes can only be created after MFA verification; ';
  end;
  perform set_config('request.jwt.claims', claims_aal2, true);
  codes := public.mfa_generate_recovery_codes();
  reset role;
  select count(*) into n from private.mfa_recovery_codes where user_id = adm and used_at is null;
  r := r || case when cardinality(codes) = 10 and n = 10 then 'ok ten one-time codes are issued; ' else 'FAIL codes ' || n || '; ' end;
  select count(*) into n from private.mfa_recovery_codes where code_sha256 = convert_to(codes[1], 'UTF8');
  r := r || case when n = 0 then 'ok codes are stored only as hashes; ' else 'FAIL plain codes stored; ' end;
  set local role authenticated;
  -- Lost authenticator: back to a password-only session.
  perform set_config('request.jwt.claims', claims_aal1, true);
  r := r || case when public.mfa_use_recovery_code('WRONG-CODE-0000') = 'invalid' then 'ok a wrong code is refused; ' else 'FAIL wrong code; ' end;
  ok := public.mfa_use_recovery_code(lower(codes[2])) = 'ok';
  r := r || case when ok and private.has_role('admin') then 'ok a valid code restores access for a short time; ' else 'FAIL recovery; ' end;
  reset role;
  select count(*) into n from auth.sessions where user_id = adm and (not_after is null or not_after > now());
  r := r || case when n = 1 then 'ok using a recovery code ends the person''s other sessions; ' else 'FAIL sessions left ' || n || '; ' end;
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_aal1, true);
  r := r || case when public.mfa_use_recovery_code(codes[2]) = 'invalid' then 'ok each code works once; ' else 'FAIL code reused; ' end;
  reset role;
  delete from private.mfa_recovery_grants where user_id = adm; -- policy-guard: allow (test reset of the grant)
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_aal1, true);
  r := r || case when not private.has_role('admin') then 'ok the recovery grant expires; ' else 'FAIL grant lasts; ' end;
  -- Two failures so far (a wrong code and a reused one); three more reach the limit of five per hour.
  for n in 1..3 loop perform public.mfa_use_recovery_code('NOPE-NOPE-' || n); end loop;
  r := r || case when public.mfa_use_recovery_code(codes[3]) = 'locked' and not private.has_role('admin')
                 then 'ok five failed attempts lock recovery for an hour, even with a valid code; '
                 else 'FAIL unlimited recovery attempts; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.mfa_use_recovery_code(codes[4]);
    r := r || 'FAIL member used recovery; ';
  exception when insufficient_privilege then r := r || 'ok recovery is only for privileged accounts; ';
  end;
  reset role;

  -- ===== Session revocation and audit =====
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_aal2, true);
  perform public.admin_set_role(modr, 'moderator', false);
  reset role;
  select count(*) into n from auth.sessions where user_id = modr and (not_after is null or not_after > now());
  r := r || case when n = 0 then 'ok removing a role ends that person''s sessions; ' else 'FAIL moderator sessions left; ' end;
  select count(*) into n from auth.sessions where user_id = modr;
  r := r || case when n = 1 then 'ok revoked sessions are kept as records, not deleted; ' else 'FAIL sessions deleted; ' end;
  select count(distinct action) into n from public.moderation_actions
  where action in ('mfa_required_on', 'mfa_recovery_codes_generated', 'mfa_recovery_failed', 'mfa_recovery_used',
                   'mfa_recovery_locked', 'role_revoked');
  r := r || case when n = 6 then 'ok every MFA event is in the moderation log; ' else 'FAIL audit kinds ' || n || '; ' end;
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_aal2, true);
  perform public.admin_set_mfa_required(false);
  perform set_config('request.jwt.claims', claims_aal1, true);
  r := r || case when private.has_role('admin') then 'ok switching MFA off restores password-only access; ' else 'FAIL switch off; ' end;
  begin
    select count(*) into n from private.mfa_recovery_codes;
    r := r || 'FAIL client read recovery codes; ';
  exception when insufficient_privilege then r := r || 'ok clients cannot read recovery codes; ';
  end;
  reset role;

  -- RLS policies hold a direct reference to private.has_role: it must be the MFA-aware function itself.
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'private' and p.proname = 'has_role' and pg_get_functiondef(p.oid) like '%mfa_satisfied%';
  select count(*) + n * 0 into n from pg_policy where pg_get_expr(polqual, polrelid) like '%has_role(%'
     or pg_get_expr(polwithcheck, polrelid) like '%has_role(%';
  r := r || case when n > 0 and not exists (select 1 from pg_proc where proname like 'has_role\_%')
                 and exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                             where s.nspname = 'private' and p.proname = 'has_role'
                               and pg_get_functiondef(p.oid) like '%mfa_satisfied%')
                 then 'ok every RLS policy role check (' || n || ') enforces MFA; ' else 'FAIL policy role checks; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
