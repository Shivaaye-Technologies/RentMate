-- RentMate internal token wallet: foundation only (founder decision 2026-11-19, see docs/FOUNDER_APPROVALS.md F-09).
--
-- Tokens are an internal allowance with no cash value. This migration:
--   * creates an append-only ledger and a non-negative balance per member;
--   * grants the 100-token registration bonus exactly once per member (new and existing, demo profiles excluded);
--   * records the agreed rates (bonus 100, voice 10/min, video 1/sec, free 50 likes and 10 messages per rolling 24 h)
--     as data. Nothing spends tokens yet: call metering needs trusted LiveKit webhooks and a call screen, and the
--     like/message limits stay as they are until a price for extras is decided (F-08);
--   * locks every money-like path off by constraint: purchases, deposits, transfers between members, withdrawals,
--     cash redemption and payouts (F-10).
-- Members can read only their own wallet and ledger. No client can write either; only private.ledger_post can.

create table public.metering_rates (
  id smallint primary key default 1 check (id = 1),
  registration_bonus int not null default 100 check (registration_bonus between 0 and 10000),
  voice_tokens_per_minute int not null default 10 check (voice_tokens_per_minute between 0 and 10000),
  video_tokens_per_second int not null default 1 check (video_tokens_per_second between 0 and 1000),
  free_likes_per_24h int not null default 50 check (free_likes_per_24h between 0 and 10000),
  free_messages_per_24h int not null default 10 check (free_messages_per_24h between 0 and 10000),
  -- Agreed but not enforced yet (F-08). Flipping these needs a reviewed migration with tests.
  allowances_enforced boolean not null default false,
  call_metering_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.metering_rates (id) values (1);
alter table public.metering_rates enable row level security;
revoke all on public.metering_rates from anon, authenticated;
grant select on public.metering_rates to authenticated;
create policy "rates readable" on public.metering_rates for select to authenticated using (true);

create table public.financial_flags (
  id smallint primary key default 1 check (id = 1),
  token_purchases boolean not null default false,
  deposits boolean not null default false,
  member_transfers boolean not null default false,
  withdrawals boolean not null default false,
  cash_redemption boolean not null default false,
  creator_payouts boolean not null default false,
  -- Each switch stays off until legal, tax and payment-provider approval (F-10) and a migration that removes its check.
  constraint purchases_off check (not token_purchases),
  constraint deposits_off check (not deposits),
  constraint transfers_off check (not member_transfers),
  constraint withdrawals_off check (not withdrawals),
  constraint redemption_off check (not cash_redemption),
  constraint payouts_off check (not creator_payouts)
);
insert into public.financial_flags (id) values (1);
alter table public.financial_flags enable row level security;
revoke all on public.financial_flags from anon, authenticated;
grant select on public.financial_flags to authenticated;
create policy "flags readable" on public.financial_flags for select to authenticated using (true);

create table public.token_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.token_wallets enable row level security;
revoke all on public.token_wallets from anon, authenticated;
grant select on public.token_wallets to authenticated;
create policy "wallet read own" on public.token_wallets for select to authenticated
  using (user_id = (select auth.uid()));

create table public.token_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null check (reason in ('registration_bonus', 'like', 'message', 'voice_call', 'video_call',
                                         'admin_adjustment', 'refund')),
  ref_type text check (char_length(ref_type) <= 40),
  ref_id text check (char_length(ref_id) <= 120),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 160),
  actor uuid,
  created_at timestamptz not null default now()
);
create index token_ledger_user_time on public.token_ledger (user_id, created_at desc);
alter table public.token_ledger enable row level security;
revoke all on public.token_ledger from anon, authenticated;
grant select on public.token_ledger to authenticated;
create policy "ledger read own" on public.token_ledger for select to authenticated
  using (user_id = (select auth.uid()));

-- Ledger rows are permanent. Direct updates and deletes are refused for every role (including the table owner);
-- rows go only when the member's account is deleted (cascade from profiles, which runs at trigger depth > 1).
create function private.ledger_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' or pg_trigger_depth() = 1 then
    raise exception 'The token ledger is append-only.' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke execute on function private.ledger_is_append_only() from public;
create trigger ledger_append_only before update or delete on public.token_ledger
  for each row execute function private.ledger_is_append_only();

-- The only way to change a balance. Locks the wallet row, refuses negative balances, and is replay-safe: repeating an
-- idempotency key returns the original entry without posting again (and refuses a key reused for different values).
create function private.ledger_post(
  p_user uuid, p_delta bigint, p_reason text, p_ref_type text, p_ref_id text, p_key text, p_actor uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.token_wallets;
  prior public.token_ledger;
  entry bigint;
begin
  if p_user is null or p_delta is null or p_delta = 0 or p_key is null then
    raise exception 'Invalid ledger entry.' using errcode = '22023';
  end if;
  insert into public.token_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into w from public.token_wallets where user_id = p_user for update;
  -- Checked after taking the lock, so a concurrent replay sees the first entry.
  select * into prior from public.token_ledger where idempotency_key = p_key;
  if prior.id is not null then
    if prior.user_id <> p_user or prior.delta <> p_delta or prior.reason <> p_reason then
      raise exception 'This idempotency key was already used for a different entry.' using errcode = '23505';
    end if;
    return prior.id;
  end if;
  if w.balance + p_delta < 0 then
    raise exception 'Not enough tokens.' using errcode = 'P0001';
  end if;
  insert into public.token_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key, actor)
  values (p_user, p_delta, w.balance + p_delta, p_reason, p_ref_type, p_ref_id, p_key, p_actor)
  returning id into entry;
  update public.token_wallets set balance = w.balance + p_delta, updated_at = now() where user_id = p_user;
  return entry;
end;
$$;
revoke execute on function private.ledger_post(uuid, bigint, text, text, text, text, uuid) from public, anon, authenticated;

-- Registration bonus: once per member, on profile creation. Demo profiles get nothing.
create function private.grant_registration_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare bonus int;
begin
  if new.is_demo then return new; end if;
  select registration_bonus into bonus from public.metering_rates where id = 1;
  if coalesce(bonus, 0) > 0 then
    perform private.ledger_post(new.id, bonus, 'registration_bonus', 'profile', new.id::text,
                                'registration_bonus:' || new.id);
  end if;
  return new;
end;
$$;
revoke execute on function private.grant_registration_bonus() from public;
create trigger grant_registration_bonus after insert on public.profiles
  for each row execute function private.grant_registration_bonus();

-- Existing members receive the same one-time bonus (the idempotency key makes this safe to re-run).
do $$
declare p record;
begin
  for p in select id from public.profiles where not is_demo loop
    perform private.ledger_post(p.id, (select registration_bonus from public.metering_rates where id = 1),
                                'registration_bonus', 'profile', p.id::text, 'registration_bonus:' || p.id);
  end loop;
end $$;
