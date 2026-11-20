-- 1. MFA recovery codes: 80 bits instead of 48 (review of 20261121100000_admin_mfa.sql).
-- 2. F-20: privacy-preserving retention of suspensions when an account is deleted (SEC-04).
-- Append-only. Changes no existing rows: codes already issued stay valid; retention starts with the next deletion.

-- ===== 1. Recovery codes =====
-- Old codes were the first 12 hex digits of a UUID (48 bits). Rate limiting makes that safe against online guessing,
-- but the stored unsalted SHA-256 hashes could be reversed offline in hours if the table leaked. New codes carry 80
-- random bits (5 groups of 4 hex digits, taken from the random part of two UUIDs), which is out of reach offline.
create function private.normalise_recovery_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  with c as (select regexp_replace(upper(coalesce(p_code, '')), '[^0-9A-F]', '', 'g') as x)
  select case char_length(x)
           when 20 then substr(x, 1, 4) || '-' || substr(x, 5, 4) || '-' || substr(x, 9, 4) || '-'
                        || substr(x, 13, 4) || '-' || substr(x, 17, 4)
           when 12 then substr(x, 1, 4) || '-' || substr(x, 5, 4) || '-' || substr(x, 9, 4)
           else upper(btrim(coalesce(p_code, '')))
         end
  from c;
$$;
revoke execute on function private.normalise_recovery_code(text) from public;

create or replace function public.mfa_generate_recovery_codes()
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  codes text[] := '{}';
  raw text;
  c text;
begin
  if me is null or not private.is_privileged(me) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if private.session_aal() <> 'aal2' then
    raise exception 'Verify with your authenticator app first.' using errcode = '42501';
  end if;
  update private.mfa_recovery_codes set used_at = now() where user_id = me and used_at is null;
  for i in 1..10 loop
    -- The first 12 hex digits of a version-4 UUID are fully random (the version digit comes after them).
    raw := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
                 || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    c := private.normalise_recovery_code(raw);
    codes := codes || c;
    insert into private.mfa_recovery_codes (user_id, code_sha256) values (me, sha256(convert_to(c, 'UTF8')));
  end loop;
  perform private.log_action('mfa_recovery_codes_generated', 'user', me::text, null);
  return codes;
end;
$$;

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
  -- Spacing, dashes and case do not matter; 12-digit codes issued before this migration keep working.
  select id into hit from private.mfa_recovery_codes
  where user_id = me and used_at is null
    and code_sha256 = sha256(convert_to(private.normalise_recovery_code(p_code), 'UTF8'))
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

-- ===== 2. F-20: suspension retention after account deletion =====
-- Deleting an account cascades away its suspension and appeal rows, so a suspended person could delete the account
-- and sign up again with the same email, unseen. Design (privacy-preserving):
--   * Only an ACTIVE suspension at the moment of deletion is retained. Lifted suspensions are not.
--   * What is kept: a keyed SHA-256 of the normalised email (no email, no name, no user id, no free-text reason),
--     when the suspension started, when the account was deleted, and when the record expires.
--   * The key ("pepper") is random per database and never leaves it, so the hash cannot be matched against email
--     lists outside the database.
--   * A new sign-up with a matching email is FLAGGED for moderator review. Nobody is suspended automatically.
--   * Records expire after retention_days (default 730, founder/legal decision F-20). Purging erases the hash; only
--     an anonymous row remains for counting.
create table private.retention_settings (
  id smallint primary key default 1 check (id = 1),
  pepper bytea not null,
  retention_days int not null default 730 check (retention_days between 30 and 1825)
);
insert into private.retention_settings (id, pepper)
values (1, decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'));

create table private.retained_suspensions (
  id bigint generated always as identity primary key,
  identity_hash bytea,                -- null once purged
  suspended_at timestamptz not null,
  account_deleted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  purged_at timestamptz,
  constraint hash_until_purged check ((identity_hash is null) = (purged_at is not null))
);
create index retained_suspensions_hash on private.retained_suspensions (identity_hash) where identity_hash is not null;

create table private.retention_matches (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  retained_id bigint not null references private.retained_suspensions (id),
  matched_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

create function private.identity_hash(p_email text)
returns bytea
language sql
stable
security definer
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p_email, '')), '') is null then null
              else sha256((select pepper from private.retention_settings where id = 1)
                          || convert_to(lower(btrim(p_email)), 'UTF8')) end;
$$;
revoke execute on function private.identity_hash(text) from public, anon, authenticated;

-- Before an account row disappears (self-service deletion or the dashboard): keep an active suspension, hashed.
create function private.retain_suspension_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s timestamptz;
  h bytea := private.identity_hash(old.email);
begin
  select created_at into s from public.account_suspensions where user_id = old.id and lifted_at is null;
  if s is not null and h is not null then
    insert into private.retained_suspensions (identity_hash, suspended_at, expires_at)
    values (h, s, now() + make_interval(days => (select retention_days from private.retention_settings where id = 1)));
    perform private.log_action('suspension_retained_on_deletion', 'user', old.id::text, null);
  end if;
  return old;
end;
$$;
revoke execute on function private.retain_suspension_on_delete() from public, anon, authenticated;
create trigger retain_suspension_on_delete before delete on auth.users
  for each row execute function private.retain_suspension_on_delete();

-- A new profile whose sign-up email matches an unexpired retained suspension is flagged for review.
create function private.flag_returning_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h bytea;
  hit bigint;
begin
  if new.is_demo then return new; end if;
  select private.identity_hash(u.email) into h from auth.users u where u.id = new.id;
  if h is null then return new; end if;
  select r.id into hit from private.retained_suspensions r
  where r.identity_hash = h and r.expires_at > now()
  order by r.account_deleted_at desc limit 1;
  if hit is not null then
    insert into private.retention_matches (user_id, retained_id) values (new.id, hit);
    perform private.log_action('returning_suspended_account_flagged', 'user', new.id::text, null);
  end if;
  return new;
end;
$$;
revoke execute on function private.flag_returning_account() from public, anon, authenticated;
create trigger flag_returning_account after insert on public.profiles
  for each row execute function private.flag_returning_account();

-- Moderators: review flags. No email or hash is ever returned.
create function public.admin_list_retention_matches()
returns table (match_id bigint, user_id uuid, display_name text, matched_at timestamptz,
               previous_suspension_at timestamptz, previous_account_deleted_at timestamptz, reviewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role('moderator') then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select m.id, m.user_id, p.display_name, m.matched_at, r.suspended_at, r.account_deleted_at, m.reviewed_at
    from private.retention_matches m
    join private.retained_suspensions r on r.id = m.retained_id
    left join public.profiles p on p.id = m.user_id
    order by m.reviewed_at nulls first, m.matched_at desc
    limit 200;
end;
$$;

create function public.admin_review_retention_match(p_match bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role('moderator') then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update private.retention_matches set reviewed_at = now(), reviewed_by = (select auth.uid())
  where id = p_match and reviewed_at is null;
  if not found then raise exception 'Flag not found or already reviewed.' using errcode = 'P0001'; end if;
  perform private.log_action('retention_match_reviewed', 'user',
    (select user_id::text from private.retention_matches where id = p_match), null);
end;
$$;

-- Admins: erase the identifying hash of expired records (data minimisation). Returns how many were purged.
create function public.admin_purge_expired_retention()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if not private.has_role('admin') then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update private.retained_suspensions set identity_hash = null, purged_at = now()
  where expires_at <= now() and purged_at is null;
  get diagnostics n = row_count;
  perform private.log_action('retention_purged', 'retention', n::text, null);
  return n;
end;
$$;

revoke execute on function public.admin_list_retention_matches() from public, anon;
revoke execute on function public.admin_review_retention_match(bigint) from public, anon;
revoke execute on function public.admin_purge_expired_retention() from public, anon;
grant execute on function public.admin_list_retention_matches() to authenticated;
grant execute on function public.admin_review_retention_match(bigint) to authenticated;
grant execute on function public.admin_purge_expired_retention() to authenticated;

-- Private tables: never reachable by API roles, even if the schema were exposed by mistake.
revoke all on private.retention_settings, private.retained_suspensions, private.retention_matches
  from public, anon, authenticated;
