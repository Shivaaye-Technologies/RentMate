-- Server-side rolling rewind allowance. Rewind is the deletion of a member's own pass.
-- The usage row is append-only, so deleting/recreating a pass cannot reset the allowance.
-- Subscriber exemption is entitlement-based; no billing or purchase flow is enabled.

alter table public.discovery_action_usage
  drop constraint discovery_action_usage_action_check,
  add constraint discovery_action_usage_action_check
    check (action in ('like', 'dislike', 'rewind'));

create function private.enforce_rewind_allowance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := old.passer_id;
  v_limit integer;
  v_used bigint;
  v_subscriber boolean;
begin
  -- Trusted migrations/jobs and isolated fixtures without a member JWT do not
  -- consume a member allowance. Authenticated requests must act as the owner.
  if (select auth.uid()) is null then
    return old;
  end if;

  if v_user is null or v_user <> (select auth.uid()) then
    raise exception 'A member can only rewind their own pass.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  select private.has_active_subscription(v_user) into v_subscriber;

  select free_rewinds_per_24h
    into v_limit
    from public.metering_rates
   where id = 1;

  select count(*)
    into v_used
    from public.discovery_action_usage u
   where u.user_id = v_user
     and u.action = 'rewind'
     and u.created_at > now() - interval '24 hours';

  if not coalesce(v_subscriber, false) and v_used >= coalesce(v_limit, 0) then
    raise exception 'Daily rewind limit reached. Subscribe for unlimited rewinds.'
      using errcode = 'P0001';
  end if;

  if not coalesce(v_subscriber, false) then
    insert into public.discovery_action_usage(user_id, action)
    values (v_user, 'rewind');
  end if;

  return old;
end;
$$;

revoke execute on function private.enforce_rewind_allowance() from public, anon, authenticated;

create trigger enforce_rewind_allowance
  before delete on public.passes
  for each row execute function private.enforce_rewind_allowance();
