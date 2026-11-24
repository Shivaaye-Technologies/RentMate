-- RentMate entitlement and discovery allowance foundation.
-- No purchase, billing, cash redemption, creator payout, or booking settlement is enabled here.
-- Token SKUs are intentionally disabled until store/provider and legal gates are approved.

alter table public.metering_rates
  add column free_dislikes_per_24h integer not null default 15
    check (free_dislikes_per_24h between 0 and 10000),
  add column free_rewinds_per_24h integer not null default 3
    check (free_rewinds_per_24h between 0 and 10000);

-- Founder-approved rates. These are configuration only: call_metering_enabled and
-- allowances_enforced remain false until their complete server workflows ship.
update public.metering_rates
set voice_tokens_per_minute = 60,
    video_tokens_per_second = 5,
    free_likes_per_24h = 15,
    free_dislikes_per_24h = 15,
    free_rewinds_per_24h = 3,
    free_messages_per_24h = 0,
    allowances_enforced = false,
    call_metering_enabled = false,
    updated_at = now()
where id = 1;

create table public.subscription_entitlements (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_key text not null check (plan_key in ('monthly')),
  status text not null check (status in ('pending', 'active', 'grace', 'expired', 'revoked')),
  provider text not null check (provider in ('google_play', 'apple', 'admin')),
  provider_purchase_id text,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end > current_period_start),
  check ((status in ('active', 'grace')) = (verified_at is not null)),
  unique (provider, provider_purchase_id)
);
create index subscription_entitlements_user_period
  on public.subscription_entitlements(user_id, current_period_end desc);
alter table public.subscription_entitlements enable row level security;
revoke all on public.subscription_entitlements from anon, authenticated;
grant select on public.subscription_entitlements to authenticated;
grant all on public.subscription_entitlements to service_role;
create policy "members read own subscription entitlement"
  on public.subscription_entitlements for select to authenticated
  using (user_id = (select auth.uid()));

-- Catalog rows are planning SKUs only. The 500-token ceiling is enforced by a DB constraint;
-- enabled stays false until a separately reviewed billing release.
create table public.token_package_catalog (
  sku text primary key check (sku ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  token_quantity integer not null check (token_quantity between 1 and 500),
  price_inr_paise integer not null check (price_inr_paise > 0),
  enabled boolean not null default false check (not enabled),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.token_package_catalog enable row level security;
revoke all on public.token_package_catalog from anon, authenticated;
grant select on public.token_package_catalog to authenticated;
create policy "authenticated can read disabled token package catalog"
  on public.token_package_catalog for select to authenticated using (true);

insert into public.token_package_catalog (sku, token_quantity, price_inr_paise)
values
  ('planning_50', 50, 100000),
  ('planning_100', 100, 180000),
  ('planning_250', 250, 425000),
  ('planning_500', 500, 750000);

-- Discovery actions are recorded server-side by table triggers, so direct client INSERTs
-- cannot bypass free-tier quotas. Subscriber status never bypasses safety/abuse controls.
create table public.discovery_action_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('like', 'dislike')),
  created_at timestamptz not null default now()
);
create index discovery_action_usage_user_action_time
  on public.discovery_action_usage(user_id, action, created_at desc);
alter table public.discovery_action_usage enable row level security;
revoke all on public.discovery_action_usage from anon, authenticated;
grant select on public.discovery_action_usage to authenticated;
create policy "members read own discovery usage"
  on public.discovery_action_usage for select to authenticated
  using (user_id = (select auth.uid()));

create function private.has_active_subscription(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscription_entitlements s
    where s.user_id = p_user
      and s.status in ('active', 'grace')
      and s.verified_at is not null
      and s.current_period_start <= now()
      and s.current_period_end > now()
  );
$$;
revoke execute on function private.has_active_subscription(uuid) from public, anon, authenticated;

create function private.enforce_discovery_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_action text;
  v_limit integer;
  v_used bigint;
  v_subscriber boolean;
begin
  if tg_table_name = 'likes' then
    v_user := new.liker_id;
    v_action := 'like';
  elsif tg_table_name = 'passes' then
    v_user := new.passer_id;
    v_action := 'dislike';
  else
    raise exception 'Unsupported discovery action table.' using errcode = '22023';
  end if;

  if v_user is null or (select auth.uid()) is null or v_user <> (select auth.uid()) then
    raise exception 'Discovery action must belong to the signed-in member.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  select private.has_active_subscription(v_user) into v_subscriber;

  if v_action = 'like' then
    select free_likes_per_24h into v_limit from public.metering_rates where id = 1;
  else
    select free_dislikes_per_24h into v_limit from public.metering_rates where id = 1;
  end if;

  select count(*) into v_used
  from public.discovery_action_usage u
  where u.user_id = v_user
    and u.action = v_action
    and u.created_at > now() - interval '24 hours';

  if not coalesce(v_subscriber, false) and v_used >= coalesce(v_limit, 0) then
    raise exception 'Daily % limit reached. Subscribe for unlimited discovery actions.', v_action
      using errcode = 'P0001';
  end if;

  insert into public.discovery_action_usage(user_id, action)
  values (v_user, v_action);
  return new;
end;
$$;
revoke execute on function private.enforce_discovery_action() from public, anon, authenticated;

create trigger enforce_like_allowance
  before insert on public.likes
  for each row execute function private.enforce_discovery_action();
create trigger enforce_dislike_allowance
  before insert on public.passes
  for each row execute function private.enforce_discovery_action();

-- Client-readable, caller-scoped entitlement snapshot. No client can create or extend a subscription.
create function public.my_subscription_entitlement()
returns table (
  is_subscriber boolean,
  plan_key text,
  status text,
  current_period_end timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(s.status in ('active', 'grace') and s.verified_at is not null
      and s.current_period_start <= now() and s.current_period_end > now(), false),
    s.plan_key,
    s.status,
    s.current_period_end
  from (select (select auth.uid()) as user_id) me
  left join lateral (
    select e.plan_key, e.status, e.verified_at, e.current_period_start, e.current_period_end
    from public.subscription_entitlements e
    where e.user_id = me.user_id
    order by e.current_period_end desc
    limit 1
  ) s on true
  where me.user_id is not null;
$$;
revoke execute on function public.my_subscription_entitlement() from public, anon;
grant execute on function public.my_subscription_entitlement() to authenticated;
