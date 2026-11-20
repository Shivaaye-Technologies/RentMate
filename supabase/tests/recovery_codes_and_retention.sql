-- Migration 20261122090000_recovery_codes_and_retention.sql: 80-bit recovery codes and F-20 suspension retention.
-- Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  bad uuid := gen_random_uuid();     -- suspended, then deletes the account
  cleared uuid := gen_random_uuid(); -- suspension lifted, then deletes the account
  back uuid := gen_random_uuid();    -- signs up again with bad's email
  other uuid := gen_random_uuid();   -- unrelated new member
  r text := ''; n int; codes text[]; c text; res text; h bytea; js jsonb; sess uuid; m bigint; rec record;
begin
  insert into auth.users (id, email, aud, role) values
    (adm, 'admin@retention.test', 'authenticated', 'authenticated'),
    (bad, 'Repeat.Offender@Retention.test', 'authenticated', 'authenticated'),
    (cleared, 'cleared@retention.test', 'authenticated', 'authenticated');
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, bad, cleared]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), adm);
  select id into sess from auth.sessions where user_id = adm limit 1;

  -- ===== Recovery codes: 80 bits =====
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sess)::text, true);
  codes := public.mfa_generate_recovery_codes();
  select count(*) into n from unnest(codes) x where x ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){4}$';
  r := r || case when n = 10 then 'ok ten codes in the 20-digit (80-bit) format; ' else 'FAIL format ' || codes::text || '; ' end;
  select count(distinct x) into n from unnest(codes) x;
  r := r || case when n = 10 then 'ok all codes differ; ' else 'FAIL duplicate codes; ' end;
  reset role;
  select count(*) into n from private.mfa_recovery_codes where user_id = adm and used_at is null
    and code_sha256 = any (select sha256(convert_to(x, 'UTF8')) from unnest(codes) x);
  r := r || case when n = 10 then 'ok only hashes are stored; ' else 'FAIL stored ' || n || '; ' end;
  -- Typed in lower case with spaces instead of dashes: still accepted, once.
  c := lower(replace(codes[1], '-', ' '));
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal1', 'session_id', sess)::text, true);
  res := public.mfa_use_recovery_code(c);
  r := r || case when res = 'ok' then 'ok a code typed in any case and spacing works; ' else 'FAIL use ' || res || '; ' end;
  res := public.mfa_use_recovery_code(c);
  r := r || case when res = 'invalid' then 'ok a used code cannot be reused; ' else 'FAIL reuse ' || res || '; ' end;
  reset role;
  -- Codes issued before this migration (12 digits) keep working.
  insert into private.mfa_recovery_codes (user_id, code_sha256)
    values (adm, sha256(convert_to('ABCD-1234-EF56', 'UTF8')));
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal1', 'session_id', sess)::text, true);
  res := public.mfa_use_recovery_code('abcd1234ef56');
  r := r || case when res = 'ok' then 'ok older 12-digit codes still work; ' else 'FAIL legacy ' || res || '; ' end;
  reset role;

  -- ===== F-20: retention =====
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sess)::text, true);
  perform public.admin_suspend_account(bad, 'Repeated harassment reports');
  perform public.admin_suspend_account(cleared, 'Mistaken report');
  perform public.admin_lift_suspension(cleared, 'Report was mistaken');
  reset role;

  -- The suspended member deletes their account (same path as Settings → Delete account).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', bad, 'role', 'authenticated')::text, true);
  perform public.delete_my_account();
  perform set_config('request.jwt.claims', json_build_object('sub', cleared, 'role', 'authenticated')::text, true);
  perform public.delete_my_account();
  reset role;
  select count(*) into n from auth.users where id in (bad, cleared);
  r := r || case when n = 0 then 'ok both accounts are deleted; ' else 'FAIL accounts left; ' end;
  select count(*) into n from public.account_suspensions where user_id in (bad, cleared);
  r := r || case when n = 0 then 'ok suspension rows go with the account as before; ' else 'FAIL rows left; ' end;
  select count(*) into n from private.retained_suspensions;
  r := r || case when n = 1 then 'ok only the active suspension is retained (the lifted one is not); '
                 else 'FAIL retained ' || n || '; ' end;
  select * into rec from private.retained_suspensions limit 1;
  r := r || case when rec.identity_hash is not null and octet_length(rec.identity_hash) = 32
                  and rec.expires_at > now() + interval '729 days' and rec.expires_at < now() + interval '731 days'
                 then 'ok it keeps a 32-byte keyed hash and expires after 730 days; ' else 'FAIL record; ' end;
  r := r || case when rec.identity_hash <> sha256(convert_to('repeat.offender@retention.test', 'UTF8'))
                 then 'ok the hash is keyed (a plain SHA-256 of the email does not match); ' else 'FAIL unkeyed hash; ' end;
  select count(*) into n from information_schema.columns
  where table_schema = 'private' and table_name = 'retained_suspensions'
    and column_name in ('email', 'user_id', 'reason', 'display_name');
  r := r || case when n = 0 then 'ok no email, user id, name or reason is retained; ' else 'FAIL personal columns; ' end;
  select count(*) into n from public.moderation_actions where action = 'suspension_retained_on_deletion';
  r := r || case when n = 1 then 'ok the retention is logged; ' else 'FAIL log ' || n || '; ' end;

  -- Signing up again with the same email (different case and spaces) is flagged for review, not blocked.
  insert into auth.users (id, email, aud, role) values
    (back, '  repeat.offender@RETENTION.test ', 'authenticated', 'authenticated'),
    (other, 'someone.else@retention.test', 'authenticated', 'authenticated');
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[back, other]) u;
  select count(*) into n from private.retention_matches where user_id = back;
  r := r || case when n = 1 then 'ok a returning suspended email is flagged; ' else 'FAIL flag ' || n || '; ' end;
  select count(*) into n from private.retention_matches where user_id = other;
  r := r || case when n = 0 then 'ok other new members are not flagged; ' else 'FAIL false flag; ' end;
  r := r || case when not private.is_suspended(back) then 'ok nobody is suspended automatically; ' else 'FAIL auto-suspended; ' end;

  -- Access: members cannot see any of it; moderators review flags without seeing emails or hashes.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  begin
    perform * from public.admin_list_retention_matches();
    r := r || 'FAIL member listed flags; ';
  exception when insufficient_privilege then r := r || 'ok members cannot list flags; ';
  end;
  begin
    select count(*) into n from private.retained_suspensions;
    r := r || 'FAIL member read retained table; ';
  exception when insufficient_privilege then r := r || 'ok members cannot read retained records; ';
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sess)::text, true);
  select count(*), min(match_id) into n, m from public.admin_list_retention_matches() where user_id = back;
  r := r || case when n = 1 then 'ok moderators see the flag; ' else 'FAIL listing ' || n || '; ' end;
  perform public.admin_review_retention_match(m);
  select count(*) into n from public.admin_list_retention_matches() where user_id = back and reviewed_at is not null;
  r := r || case when n = 1 then 'ok a flag can be marked reviewed; ' else 'FAIL review; ' end;
  begin
    perform public.admin_review_retention_match(m);
    r := r || 'FAIL reviewed twice; ';
  exception when raise_exception then r := r || 'ok a flag is reviewed once; ';
  end;
  reset role;

  -- Expiry: an expired record no longer matches, and purging erases its hash.
  update private.retained_suspensions set expires_at = now() - interval '1 day';
  insert into auth.users (id, email, aud, role) values (gen_random_uuid(), 'repeat.offender@retention.test', 'authenticated', 'authenticated')
    returning id into back;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values (back, 'Member', 30, 'friendship', 18, 60);
  select count(*) into n from private.retention_matches where user_id = back;
  r := r || case when n = 0 then 'ok expired records are not matched; ' else 'FAIL matched expired; ' end;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sess)::text, true);
  n := public.admin_purge_expired_retention();
  reset role;
  r := r || case when n = 1 and not exists (select 1 from private.retained_suspensions where identity_hash is not null)
                 then 'ok purging erases the hash of expired records; ' else 'FAIL purge ' || n || '; ' end;
  select count(*) into n from private.retained_suspensions;
  r := r || case when n = 1 then 'ok an anonymous row remains for counting; ' else 'FAIL rows ' || n || '; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
