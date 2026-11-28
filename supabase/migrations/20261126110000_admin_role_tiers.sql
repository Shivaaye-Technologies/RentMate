-- Staff role tiers: super_admin > master_admin > sub_admin > agent > member (no role). Append-only.
--
-- Existing roles keep their meaning and every existing check keeps working, because private.has_role compares ranks:
--   super_admin 50 | master_admin 40 = admin 40 (legacy) | sub_admin 30 = moderator 30 (legacy) | agent 20
-- has_role('admin') is true for master_admin and super_admin; has_role('moderator') also for sub_admin; the new
-- has_role('agent') is true for every staff tier. MFA (private.mfa_satisfied) still applies to all of them, and every
-- staff row counts as privileged for the MFA policy (private.is_privileged reads any user_roles row).
--
-- Granting a tier (admin_grant_staff_role): only roles ranked strictly below your own, to people ranked below you,
-- never yourself. super_admin is granted only by the database owner (SQL editor), never through the API.

alter table private.user_roles drop constraint user_roles_role_check;
alter table private.user_roles add constraint user_roles_role_check
  check (role in ('super_admin', 'master_admin', 'admin', 'sub_admin', 'moderator', 'agent'));

create function private.role_rank(p_role text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'super_admin' then 50
    when 'master_admin' then 40 when 'admin' then 40
    when 'sub_admin' then 30 when 'moderator' then 30
    when 'agent' then 20
    else 0 end;
$$;
revoke execute on function private.role_rank(text) from public;

create function private.rank_of(p_user uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(max(private.role_rank(r.role)), 0) from private.user_roles r where r.user_id = p_user; $$;
revoke execute on function private.rank_of(uuid) from public;

-- Same name, arguments and grants as before (RLS policies reference it directly).
create or replace function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.role_rank(p_role) > 0
     and private.rank_of((select auth.uid())) >= private.role_rank(p_role)
     and private.mfa_satisfied();
$$;

-- Granting a staff tier: only roles ranked strictly below your own, only to people ranked below you, never to
-- yourself. Insert-only on purpose: migrations here may not delete data (scripts/policy-check.mjs), so removing a
-- tier is done by the database owner until a reviewed migration adds it (see docs/RENTMATE_REMAINING_TASKS.md).
-- public.admin_set_role is unchanged and still grants and removes the legacy admin and moderator roles.
create function public.admin_grant_staff_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  mine int := private.rank_of((select auth.uid()));
begin
  if not private.has_role('sub_admin') then
    raise exception 'This needs a staff admin role' using errcode = '42501';
  end if;
  if p_role not in ('master_admin', 'sub_admin', 'agent') then
    raise exception 'Unknown staff role' using errcode = '22023';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'You cannot change your own roles' using errcode = '42501';
  end if;
  if private.role_rank(p_role) >= mine then
    raise exception 'You can only grant roles below your own' using errcode = '42501';
  end if;
  if private.rank_of(p_user) >= mine then
    raise exception 'You cannot change the roles of someone at or above your level' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'Unknown member' using errcode = 'P0001';
  end if;
  insert into private.user_roles (user_id, role, granted_by) values (p_user, p_role, (select auth.uid()))
  on conflict do nothing;
  perform private.log_action('role_granted', 'user', p_user::text, p_role);
end;
$$;
revoke execute on function public.admin_grant_staff_role(uuid, text) from public, anon;
grant execute on function public.admin_grant_staff_role(uuid, text) to authenticated;

-- Your roles plus the legacy capability names they imply, so existing admin screens (which look for 'admin' or
-- 'moderator') keep working for the new tiers.
create or replace function public.my_live_roles()
returns text[]
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select r.role from private.user_roles r where r.user_id = (select auth.uid())
    union select 'admin' where private.rank_of((select auth.uid())) >= 40
    union select 'moderator' where private.rank_of((select auth.uid())) >= 30
  )
  select coalesce(array_agg(role order by role), '{}') from mine;
$$;

-- Highest staff tier of the caller (null for members).
create function public.my_staff_tier()
returns text
language sql stable security definer set search_path = ''
as $$
  select case private.rank_of((select auth.uid()))
    when 50 then 'super_admin' when 40 then 'master_admin' when 30 then 'sub_admin' when 20 then 'agent' end;
$$;
revoke execute on function public.my_staff_tier() from public, anon;
grant execute on function public.my_staff_tier() to authenticated;

-- Staff directory for admins: who holds which role. No contact details.
create function public.admin_list_staff()
returns table (user_id uuid, role text, granted_by uuid, granted_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('sub_admin');
  return query select r.user_id, r.role, r.granted_by, r.granted_at from private.user_roles r
    order by private.role_rank(r.role) desc, r.granted_at;
end;
$$;
revoke execute on function public.admin_list_staff() from public, anon;
grant execute on function public.admin_list_staff() to authenticated;

-- Support agents triage member reports: category, time and linked booking only. They never see the reporter, the
-- free-text details or the reported person's profile; moderators (sub_admin and above) handle the case itself.
create function public.support_report_queue(p_limit int default 100)
returns table (id uuid, reason text, created_at timestamptz, booking_id uuid, has_details boolean, escalated boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('agent');
  return query
    select r.id, r.reason, r.created_at, r.booking_id, char_length(r.details) > 0,
           exists (select 1 from public.moderation_actions m
                   where m.action = 'report_escalated' and m.target_type = 'report' and m.target_id = r.id::text)
    from public.reports r
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke execute on function public.support_report_queue(int) from public, anon;
grant execute on function public.support_report_queue(int) to authenticated;

create function public.support_escalate_report(p_report uuid, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('agent');
  if not exists (select 1 from public.reports where id = p_report) then
    raise exception 'Unknown report' using errcode = 'P0001';
  end if;
  if char_length(coalesce(trim(p_note), '')) not between 5 and 500 then
    raise exception 'Add a note of 5 to 500 characters' using errcode = '22023';
  end if;
  perform private.log_action('report_escalated', 'report', p_report::text, trim(p_note));
end;
$$;
revoke execute on function public.support_escalate_report(uuid, text) from public, anon;
grant execute on function public.support_escalate_report(uuid, text) to authenticated;
