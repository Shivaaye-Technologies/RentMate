-- Mandatory MFA for privileged accounts (docs/RENTMATE_ADMIN_MFA.md). Append-only.
--
-- Privileged roles today: admin and moderator (private.user_roles). Every admin/moderator power is gated by
-- private.has_role; this migration wraps it so that, once MFA is required, a privileged session must be at Supabase
-- assurance level aal2 (password + TOTP) or hold a short recovery grant from a one-time recovery code.
--
-- No lockout during migration: MFA is NOT required after this migration. An admin switches it on with
-- admin_set_mfa_required(true), which is refused until every admin and moderator has a verified MFA factor, and only
-- from an aal2 session. Recovery codes are stored as SHA-256 hashes, are single use, and attempts are rate limited.
-- Every MFA event is written to the moderation log.

create table private.security_settings (
  id smallint primary key default 1 check (id = 1),
  admin_mfa_required boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into private.security_settings (id) values (1);

create table private.mfa_recovery_codes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_sha256 bytea not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index mfa_recovery_codes_user on private.mfa_recovery_codes (user_id) where used_at is null;
create table private.mfa_recovery_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create table private.mfa_recovery_grants (
  user_id uuid primary key references auth.users (id) on delete cascade,
  valid_until timestamptz not null
);

create function private.is_privileged(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.user_roles r where r.user_id = p_user); $$;
revoke execute on function private.is_privileged(uuid) from public;

create function private.session_aal()
returns text
language sql stable security definer set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1'); $$;
revoke execute on function private.session_aal() from public;

create function private.has_verified_factor(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified'); $$;
revoke execute on function private.has_verified_factor(uuid) from public;

-- True when privileged actions may proceed for this session.
create function private.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not (select admin_mfa_required from private.security_settings where id = 1)
      or private.session_aal() = 'aal2'
      or exists (select 1 from private.mfa_recovery_grants g
                 where g.user_id = (select auth.uid()) and g.valid_until > now());
$$;
revoke execute on function private.mfa_satisfied() from public;

-- Every role check in RLS policies and admin functions goes through private.has_role. It is replaced in place (same
-- function, same grants), because RLS policies hold a direct reference to it: renaming it and adding a wrapper would
-- leave existing policies calling the old function.
create or replace function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    where r.user_id = (select auth.uid()) and (r.role = p_role or r.role = 'admin')
  ) and private.mfa_satisfied();
$$;

-- Session revocation: marks a person's Supabase sessions as expired now (auth.sessions.not_after), so their refresh
-- tokens stop working; access tokens already issued expire within their lifetime (1 hour by default). Nothing is
-- deleted. On hosted Supabase the database owner may lack rights on auth tables; then this logs and reports false,
-- and revocation must be done through the Auth admin API or dashboard (docs/RENTMATE_ADMIN_MFA.md).
create function private.revoke_sessions(p_user uuid, p_keep uuid default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update auth.sessions s set not_after = now()
  where s.user_id = p_user and (p_keep is null or s.id <> p_keep) and (s.not_after is null or s.not_after > now());
  return true;
exception when insufficient_privilege or undefined_table then
  perform private.log_action('session_revocation_unavailable', 'user', p_user::text, null);
  return false;
end;
$$;
revoke execute on function private.revoke_sessions(uuid, uuid) from public;

-- Losing a role ends that person's other sessions.
create function private.on_role_removed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.revoke_sessions(old.user_id);
  return old;
end;
$$;
revoke execute on function private.on_role_removed() from public;
create trigger revoke_sessions_on_role_removed after delete on private.user_roles
  for each row execute function private.on_role_removed();

-- What the app shows a privileged member about their MFA state.
create function public.my_security_status()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'privileged', private.is_privileged((select auth.uid())),
    'mfa_required', (select admin_mfa_required from private.security_settings where id = 1),
    'aal', private.session_aal(),
    'has_factor', private.has_verified_factor((select auth.uid())),
    'recovery_codes_left', (select count(*) from private.mfa_recovery_codes c
                            where c.user_id = (select auth.uid()) and c.used_at is null),
    'recovery_until', (select valid_until from private.mfa_recovery_grants g
                       where g.user_id = (select auth.uid()) and g.valid_until > now()),
    'mfa_ok', private.mfa_satisfied());
$$;

-- Ten new one-time recovery codes (replacing unused ones). Only from an aal2 session of a privileged member.
create function public.mfa_generate_recovery_codes()
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
create function public.mfa_use_recovery_code(p_code text)
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

-- Switch mandatory MFA on or off. Admin only, from an aal2 session; refused while any privileged member lacks a
-- verified factor (so nobody is locked out).
create function public.admin_set_mfa_required(p_on boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare missing int;
begin
  perform private.require_role('admin');
  if private.session_aal() <> 'aal2' then
    raise exception 'Verify with your authenticator app first.' using errcode = '42501';
  end if;
  if p_on then
    select count(distinct r.user_id) into missing from private.user_roles r
    where not private.has_verified_factor(r.user_id);
    if missing > 0 then
      raise exception '% admin or moderator account(s) have not set up MFA yet.', missing using errcode = 'P0001';
    end if;
  end if;
  update private.security_settings set admin_mfa_required = p_on, updated_by = (select auth.uid()), updated_at = now();
  perform private.log_action(case when p_on then 'mfa_required_on' else 'mfa_required_off' end, 'settings', 'mfa', null);
end;
$$;

-- Admin: end another person's sessions (stolen device, offboarding).
create function public.admin_revoke_sessions(p_user uuid)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare ok boolean;
begin
  perform private.require_role('admin');
  ok := private.revoke_sessions(p_user);
  perform private.log_action('sessions_revoked', 'user', p_user::text, null, jsonb_build_object('done', ok));
  return ok;
end;
$$;

-- Which privileged accounts still need MFA (for the switch-over checklist).
create function public.admin_mfa_readiness()
returns table (user_id uuid, roles text[], has_factor boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
  select r.user_id, array_agg(r.role order by r.role), private.has_verified_factor(r.user_id)
  from private.user_roles r group by r.user_id;
end;
$$;

revoke execute on function public.my_security_status() from public, anon;
revoke execute on function public.mfa_generate_recovery_codes() from public, anon;
revoke execute on function public.mfa_use_recovery_code(text) from public, anon;
revoke execute on function public.admin_set_mfa_required(boolean) from public, anon;
revoke execute on function public.admin_revoke_sessions(uuid) from public, anon;
revoke execute on function public.admin_mfa_readiness() from public, anon;
grant execute on function public.my_security_status() to authenticated;
grant execute on function public.mfa_generate_recovery_codes() to authenticated;
grant execute on function public.mfa_use_recovery_code(text) to authenticated;
grant execute on function public.admin_set_mfa_required(boolean) to authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to authenticated;
grant execute on function public.admin_mfa_readiness() to authenticated;
