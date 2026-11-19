-- Rollback for 20261121100000_admin_mfa.sql. NOT a migration. Founder approval and a backup first. Apply as a new,
-- timestamped forward migration, newest rollback first. Rehearsed by scripts/test-rollback.mjs.
-- Switch mandatory MFA off in the app before rolling back, so no admin is mid-recovery.

drop function if exists public.admin_mfa_readiness();
drop function if exists public.admin_revoke_sessions(uuid);
drop function if exists public.admin_set_mfa_required(boolean);
drop function if exists public.mfa_use_recovery_code(text);
drop function if exists public.mfa_generate_recovery_codes();
drop function if exists public.my_security_status();
drop trigger if exists revoke_sessions_on_role_removed on private.user_roles;
drop function if exists private.on_role_removed();
drop function if exists private.revoke_sessions(uuid, uuid);

-- Restore the role check from 20261101090000_live_foundation.sql (same function, so RLS policies follow it).
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
  );
$$;

drop function if exists private.mfa_satisfied();
drop function if exists private.has_verified_factor(uuid);
drop function if exists private.session_aal();
drop function if exists private.is_privileged(uuid);
drop table if exists private.mfa_recovery_grants;
drop table if exists private.mfa_recovery_attempts;
drop table if exists private.mfa_recovery_codes;
drop table if exists private.security_settings;
