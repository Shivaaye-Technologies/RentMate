-- Rollback for 20261122090000_recovery_codes_and_retention.sql. NOT a migration. Founder approval and a backup first.
-- Apply as a new, timestamped forward migration, newest rollback first. Rehearsed by scripts/test-rollback.mjs.
-- Rolling back discards retained suspension records (keyed hashes only) and open review flags.

-- ===== 2. F-20 retention =====
drop function if exists public.admin_purge_expired_retention();
drop function if exists public.admin_review_retention_match(bigint);
drop function if exists public.admin_list_retention_matches();
drop trigger if exists flag_returning_account on public.profiles;
drop function if exists private.flag_returning_account();
drop trigger if exists retain_suspension_on_delete on auth.users;
drop function if exists private.retain_suspension_on_delete();
drop function if exists private.identity_hash(text);
drop table if exists private.retention_matches;
drop table if exists private.retained_suspensions;
drop table if exists private.retention_settings;

-- ===== 1. Recovery codes: restore the functions from 20261121100000_admin_mfa.sql, verbatim =====
-- Codes issued in the 20-digit format stop working after this; issue new codes after rolling back.
create or replace function public.mfa_generate_recovery_codes()
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  codes text[] := '{}';
  c text;
begin
  if me is null or not private.is_privileged(me) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if private.session_aal() <> 'aal2' then
    raise exception 'Verify with your authenticator app first.' using errcode = '42501';
  end if;
  update private.mfa_recovery_codes set used_at = now() where user_id = me and used_at is null;
  for i in 1..10 loop
    c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    c := substr(c, 1, 4) || '-' || substr(c, 5, 4) || '-' || substr(c, 9, 4);
    codes := codes || c;
    insert into private.mfa_recovery_codes (user_id, code_sha256) values (me, sha256(convert_to(c, 'UTF8')));
  end loop;
  perform private.log_action('mfa_recovery_codes_generated', 'user', me::text, null);
  return codes;
end;
$$;

-- Lost authenticator: a one-time code grants 15 minutes of privileged access to set up a new factor. 5 failed
-- attempts per hour lock recovery for that account. Other sessions are revoked. Returns 'ok', 'invalid' or 'locked'
-- (a status rather than an error, so the lockout itself is recorded in the moderation log).
create or replace function public.mfa_use_recovery_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  hit bigint;
begin
  if me is null or not private.is_privileged(me) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if (select count(*) from private.mfa_recovery_attempts a where a.user_id = me and not a.ok
      and a.at > now() - interval '1 hour') >= 5 then
    perform private.log_action('mfa_recovery_locked', 'user', me::text, null);
    return 'locked';
  end if;
  select id into hit from private.mfa_recovery_codes
  where user_id = me and used_at is null and code_sha256 = sha256(convert_to(upper(btrim(coalesce(p_code, ''))), 'UTF8'))
  for update;
  insert into private.mfa_recovery_attempts (user_id, ok) values (me, hit is not null);
  if hit is null then
    perform private.log_action('mfa_recovery_failed', 'user', me::text, null);
    return 'invalid';
  end if;
  update private.mfa_recovery_codes set used_at = now() where id = hit;
  insert into private.mfa_recovery_grants (user_id, valid_until) values (me, now() + interval '15 minutes')
  on conflict (user_id) do update set valid_until = excluded.valid_until;
  perform private.revoke_sessions(me, nullif(auth.jwt() ->> 'session_id', '')::uuid);
  perform private.log_action('mfa_recovery_used', 'user', me::text, null);
  return 'ok';
end;
$$;

drop function if exists private.normalise_recovery_code(text);
