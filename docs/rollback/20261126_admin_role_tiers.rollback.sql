-- Rollback for 20261126110000_admin_role_tiers.sql. NOT a migration.
-- Refuses while anyone holds a new tier: remove or convert those roles first (e.g. master_admin -> admin,
-- sub_admin -> moderator) so nobody silently loses or keeps access.
do $$
begin
  if exists (select 1 from private.user_roles where role in ('super_admin', 'master_admin', 'sub_admin', 'agent')) then
    raise exception 'Staff tier roles are still assigned; convert or remove them first. Nothing was changed.';
  end if;
end $$;

drop function if exists public.support_escalate_report(uuid, text);
drop function if exists public.support_report_queue(int);
drop function if exists public.admin_list_staff();
drop function if exists public.my_staff_tier();
drop function if exists public.admin_grant_staff_role(uuid, text);

create or replace function public.my_live_roles()
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(role order by role), '{}')
  from private.user_roles where user_id = (select auth.uid());
$$;

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

drop function if exists private.rank_of(uuid);
drop function if exists private.role_rank(text);

alter table private.user_roles drop constraint user_roles_role_check;
alter table private.user_roles add constraint user_roles_role_check check (role in ('admin', 'moderator'));
