-- Google Play purchase recording (docs/PLAY_BILLING_IMPLEMENTATION.md). Sandbox only. Append-only.
--
-- The API verifies every purchase token with the Google Play Developer API (server-only service account), then calls
-- these functions with the 'play_billing' integration secret, the way LiveKit webhooks work: members never write
-- purchases, wallet credits or entitlements. Only a one-way fingerprint of the purchase token is stored.
--
-- Fail closed:
--   * billing_settings.sandbox_enabled (admin) must be on, the product must be enabled, the purchase must be a Google
--     Play test purchase (license tester) and the member a tester account;
--   * real purchases are refused: financial_flags.token_purchases stays locked off (purchases_off constraint) and
--     billing_settings.live_enabled is locked off here as well.
-- Refunds/voids create compensating ledger entries; a shortfall (tokens already spent) is recorded for review and the
-- balance never goes negative.

alter table private.integration_secrets drop constraint integration_secrets_name_check;
alter table private.integration_secrets add constraint integration_secrets_name_check
  check (name in ('livekit_webhook', 'play_billing'));

alter table public.token_ledger drop constraint token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check check (reason in (
  'registration_bonus', 'like', 'message', 'voice_call', 'video_call', 'admin_adjustment', 'refund',
  'booking_hold', 'booking_refund', 'sandbox_grant', 'token_purchase', 'purchase_reversal'));

create table public.billing_settings (
  id smallint primary key default 1 check (id = 1),
  sandbox_enabled boolean not null default false,
  live_enabled boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint live_billing_off check (not live_enabled)
);
insert into public.billing_settings (id) values (1);
alter table public.billing_settings enable row level security;
revoke all on public.billing_settings from anon, authenticated;
grant select on public.billing_settings to authenticated;
create policy "billing settings readable" on public.billing_settings for select to authenticated using (true);

-- Store product ids mapped to internal products. Token quantities come from token_package_catalog (snapshotted on
-- every purchase); subscriptions map to an entitlement plan. Disabled until an admin enables them for the sandbox.
create table public.store_products (
  product_id text primary key check (product_id ~ '^[a-z0-9][a-z0-9_.]{2,98}$'),
  provider text not null default 'google_play' check (provider in ('google_play')),
  kind text not null check (kind in ('token_package', 'subscription')),
  catalog_sku text references public.token_package_catalog (sku),
  plan_key text check (plan_key in ('monthly')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint kind_target check ((kind = 'token_package') = (catalog_sku is not null)
                                and (kind = 'subscription') = (plan_key is not null))
);
insert into public.store_products (product_id, kind, catalog_sku, plan_key) values
  ('rentmate_tokens_50', 'token_package', 'planning_50', null),
  ('rentmate_tokens_100', 'token_package', 'planning_100', null),
  ('rentmate_tokens_250', 'token_package', 'planning_250', null),
  ('rentmate_tokens_500', 'token_package', 'planning_500', null),
  ('rentmate_monthly', 'subscription', null, 'monthly');
alter table public.store_products enable row level security;
revoke all on public.store_products from anon, authenticated;
grant select on public.store_products to authenticated;
create policy "store products readable" on public.store_products for select to authenticated using (true);

create table public.store_purchases (
  id bigint generated always as identity primary key,
  provider text not null default 'google_play',
  product_id text not null references public.store_products (product_id),
  kind text not null,
  user_id uuid not null,                          -- no foreign key: kept for accounting after account deletion
  token_fingerprint text not null unique check (token_fingerprint ~ '^[0-9a-f]{64}$'),
  order_id text check (char_length(order_id) <= 100),
  test_purchase boolean not null,
  quantity int not null default 1 check (quantity between 1 and 10),
  catalog_sku text,
  catalog_token_quantity int,
  catalog_price_inr_paise int,
  tokens_granted bigint not null default 0 check (tokens_granted >= 0),
  ledger_entry bigint,
  status text not null check (status in ('credited', 'entitled', 'revoked', 'revoked_shortfall')),
  acknowledged_at timestamptz,
  consumed_at timestamptz,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index store_purchases_user on public.store_purchases (user_id, created_at desc);
alter table public.store_purchases enable row level security;
revoke all on public.store_purchases from anon, authenticated;
-- Members see their own purchases, never the purchase-token fingerprint.
grant select (id, product_id, kind, user_id, order_id, test_purchase, quantity, catalog_sku, catalog_token_quantity,
  catalog_price_inr_paise, tokens_granted, status, acknowledged_at, consumed_at, purchased_at, created_at)
  on public.store_purchases to authenticated;
create policy "purchases read own" on public.store_purchases for select to authenticated
  using (user_id = (select auth.uid()));

create table public.store_purchase_events (
  id bigint generated always as identity primary key,
  purchase_id bigint references public.store_purchases (id),
  token_fingerprint text not null,
  event text not null check (event in ('credited', 'entitled', 'replayed', 'refused', 'token_reused', 'acknowledged',
                                       'consumed', 'revoked', 'revoked_shortfall', 'subscription_updated')),
  detail text check (char_length(detail) <= 300),
  created_at timestamptz not null default now()
);
alter table public.store_purchase_events enable row level security;
revoke all on public.store_purchase_events from anon, authenticated;
create trigger append_only before update or delete on public.store_purchase_events
  for each row execute function private.accounting_append_only();

create table private.rtdn_messages (
  message_id text primary key check (char_length(message_id) between 1 and 200),
  received_at timestamptz not null default now()
);

create function private.purchase_event(p_purchase bigint, p_fp text, p_event text, p_detail text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.store_purchase_events (purchase_id, token_fingerprint, event, detail)
  values (p_purchase, p_fp, p_event, left(p_detail, 300));
$$;
revoke execute on function private.purchase_event(bigint, text, text, text) from public, anon, authenticated;

-- Records one verified Google Play purchase. The API has already checked the token with Google; p_state is Google's
-- purchaseState (0 purchased, 1 cancelled, 2 pending) or, for subscriptions, the entitlement status it derived.
-- Returns {"outcome": ..., "tokens": n}. Idempotent per purchase token fingerprint.
create function public.billing_record_play_purchase(
  p_secret text, p_user uuid, p_product text, p_fingerprint text, p_order text, p_state text, p_test boolean,
  p_quantity int, p_purchased_at timestamptz, p_period_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prod public.store_products;
  cat public.token_package_catalog;
  prior public.store_purchases;
  pid bigint;
  tokens bigint;
  entry bigint;
begin
  if not private.integration_secret_ok('play_billing', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_user is null then
    raise exception 'Invalid purchase.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('store_purchase:' || p_fingerprint, 0));
  select * into prior from public.store_purchases where token_fingerprint = p_fingerprint;
  if prior.id is not null then
    if prior.user_id <> p_user then
      perform private.purchase_event(prior.id, p_fingerprint, 'token_reused', 'presented by another account');
      perform private.log_action('purchase_token_reused', 'user', p_user::text, null);
      return jsonb_build_object('outcome', 'token_reused', 'tokens', 0);
    end if;
    if prior.kind = 'subscription' and p_state in ('active', 'grace', 'expired', 'revoked') then
      -- Losing access always applies; renewing it needs the sandbox on and a revoked entitlement stays revoked.
      if p_state in ('active', 'grace') and (prior.status = 'revoked'
          or not coalesce((select sandbox_enabled from public.billing_settings where id = 1), false)) then
        perform private.purchase_event(prior.id, p_fingerprint, 'refused', 'renewal not applied: ' || prior.status);
        return jsonb_build_object('outcome', 'not_applied', 'status', prior.status, 'tokens', 0);
      end if;
      update public.subscription_entitlements
         set status = p_state, current_period_end = coalesce(p_period_end, current_period_end), updated_at = now(),
             verified_at = now()
       where provider = 'google_play' and provider_purchase_id = p_fingerprint;
      perform private.purchase_event(prior.id, p_fingerprint, 'subscription_updated', p_state);
      return jsonb_build_object('outcome', 'subscription_updated', 'status', p_state, 'tokens', 0);
    end if;
    perform private.purchase_event(prior.id, p_fingerprint, 'replayed', null);
    return jsonb_build_object('outcome', 'already_recorded', 'status', prior.status, 'tokens', prior.tokens_granted);
  end if;

  select * into prod from public.store_products where product_id = p_product;
  if prod.product_id is null or not prod.enabled then
    perform private.purchase_event(null, p_fingerprint, 'refused', 'product not enabled: ' || coalesce(p_product, ''));
    return jsonb_build_object('outcome', 'product_not_enabled', 'tokens', 0);
  end if;
  if not coalesce((select sandbox_enabled from public.billing_settings where id = 1), false) then
    perform private.purchase_event(null, p_fingerprint, 'refused', 'billing sandbox off');
    return jsonb_build_object('outcome', 'billing_disabled', 'tokens', 0);
  end if;
  -- Real purchases stay refused until live billing is approved (financial_flags.token_purchases is locked off).
  if not coalesce(p_test, false) or (select token_purchases from public.financial_flags where id = 1) then
    perform private.purchase_event(null, p_fingerprint, 'refused', 'not a test purchase');
    return jsonb_build_object('outcome', 'live_purchases_disabled', 'tokens', 0);
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.is_tester and not p.is_demo) then
    perform private.purchase_event(null, p_fingerprint, 'refused', 'not a tester account');
    return jsonb_build_object('outcome', 'not_a_tester', 'tokens', 0);
  end if;

  if prod.kind = 'token_package' then
    if p_state is distinct from 'purchased' then
      return jsonb_build_object('outcome', 'not_purchased', 'state', p_state, 'tokens', 0); -- pending/cancelled
    end if;
    select * into cat from public.token_package_catalog where sku = prod.catalog_sku;
    tokens := cat.token_quantity::bigint * greatest(coalesce(p_quantity, 1), 1);
    insert into public.store_purchases (product_id, kind, user_id, token_fingerprint, order_id, test_purchase, quantity,
      catalog_sku, catalog_token_quantity, catalog_price_inr_paise, tokens_granted, status, purchased_at)
    values (prod.product_id, prod.kind, p_user, p_fingerprint, left(p_order, 100), true, greatest(coalesce(p_quantity, 1), 1),
      cat.sku, cat.token_quantity, cat.price_inr_paise, tokens, 'credited', p_purchased_at)
    returning id into pid;
    entry := private.ledger_post(p_user, tokens, 'token_purchase', 'store_purchase', pid::text, 'store_purchase:' || p_fingerprint);
    update public.store_purchases set ledger_entry = entry where id = pid;
    perform private.purchase_event(pid, p_fingerprint, 'credited', tokens || ' tokens (test purchase)');
    return jsonb_build_object('outcome', 'credited', 'tokens', tokens, 'balance',
                              (select balance from public.token_wallets where user_id = p_user));
  end if;

  -- Subscription: entitlement only from verified Play state.
  if p_state not in ('active', 'grace') or p_period_end is null or p_period_end <= now() then
    return jsonb_build_object('outcome', 'not_entitled', 'state', p_state, 'tokens', 0);
  end if;
  insert into public.store_purchases (product_id, kind, user_id, token_fingerprint, order_id, test_purchase, status,
    purchased_at)
  values (prod.product_id, prod.kind, p_user, p_fingerprint, left(p_order, 100), true, 'entitled', p_purchased_at)
  returning id into pid;
  insert into public.subscription_entitlements (user_id, plan_key, status, provider, provider_purchase_id,
    current_period_start, current_period_end, verified_at)
  values (p_user, prod.plan_key, p_state, 'google_play', p_fingerprint, coalesce(p_purchased_at, now()), p_period_end,
    now());
  perform private.purchase_event(pid, p_fingerprint, 'entitled', p_state || ' until ' || p_period_end);
  return jsonb_build_object('outcome', 'entitled', 'status', p_state, 'tokens', 0);
end;
$$;

-- Records that the API acknowledged (and for token packages consumed) the purchase with Google. Retry-safe.
create function public.billing_mark_completed(p_secret text, p_fingerprint text, p_consumed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare p public.store_purchases;
begin
  if not private.integration_secret_ok('play_billing', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.store_purchases
     set acknowledged_at = coalesce(acknowledged_at, now()),
         consumed_at = case when p_consumed then coalesce(consumed_at, now()) else consumed_at end,
         updated_at = now()
   where token_fingerprint = p_fingerprint
  returning * into p;
  if p.id is not null then
    perform private.purchase_event(p.id, p_fingerprint, case when p_consumed then 'consumed' else 'acknowledged' end, null);
  end if;
end;
$$;

-- Refund, void or revocation reported by Google (after the API re-fetched the purchase). Compensating entries only.
create function public.billing_revoke_play_purchase(p_secret text, p_fingerprint text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.store_purchases;
  bal bigint;
  back bigint;
  entry bigint;
begin
  if not private.integration_secret_ok('play_billing', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select * into p from public.store_purchases where token_fingerprint = p_fingerprint for update;
  if p.id is null then return jsonb_build_object('outcome', 'unknown_purchase'); end if;
  if p.status in ('revoked', 'revoked_shortfall') then return jsonb_build_object('outcome', 'already_revoked'); end if;
  if p.kind = 'subscription' then
    update public.subscription_entitlements set status = 'revoked', updated_at = now()
    where provider = 'google_play' and provider_purchase_id = p_fingerprint;
    update public.store_purchases set status = 'revoked', updated_at = now() where id = p.id;
    perform private.purchase_event(p.id, p_fingerprint, 'revoked', p_reason);
    return jsonb_build_object('outcome', 'revoked');
  end if;
  bal := coalesce((select balance from public.token_wallets where user_id = p.user_id), 0);
  back := least(bal, p.tokens_granted);
  if back > 0 then
    entry := private.ledger_post(p.user_id, -back, 'purchase_reversal', 'store_purchase', p.id::text,
                                 'purchase_reversal:' || p_fingerprint);
  end if;
  update public.store_purchases set status = case when back < p.tokens_granted then 'revoked_shortfall' else 'revoked' end,
    updated_at = now() where id = p.id;
  perform private.purchase_event(p.id, p_fingerprint, case when back < p.tokens_granted then 'revoked_shortfall' else 'revoked' end,
    coalesce(p_reason, '') || ' reversed ' || back || ' of ' || p.tokens_granted);
  if back < p.tokens_granted then
    perform private.log_action('purchase_reversal_shortfall', 'user', p.user_id::text, p_reason,
      jsonb_build_object('granted', p.tokens_granted, 'reversed', back));
  end if;
  return jsonb_build_object('outcome', case when back < p.tokens_granted then 'revoked_shortfall' else 'revoked' end,
                            'reversed', back);
end;
$$;

-- RTDN deduplication: true the first time a Pub/Sub message id is seen.
create function public.billing_rtdn_first_seen(p_secret text, p_message_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.integration_secret_ok('play_billing', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  insert into private.rtdn_messages (message_id) values (p_message_id) on conflict do nothing;
  return found;
end;
$$;

-- RTDN names a purchase token; the API needs to know which member and product it belongs to before re-fetching it.
create function public.billing_purchase_by_fingerprint(p_secret text, p_fingerprint text)
returns table (user_id uuid, product_id text, kind text, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.integration_secret_ok('play_billing', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query select p.user_id, p.product_id, p.kind, p.status from public.store_purchases p
  where p.token_fingerprint = p_fingerprint;
end;
$$;

revoke execute on function public.billing_record_play_purchase(text, uuid, text, text, text, text, boolean, int, timestamptz, timestamptz) from public;
revoke execute on function public.billing_mark_completed(text, text, boolean) from public;
revoke execute on function public.billing_revoke_play_purchase(text, text, text) from public;
revoke execute on function public.billing_rtdn_first_seen(text, text) from public;
revoke execute on function public.billing_purchase_by_fingerprint(text, text) from public;
-- The API calls these with the publishable key (it holds no privileged database key); the secret is the guard.
grant execute on function public.billing_record_play_purchase(text, uuid, text, text, text, text, boolean, int, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.billing_mark_completed(text, text, boolean) to anon, authenticated;
grant execute on function public.billing_revoke_play_purchase(text, text, text) to anon, authenticated;
grant execute on function public.billing_rtdn_first_seen(text, text) to anon, authenticated;
grant execute on function public.billing_purchase_by_fingerprint(text, text) to anon, authenticated;

-- Admin: sandbox switch and per-product enablement (logged).
create function public.admin_set_billing_sandbox(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  update public.billing_settings set sandbox_enabled = p_enabled, updated_by = (select auth.uid()), updated_at = now()
  where id = 1;
  perform private.log_action(case when p_enabled then 'billing_sandbox_on' else 'billing_sandbox_off' end,
    'settings', 'billing', null);
end;
$$;

create function public.admin_set_store_product_enabled(p_product text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  update public.store_products set enabled = p_enabled, updated_at = now() where product_id = p_product;
  if not found then raise exception 'Unknown product.' using errcode = 'P0001'; end if;
  perform private.log_action(case when p_enabled then 'store_product_enabled' else 'store_product_disabled' end,
    'store_product', p_product, null);
end;
$$;
revoke execute on function public.admin_set_billing_sandbox(boolean) from public, anon;
revoke execute on function public.admin_set_store_product_enabled(text, boolean) from public, anon;
grant execute on function public.admin_set_billing_sandbox(boolean) to authenticated;
grant execute on function public.admin_set_store_product_enabled(text, boolean) to authenticated;
