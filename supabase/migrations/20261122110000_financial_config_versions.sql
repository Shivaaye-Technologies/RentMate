-- Versioned token pricing and jurisdiction-specific tax configuration.
-- Configuration changes require a proposer and a different admin approver.
-- This migration does not enable token purchases, deposits, withdrawals or payouts.

create table public.financial_config_versions (
  id uuid primary key default gen_random_uuid(),
  config_type text not null check (config_type in ('token_pricing', 'tax_rule')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  effective_at timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index financial_config_versions_effective_idx
  on public.financial_config_versions(config_type, effective_at desc, created_at desc);

create table public.financial_config_approvals (
  id bigint generated always as identity primary key,
  config_id uuid not null references public.financial_config_versions(id),
  approver_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved', 'rejected')),
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  unique(config_id, approver_id),
  unique(config_id)
);

alter table public.financial_config_versions enable row level security;
alter table public.financial_config_approvals enable row level security;
revoke all on public.financial_config_versions, public.financial_config_approvals from public, anon, authenticated;

-- Proposed configuration and approvals are immutable. Corrections are new versions.
create function private.financial_config_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial configuration history is immutable; create a new version.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_config_immutable() from public;
create trigger financial_config_versions_immutable
  before update or delete on public.financial_config_versions
  for each row execute function private.financial_config_immutable();
create trigger financial_config_approvals_immutable
  before update or delete on public.financial_config_approvals
  for each row execute function private.financial_config_immutable();

create function public.admin_propose_financial_config(
  p_config_type text,
  p_payload jsonb,
  p_effective_at timestamptz,
  p_reason text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  result_id uuid;
  item jsonb;
begin
  perform private.require_role('admin');
  if p_config_type is null or p_config_type not in ('token_pricing', 'tax_rule')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_effective_at is null or p_effective_at < now()
    or char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000
  then
    raise exception 'Invalid financial configuration proposal.' using errcode = '22023';
  end if;

  if p_config_type = 'token_pricing' then
    if coalesce(p_payload->>'currency', '') !~ '^[A-Z]{3}$'
      or jsonb_typeof(p_payload->'packages') is distinct from 'array'
    then
      raise exception 'Token pricing requires a currency and at least one package.' using errcode = '22023';
    end if;
    if jsonb_array_length(p_payload->'packages') = 0 then
      raise exception 'Token pricing requires at least one package.' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(p_payload->'packages')
    loop
      if jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item->'code') is distinct from 'string'
        or jsonb_typeof(item->'tokens') is distinct from 'number'
        or jsonb_typeof(item->'price_paise') is distinct from 'number'
        or (item ? 'bonus_tokens' and jsonb_typeof(item->'bonus_tokens') is distinct from 'number')
        or coalesce(item->>'code', '') !~ '^[A-Za-z0-9_-]{2,40}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(p_payload->'tax_inclusive') is distinct from 'boolean' then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p_payload->'country_code') is distinct from 'string'
      or jsonb_typeof(p_payload->'tax_category') is distinct from 'string'
      or jsonb_typeof(p_payload->'tax_name') is distinct from 'string'
      or jsonb_typeof(p_payload->'rate_bps') is distinct from 'number'
      or jsonb_typeof(p_payload->'treatment') is distinct from 'string'
      or coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and (jsonb_typeof(p_payload->'state_code') is distinct from 'string'
      or char_length(p_payload->>'state_code') > 16) then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'tokens', '') !~ '^[1-9][0-9]{0,8}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'price_paise', '') !~ '^[1-9][0-9]{0,11}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'bonus_tokens', '0') !~ '^[0-9]{1,9}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'tokens', '') !~ '^[1-9][0-9]{0,8}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'price_paise', '') !~ '^[1-9][0-9]{0,11}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'bonus_tokens', '0') !~ '^[0-9]{1,9}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'tokens', '') !~ '^[1-9][0-9]{0,8}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'price_paise', '') !~ '^[1-9][0-9]{0,11}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

        or coalesce(item->>'bonus_tokens', '0') !~ '^[0-9]{1,9}
      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;

      then
        raise exception 'Each package needs a valid code, token quantity, price in paise and bonus token quantity.' using errcode = '22023';
      end if;
    end loop;
    if coalesce(p_payload->>'tax_inclusive', '') not in ('true', 'false') then
      raise exception 'Token pricing must explicitly declare tax_inclusive.' using errcode = '22023';
    end if;
  else
    if coalesce(p_payload->>'country_code', '') !~ '^[A-Z]{2}$'
      or coalesce(p_payload->>'tax_category', '') = ''
      or coalesce(p_payload->>'tax_name', '') = ''
      or coalesce(p_payload->>'rate_bps', '') !~ '^[0-9]{1,6}$'
      or (p_payload->>'rate_bps')::integer > 100000
      or coalesce(p_payload->>'treatment', '') not in ('inclusive', 'exclusive')
    then
      raise exception 'Tax rules require jurisdiction, category, name, explicit rate and inclusive/exclusive treatment.' using errcode = '22023';
    end if;
    if p_payload ? 'state_code' and char_length(p_payload->>'state_code') > 16 then
      raise exception 'Invalid state or province code.' using errcode = '22023';
    end if;
  end if;

  insert into public.financial_config_versions(config_type, payload, effective_at, reason, created_by)
  values (p_config_type, p_payload, p_effective_at, btrim(p_reason), me)
  returning id into result_id;

  perform private.log_action(
    'financial_config_proposed', 'financial_config_version', result_id::text,
    'Financial configuration proposed; awaiting approval from a different administrator.',
    jsonb_build_object('config_type', p_config_type, 'effective_at', p_effective_at)
  );
  return result_id;
end;
$$;

create function public.admin_approve_financial_config(p_config_id uuid, p_decision text default 'approved', p_note text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  proposer uuid;
  config_kind text;
begin
  perform private.require_role('admin');
  if p_decision not in ('approved', 'rejected')
    or (p_note is not null and char_length(p_note) > 1000)
  then
    raise exception 'Invalid approval decision.' using errcode = '22023';
  end if;

  select created_by, config_type into proposer, config_kind
  from public.financial_config_versions where id = p_config_id;
  if proposer is null then
    raise exception 'Financial configuration not found.' using errcode = 'P0002';
  end if;
  if proposer = (select auth.uid()) then
    raise exception 'A different administrator must approve this change.' using errcode = '42501';
  end if;
  if exists (select 1 from public.financial_config_approvals where config_id = p_config_id) then
    raise exception 'This configuration already has a decision.' using errcode = '23505';
  end if;

  insert into public.financial_config_approvals(config_id, approver_id, decision, note)
  values (p_config_id, (select auth.uid()), p_decision, nullif(btrim(p_note), ''));

  perform private.log_action(
    'financial_config_' || p_decision, 'financial_config_version', p_config_id::text,
    coalesce(nullif(btrim(p_note), ''), 'Financial configuration decision recorded.'),
    jsonb_build_object('config_type', config_kind, 'decision', p_decision)
  );
end;
$$;

create function public.admin_list_financial_configs()
returns table (
  id uuid, config_type text, payload jsonb, effective_at timestamptz, reason text,
  created_by uuid, created_at timestamptz, approval_count bigint, approver_id uuid,
  decision text, status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query
    select c.id, c.config_type, c.payload, c.effective_at, c.reason, c.created_by, c.created_at,
      count(a.id), max(a.approver_id::text)::uuid, max(a.decision),
      case
        when max(a.decision) = 'rejected' then 'rejected'
        when count(a.id) = 0 then 'awaiting_approval'
        when c.effective_at > now() then 'scheduled'
        else 'active'
      end
    from public.financial_config_versions c
    left join public.financial_config_approvals a on a.config_id = c.id
    group by c.id
    order by c.created_at desc;
end;
$$;

-- Immutable calculation snapshot for future purchase/refund integrations.
-- It is intentionally not writable by browser roles. Purchase flows remain disabled.
create table public.financial_transaction_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  source_type text not null check (source_type in ('token_purchase', 'refund', 'earning', 'adjustment')),
  source_reference text not null check (char_length(source_reference) between 1 and 160),
  pricing_config_id uuid references public.financial_config_versions(id),
  tax_config_id uuid references public.financial_config_versions(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  token_quantity bigint check (token_quantity is null or token_quantity >= 0),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  pricing_snapshot jsonb not null,
  tax_snapshot jsonb not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now()
);
alter table public.financial_transaction_snapshots enable row level security;
revoke all on public.financial_transaction_snapshots from public, anon, authenticated;

create function private.financial_snapshot_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Financial transaction snapshots are immutable.' using errcode = '42501';
end;
$$;
revoke execute on function private.financial_snapshot_immutable() from public;
create trigger financial_transaction_snapshots_immutable
  before update or delete on public.financial_transaction_snapshots
  for each row execute function private.financial_snapshot_immutable();

revoke execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) from public, anon;
revoke execute on function public.admin_approve_financial_config(uuid,text,text) from public, anon;
revoke execute on function public.admin_list_financial_configs() from public, anon;
grant execute on function public.admin_propose_financial_config(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.admin_approve_financial_config(uuid,text,text) to authenticated;
grant execute on function public.admin_list_financial_configs() to authenticated;
