-- Admin-managed payment account registry for RentMate token purchases.
-- Stores merchant configuration metadata only. Provider secrets are never stored here.
-- No payment capture, QR issuance, or token credit is enabled by this migration.

create table public.payment_provider_accounts (
  id uuid primary key default gen_random_uuid(),
  payment_method text not null check (payment_method in ('card', 'upi')),
  provider_key text not null check (provider_key in ('razorpay', 'cashfree', 'payu', 'upi_psp')),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  merchant_reference text not null check (char_length(btrim(merchant_reference)) between 2 and 120),
  environment text not null default 'test' check (environment in ('test', 'live')),
  currency text not null default 'INR' check (currency = 'INR'),
  priority integer not null default 100 check (priority between 1 and 10000),
  min_amount_paise bigint not null default 100 check (min_amount_paise > 0),
  max_amount_paise bigint not null default 10000000 check (max_amount_paise >= min_amount_paise),
  upi_vpa text,
  dynamic_qr_supported boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'test_pending', 'active', 'paused', 'disabled')),
  secret_reference text,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status in ('passed', 'failed')),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_account_method_config check (
    (
      payment_method = 'upi'
      and upi_vpa is not null
      and upi_vpa ~ '^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$'
      and char_length(split_part(upi_vpa, '@', 1)) between 2 and 255
      and char_length(split_part(upi_vpa, '@', 2)) between 2 and 64
    )
    or (payment_method = 'card' and upi_vpa is null)
  )
);

create index payment_provider_accounts_routing_idx
  on public.payment_provider_accounts(payment_method, environment, status, priority);

alter table public.payment_provider_accounts enable row level security;
revoke all on public.payment_provider_accounts from anon, authenticated;
grant select on public.payment_provider_accounts to authenticated;

create policy "admins read payment account metadata"
  on public.payment_provider_accounts for select to authenticated
  using (private.has_role('admin'));

create function public.admin_list_payment_accounts()
returns table (
  id uuid,
  payment_method text,
  provider_key text,
  display_name text,
  merchant_reference text,
  environment text,
  currency text,
  priority integer,
  min_amount_paise bigint,
  max_amount_paise bigint,
  upi_vpa text,
  dynamic_qr_supported boolean,
  status text,
  last_tested_at timestamptz,
  last_test_status text,
  secret_configured boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');

  return query
    select
      a.id,
      a.payment_method,
      a.provider_key,
      a.display_name,
      a.merchant_reference,
      a.environment,
      a.currency,
      a.priority,
      a.min_amount_paise,
      a.max_amount_paise,
      a.upi_vpa,
      a.dynamic_qr_supported,
      a.status,
      a.last_tested_at,
      a.last_test_status,
      (a.secret_reference is not null)
    from public.payment_provider_accounts a
    order by a.payment_method, a.priority, a.created_at;
end;
$$;

create function public.admin_upsert_payment_account(
  p_id uuid,
  p_payment_method text,
  p_provider_key text,
  p_display_name text,
  p_merchant_reference text,
  p_environment text,
  p_priority integer,
  p_min_amount_paise bigint,
  p_max_amount_paise bigint,
  p_upi_vpa text,
  p_dynamic_qr_supported boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  result_id uuid;
begin
  perform private.require_role('admin');

  if p_payment_method not in ('card', 'upi')
    or p_provider_key not in ('razorpay', 'cashfree', 'payu', 'upi_psp')
    or p_environment not in ('test', 'live')
    or p_priority not between 1 and 10000
    or p_min_amount_paise <= 0
    or p_max_amount_paise < p_min_amount_paise
    or char_length(btrim(coalesce(p_display_name, ''))) not between 2 and 80
    or char_length(btrim(coalesce(p_merchant_reference, ''))) not between 2 and 120
    or (
      p_payment_method = 'upi'
      and (
        coalesce(p_upi_vpa, '') !~ '^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$'
        or char_length(split_part(coalesce(p_upi_vpa, ''), '@', 1)) not between 2 and 255
        or char_length(split_part(coalesce(p_upi_vpa, ''), '@', 2)) not between 2 and 64
      )
    )
    or (p_payment_method = 'card' and p_upi_vpa is not null)
    or (p_payment_method = 'card' and p_provider_key = 'upi_psp')
    or (p_payment_method = 'upi' and p_provider_key not in ('razorpay', 'cashfree', 'upi_psp'))
  then
    raise exception 'Invalid payment account configuration.' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.payment_provider_accounts (
      payment_method,
      provider_key,
      display_name,
      merchant_reference,
      environment,
      priority,
      min_amount_paise,
      max_amount_paise,
      upi_vpa,
      dynamic_qr_supported,
      created_by,
      updated_by
    )
    values (
      p_payment_method,
      p_provider_key,
      btrim(p_display_name),
      btrim(p_merchant_reference),
      p_environment,
      p_priority,
      p_min_amount_paise,
      p_max_amount_paise,
      nullif(btrim(p_upi_vpa), ''),
      coalesce(p_dynamic_qr_supported, false),
      me,
      me
    )
    returning id into result_id;
  else
    update public.payment_provider_accounts
    set
      payment_method = p_payment_method,
      provider_key = p_provider_key,
      display_name = btrim(p_display_name),
      merchant_reference = btrim(p_merchant_reference),
      environment = p_environment,
      priority = p_priority,
      min_amount_paise = p_min_amount_paise,
      max_amount_paise = p_max_amount_paise,
      upi_vpa = nullif(btrim(p_upi_vpa), ''),
      dynamic_qr_supported = coalesce(p_dynamic_qr_supported, false),
      status = case when status = 'active' then 'paused' else status end,
      updated_by = me,
      updated_at = now()
    where id = p_id
    returning id into result_id;

    if result_id is null then
      raise exception 'Payment account not found.' using errcode = 'P0002';
    end if;
  end if;

  perform private.log_action(
    'payment_account_saved',
    'payment_provider_account',
    result_id::text,
    'Payment account metadata changed; account requires connection testing before activation.',
    jsonb_build_object(
      'method', p_payment_method,
      'provider', p_provider_key,
      'environment', p_environment
    )
  );

  return result_id;
end;
$$;

create function public.admin_set_payment_account_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');

  if p_status not in ('paused', 'disabled', 'test_pending') then
    raise exception
      'Only pause, disable, or test-pending transitions are available until provider credentials are securely connected and tested.'
      using errcode = '22023';
  end if;

  update public.payment_provider_accounts
  set
    status = p_status,
    updated_by = (select auth.uid()),
    updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'Payment account not found.' using errcode = 'P0002';
  end if;

  perform private.log_action(
    'payment_account_status_changed',
    'payment_provider_account',
    p_id::text,
    p_status,
    jsonb_build_object('status', p_status)
  );
end;
$$;

revoke execute on function public.admin_list_payment_accounts() from public, anon;
revoke execute on function public.admin_upsert_payment_account(uuid, text, text, text, text, text, integer, bigint, bigint, text, boolean) from public, anon;
revoke execute on function public.admin_set_payment_account_status(uuid, text) from public, anon;

grant execute on function public.admin_list_payment_accounts() to authenticated;
grant execute on function public.admin_upsert_payment_account(uuid, text, text, text, text, text, integer, bigint, bigint, text, boolean) to authenticated;
grant execute on function public.admin_set_payment_account_status(uuid, text) to authenticated;
