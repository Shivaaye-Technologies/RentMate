-- Token-funded bookings (founder decision F-10/F-11/F-24, 2026-11-26): sandbox implementation only.
-- docs/BOOKING_TOKEN_ACCOUNTING.md describes the model; docs/INDIA_LAUNCH_AND_BOOKING_SAFETY.md is the specification.
--
-- Append-only. Separate, server-authoritative records for each domain:
--   * member wallet           public.token_ledger (existing): hold debits and refund credits are new reasons;
--   * booking token holds     public.booking_token_holds (one per booking) + public.booking_token_hold_events;
--   * quote snapshots         public.booking_token_quotes (immutable: price, minutes, commission, shares, policy);
--   * creator pending earning public.creator_booking_earnings (tokens; never withdrawable, transferable or cashable);
--   * platform commission     public.platform_commission_entries;
--   * booking chat            public.booking_messages (exactly the two booking participants).
--
-- Fail closed. Token spend on bookings needs public.booking_token_settings.sandbox_spend_enabled = true AND both
-- participants marked as testers (profiles.is_tester, set only by an admin). live_spend_enabled is locked false by a
-- constraint: enabling real spend needs a reviewed migration after the legal, tax, provider and store approvals.
-- Nothing here buys tokens, converts tokens to INR, pays creators or moves money.

-- ===== Settings and gates =====
create table public.booking_token_settings (
  id smallint primary key default 1 check (id = 1),
  sandbox_spend_enabled boolean not null default false,
  live_spend_enabled boolean not null default false,
  policy_version text not null default 'sandbox-2026-11-26' check (char_length(policy_version) between 3 and 40),
  chat_retention_days int not null default 30 check (chat_retention_days between 1 and 365),
  max_sandbox_grant int not null default 5000 check (max_sandbox_grant between 0 and 100000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  -- Real booking spend stays off until written approvals exist and a migration removes this check.
  constraint live_spend_off check (not live_spend_enabled)
);
insert into public.booking_token_settings (id) values (1);
alter table public.booking_token_settings enable row level security;
revoke all on public.booking_token_settings from anon, authenticated;
grant select on public.booking_token_settings to authenticated;
create policy "booking token settings readable" on public.booking_token_settings for select to authenticated
  using (true);

-- Token price on a service (tokens per hour, or per session). Null = this service cannot be booked with tokens.
alter table public.companion_services
  add column price_tokens integer check (price_tokens is null or price_tokens between 1 and 100000);
grant insert (price_tokens) on public.companion_services to authenticated;
grant update (price_tokens) on public.companion_services to authenticated;

-- Stale unanswered requests expire instead of staying open forever.
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (status in (
  'requested', 'pending', 'accepted', 'rejected', 'cancelled', 'completed', 'disputed', 'expired'));

-- Wallet ledger reasons for holds, refunds and clearly marked sandbox credits (superset of the old list).
alter table public.token_ledger drop constraint token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check check (reason in (
  'registration_bonus', 'like', 'message', 'voice_call', 'video_call', 'admin_adjustment', 'refund',
  'booking_hold', 'booking_refund', 'sandbox_grant'));

-- ===== Records =====
create table public.booking_token_quotes (
  id bigint generated always as identity primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  service_id uuid,
  pricing text not null check (pricing in ('hourly', 'session')),
  price_tokens integer not null check (price_tokens > 0),
  minutes int not null check (minutes > 0),
  gross_tokens bigint not null check (gross_tokens > 0),
  commission_pct numeric(5, 2) not null check (commission_pct between 0 and 50),
  commission_tokens bigint not null check (commission_tokens >= 0),
  creator_tokens bigint not null check (creator_tokens >= 0),
  policy_version text not null,
  created_at timestamptz not null default now(),
  constraint shares_add_up check (commission_tokens + creator_tokens = gross_tokens)
);

create table public.booking_token_holds (
  booking_id uuid primary key references public.bookings (id) on delete restrict,
  member_id uuid not null,  -- no foreign key: the record outlives a deleted account (accounting)
  companion_id uuid not null,
  tokens bigint not null check (tokens > 0),
  status text not null default 'held' check (status in ('held', 'frozen', 'released', 'settled')),
  freeze_reason text check (char_length(freeze_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index booking_token_holds_member on public.booking_token_holds (member_id);
create index booking_token_holds_companion on public.booking_token_holds (companion_id);

create table public.booking_token_hold_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.booking_token_holds (booking_id) on delete restrict,
  event text not null check (event in ('held', 'frozen', 'unfrozen', 'released', 'settled')),
  tokens bigint not null check (tokens >= 0),
  ledger_entry bigint,
  note text check (char_length(note) <= 300),
  actor uuid,
  created_at timestamptz not null default now()
);
create index booking_token_hold_events_booking on public.booking_token_hold_events (booking_id);

create table public.creator_booking_earnings (
  id bigint generated always as identity primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  creator_id uuid not null,  -- no foreign key, kept for accounting
  tokens bigint not null check (tokens >= 0),
  quote_id bigint not null references public.booking_token_quotes (id),
  -- Pending only. There is no withdrawal, transfer, redemption or payout path (F-10).
  status text not null default 'pending' check (status in ('pending')),
  created_at timestamptz not null default now()
);
create index creator_booking_earnings_creator on public.creator_booking_earnings (creator_id);

create table public.platform_commission_entries (
  id bigint generated always as identity primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  gross_tokens bigint not null check (gross_tokens > 0),
  commission_pct numeric(5, 2) not null,
  commission_tokens bigint not null check (commission_tokens >= 0),
  quote_id bigint not null references public.booking_token_quotes (id),
  created_at timestamptz not null default now()
);

create table public.booking_completion_confirmations (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

-- Quotes, hold events, earnings and commission never change once written (corrections are new entries).
create function private.accounting_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Booking accounting records are append-only.' using errcode = '42501';
end;
$$;
revoke execute on function private.accounting_append_only() from public;
create trigger append_only before update or delete on public.booking_token_quotes
  for each row execute function private.accounting_append_only();
create trigger append_only before update or delete on public.booking_token_hold_events
  for each row execute function private.accounting_append_only();
create trigger append_only before update or delete on public.creator_booking_earnings
  for each row execute function private.accounting_append_only();
create trigger append_only before update or delete on public.platform_commission_entries
  for each row execute function private.accounting_append_only();
create trigger append_only before delete on public.booking_token_holds
  for each row execute function private.accounting_append_only();

-- Read access: participants see their own booking's quote, hold and events; creators see their own earnings;
-- commission entries are admin-only (no policy). No client can write any of these tables.
alter table public.booking_token_quotes enable row level security;
alter table public.booking_token_holds enable row level security;
alter table public.booking_token_hold_events enable row level security;
alter table public.creator_booking_earnings enable row level security;
alter table public.platform_commission_entries enable row level security;
alter table public.booking_completion_confirmations enable row level security;
revoke all on public.booking_token_quotes, public.booking_token_holds, public.booking_token_hold_events,
  public.creator_booking_earnings, public.platform_commission_entries, public.booking_completion_confirmations
  from anon, authenticated;
grant select on public.booking_token_quotes, public.booking_token_holds, public.booking_token_hold_events,
  public.creator_booking_earnings, public.booking_completion_confirmations to authenticated;

create function private.booking_participant(p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bookings b where b.id = p_booking
                 and (select auth.uid()) in (b.member_id, b.companion_id));
$$;
revoke execute on function private.booking_participant(uuid) from public;
grant execute on function private.booking_participant(uuid) to authenticated;

create policy "quotes read participants" on public.booking_token_quotes for select to authenticated
  using (private.booking_participant(booking_id));
create policy "holds read participants" on public.booking_token_holds for select to authenticated
  using ((select auth.uid()) in (member_id, companion_id));
create policy "hold events read participants" on public.booking_token_hold_events for select to authenticated
  using (private.booking_participant(booking_id));
create policy "earnings read own" on public.creator_booking_earnings for select to authenticated
  using (creator_id = (select auth.uid()));
create policy "confirmations read participants" on public.booking_completion_confirmations for select
  to authenticated using (private.booking_participant(booking_id));

-- ===== Core operations =====
create function private.booking_tokens_allowed(p_member uuid, p_companion uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.sandbox_spend_enabled from public.booking_token_settings s where s.id = 1), false)
     and exists (select 1 from public.profiles p where p.id = p_member and p.is_tester and not p.is_demo)
     and exists (select 1 from public.profiles p where p.id = p_companion and p.is_tester and not p.is_demo);
$$;
revoke execute on function private.booking_tokens_allowed(uuid, uuid) from public;

create function private.token_quote(p_pricing text, p_price_tokens integer, p_minutes int, p_commission_pct numeric)
returns table (gross_tokens bigint, commission_tokens bigint, creator_tokens bigint)
language sql
immutable
set search_path = ''
as $$
  with g as (
    select case when p_pricing = 'session' then p_price_tokens::bigint
                else ceil(p_price_tokens * p_minutes / 60.0)::bigint end as gross
  )
  select g.gross, floor(g.gross * p_commission_pct / 100)::bigint,
         g.gross - floor(g.gross * p_commission_pct / 100)::bigint
  from g;
$$;
revoke execute on function private.token_quote(text, integer, int, numeric) from public;

-- Server-side quote preview (nothing is reserved). Amounts always come from the stored service.
create function public.booking_token_quote(p_service uuid, p_minutes int)
returns table (gross_tokens bigint, available_balance bigint, enough_tokens boolean, token_booking_available boolean,
               policy_version text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  s public.companion_services;
  q record;
  bal bigint;
begin
  select * into s from public.companion_services where id = p_service and active;
  if s.id is null or not private.companion_visible(s.companion_id) then
    raise exception 'This service is not available.' using errcode = 'P0001';
  end if;
  if s.price_tokens is null then
    raise exception 'This service has no token price.' using errcode = 'P0001';
  end if;
  if p_minutes is null or p_minutes < s.min_minutes or p_minutes > s.max_minutes then
    raise exception 'Choose between % and % minutes for this service.', s.min_minutes, s.max_minutes
      using errcode = 'P0001';
  end if;
  select * into q from private.token_quote(s.pricing, s.price_tokens, p_minutes,
                                           (select commission_pct from public.platform_settings));
  bal := coalesce((select w.balance from public.token_wallets w where w.user_id = me), 0);
  return query select q.gross_tokens, bal, bal >= q.gross_tokens, private.booking_tokens_allowed(me, s.companion_id),
                      (select st.policy_version from public.booking_token_settings st where st.id = 1);
end;
$$;

-- Request a booking and reserve its tokens in one transaction. Retrying with the same idempotency key returns the
-- same booking and never reserves twice. If anything fails (availability, balance, gates), nothing is kept.
create function public.booking_request_with_tokens(
  p_service uuid, p_starts_at timestamptz, p_minutes int, p_meeting_point text, p_note text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  s public.companion_services;
  bk public.bookings;
  b uuid;
  q record;
  pct numeric(5, 2);
  quote_id bigint;
  entry bigint;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 80 then
    raise exception 'A request key is required.' using errcode = '22023';
  end if;
  select * into s from public.companion_services where id = p_service and active;
  if s.id is null then raise exception 'This service is not available.' using errcode = 'P0001'; end if;
  if s.price_tokens is null then
    raise exception 'This service cannot be booked with tokens.' using errcode = 'P0001';
  end if;
  if not private.booking_tokens_allowed(me, s.companion_id) then
    raise exception 'Booking with tokens is not available yet.' using errcode = 'P0001';
  end if;
  -- Serialises this member's token bookings so concurrent requests cannot both pass the balance check.
  perform pg_advisory_xact_lock(hashtextextended('booking_tokens:' || me::text, 0));

  b := public.booking_request(p_service, p_starts_at, p_minutes, p_meeting_point, coalesce(p_note, ''),
                              p_idempotency_key);
  if exists (select 1 from public.booking_token_holds h where h.booking_id = b) then
    return b; -- replay of a request that already holds its tokens
  end if;
  select * into bk from public.bookings where id = b for update;
  if bk.status not in ('requested', 'pending') or bk.service_id is distinct from p_service then
    raise exception 'This request key belongs to another booking.' using errcode = 'P0001';
  end if;

  pct := (select commission_pct from public.platform_settings);
  select * into q from private.token_quote(s.pricing, s.price_tokens, bk.duration_minutes, pct);
  insert into public.booking_token_quotes (booking_id, service_id, pricing, price_tokens, minutes, gross_tokens,
    commission_pct, commission_tokens, creator_tokens, policy_version)
  values (b, s.id, s.pricing, s.price_tokens, bk.duration_minutes, q.gross_tokens, pct, q.commission_tokens,
    q.creator_tokens, (select policy_version from public.booking_token_settings where id = 1))
  returning id into quote_id;
  -- ledger_post refuses a negative balance; the raised error rolls back the booking too.
  entry := private.ledger_post(me, -q.gross_tokens, 'booking_hold', 'booking', b::text, 'booking_hold:' || b);
  insert into public.booking_token_holds (booking_id, member_id, companion_id, tokens)
  values (b, me, s.companion_id, q.gross_tokens);
  insert into public.booking_token_hold_events (booking_id, event, tokens, ledger_entry, actor)
  values (b, 'held', q.gross_tokens, entry, me);
  return b;
end;
$$;

-- Returns held (or frozen) tokens to the member with a compensating ledger entry. Idempotent.
create function private.booking_hold_release(p_booking uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.booking_token_holds;
  entry bigint;
begin
  select * into h from public.booking_token_holds where booking_id = p_booking for update;
  if h.booking_id is null or h.status not in ('held', 'frozen') then return; end if;
  if exists (select 1 from public.profiles p where p.id = h.member_id) then
    entry := private.ledger_post(h.member_id, h.tokens, 'booking_refund', 'booking', p_booking::text,
                                 'booking_refund:' || p_booking);
  end if;
  update public.booking_token_holds set status = 'released', updated_at = now() where booking_id = p_booking;
  insert into public.booking_token_hold_events (booking_id, event, tokens, ledger_entry, note, actor)
  values (p_booking, 'released', h.tokens, entry, left(p_note, 300), (select auth.uid()));
end;
$$;
revoke execute on function private.booking_hold_release(uuid, text) from public, anon, authenticated;

-- Consumes the hold into the creator's pending earnings and the platform commission, from the quote snapshot.
-- Only callable from completion paths; a frozen hold settles only when p_reviewed (moderator decision).
create function private.booking_hold_settle(p_booking uuid, p_reviewed boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.booking_token_holds;
  q public.booking_token_quotes;
begin
  select * into h from public.booking_token_holds where booking_id = p_booking for update;
  if h.booking_id is null or h.status in ('released', 'settled') then return; end if;
  if h.status = 'frozen' and not p_reviewed then
    raise exception 'This booking is under review; it cannot be completed yet.' using errcode = 'P0001';
  end if;
  select * into q from public.booking_token_quotes where booking_id = p_booking;
  insert into public.creator_booking_earnings (booking_id, creator_id, tokens, quote_id)
  values (p_booking, h.companion_id, q.creator_tokens, q.id);
  insert into public.platform_commission_entries (booking_id, gross_tokens, commission_pct, commission_tokens, quote_id)
  values (p_booking, q.gross_tokens, q.commission_pct, q.commission_tokens, q.id);
  update public.booking_token_holds set status = 'settled', updated_at = now() where booking_id = p_booking;
  insert into public.booking_token_hold_events (booking_id, event, tokens, note, actor)
  values (p_booking, 'settled', h.tokens, left(p_note, 300), (select auth.uid()));
end;
$$;
revoke execute on function private.booking_hold_settle(uuid, boolean, text) from public, anon, authenticated;

create function private.booking_hold_freeze(p_booking uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.booking_token_holds set status = 'frozen', freeze_reason = left(p_reason, 300), updated_at = now()
  where booking_id = p_booking and status = 'held';
  if found then
    insert into public.booking_token_hold_events (booking_id, event, tokens, note, actor)
    select p_booking, 'frozen', h.tokens, left(p_reason, 300), (select auth.uid())
    from public.booking_token_holds h where h.booking_id = p_booking;
  end if;
end;
$$;
revoke execute on function private.booking_hold_freeze(uuid, text) from public, anon, authenticated;

-- ===== Booking chat (participant-only) =====
create table public.booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid,  -- null for system events
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint system_has_no_sender check ((kind = 'system') = (sender_id is null))
);
create index booking_messages_booking_time on public.booking_messages (booking_id, created_at);
alter table public.booking_messages enable row level security;
revoke all on public.booking_messages from anon, authenticated;
grant select on public.booking_messages to authenticated;
grant insert (booking_id, body) on public.booking_messages to authenticated;

-- Open from the request until chat_retention_days after the booking ends (support and disputes).
create function private.booking_chat_open(p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking and (select auth.uid()) in (b.member_id, b.companion_id)
      and now() < b.ends_at + make_interval(days => (select s.chat_retention_days from public.booking_token_settings s
                                                       where s.id = 1)));
$$;
revoke execute on function private.booking_chat_open(uuid) from public;
grant execute on function private.booking_chat_open(uuid) to authenticated;

-- Whether the two participants of the caller's own booking have blocked each other (false for other bookings, so
-- it reveals nothing about people outside the caller's bookings).
create function private.booking_pair_blocked(p_booking uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bookings b where b.id = p_booking
                 and (select auth.uid()) in (b.member_id, b.companion_id)
                 and private.blocked_pair(b.member_id, b.companion_id));
$$;
revoke execute on function private.booking_pair_blocked(uuid) from public;
grant execute on function private.booking_pair_blocked(uuid) to authenticated;

create policy "booking chat read participants" on public.booking_messages for select to authenticated
  using (private.booking_chat_open(booking_id));
create policy "booking chat write participants" on public.booking_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid()) and kind = 'text'
    and private.booking_chat_open(booking_id)
    and not private.is_suspended((select auth.uid()))
    and not private.booking_pair_blocked(booking_id)
  );

create function private.screen_booking_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Members can only write booking_id and body (column grants), so a client row always arrives as kind 'text'.
  -- System events are written by private.booking_system_message with kind 'system' and no sender.
  if new.kind = 'text' then
    new.sender_id := (select auth.uid());
    new.created_at := now();
    if private.prohibited_text(new.body) is not null then
      raise exception 'RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.'
        using errcode = '23514';
    end if;
    if (select count(*) from public.booking_messages m where m.sender_id = new.sender_id
        and m.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'You are sending messages too fast. Please wait a moment.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.screen_booking_message() from public;
create trigger screen_booking_message before insert on public.booking_messages
  for each row execute function private.screen_booking_message();
alter publication supabase_realtime add table public.booking_messages;

create function private.booking_system_message(p_booking uuid, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.booking_messages (booking_id, sender_id, kind, body) values (p_booking, null, 'system', p_body);
$$;
revoke execute on function private.booking_system_message(uuid, text) from public, anon, authenticated;

-- ===== Lifecycle: holds and chat follow booking status =====
create function private.booking_token_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.booking_system_message(new.id, 'Booking requested: ' || new.service_title || '.');
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status in ('rejected', 'cancelled', 'expired') then
    perform private.booking_hold_release(new.id, 'Booking ' || new.status);
  elsif new.status = 'disputed' then
    perform private.booking_hold_freeze(new.id, 'Dispute opened');
  elsif new.status = 'completed' then
    -- A completion that follows a dispute is a moderator decision (admin_resolve_dispute).
    perform private.booking_hold_settle(new.id, old.status = 'disputed', 'Booking completed');
  end if;
  perform private.booking_system_message(new.id, 'Booking ' || new.status || '.');
  return new;
end;
$$;
revoke execute on function private.booking_token_lifecycle() from public;
create trigger booking_token_lifecycle after insert or update of status on public.bookings
  for each row execute function private.booking_token_lifecycle();

-- A safety report about a booking freezes its tokens until a moderator decides.
create function private.freeze_on_booking_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a participant's report freezes the tokens (others could otherwise freeze any booking by id).
  if new.booking_id is not null and exists (
       select 1 from public.bookings b where b.id = new.booking_id and new.reporter_id in (b.member_id, b.companion_id)) then
    perform private.booking_hold_freeze(new.booking_id, 'Report: ' || new.reason);
  end if;
  return new;
end;
$$;
revoke execute on function private.freeze_on_booking_report() from public;
create trigger freeze_booking_tokens_on_report after insert on public.reports
  for each row execute function private.freeze_on_booking_report();

-- Completion: bookings with a token hold need both participants to confirm; others keep the old behaviour.
create or replace function public.booking_complete(p_booking uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  bk public.bookings;
begin
  select * into bk from public.bookings where id = p_booking for update;
  if bk.id is null or (bk.member_id is distinct from me and bk.companion_id is distinct from me) then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;
  if bk.status <> 'accepted' or bk.ends_at > now() then
    raise exception 'Only accepted bookings that have ended can be completed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_token_holds h where h.booking_id = p_booking) then
    if exists (select 1 from public.booking_token_holds h where h.booking_id = p_booking and h.status = 'frozen') then
      raise exception 'This booking is under review; it cannot be completed yet.' using errcode = 'P0001';
    end if;
    insert into public.booking_completion_confirmations (booking_id, user_id) values (p_booking, me)
    on conflict do nothing;
    if (select count(*) from public.booking_completion_confirmations c
        where c.booking_id = p_booking and c.user_id in (bk.member_id, bk.companion_id)) < 2 then
      perform private.booking_system_message(p_booking,
        'One participant confirmed completion. Waiting for the other participant.');
      return;
    end if;
  end if;
  update public.bookings set status = 'completed', completed_at = now(), updated_at = now() where id = p_booking;
  perform private.booking_log(p_booking, 'accepted', 'completed', null);
  perform private.notify(case when me = bk.member_id then bk.companion_id else bk.member_id end,
    'booking_completed', 'Booking completed', format('%s · %s', bk.service_title, bk.reference), p_booking);
end;
$$;

-- Unanswered requests whose start time has passed expire and release their tokens. Expires the caller's own.
create function public.booking_expire_stale()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  update public.bookings set status = 'expired', updated_at = now()
  where status in ('requested', 'pending') and starts_at <= now()
    and (select auth.uid()) in (member_id, companion_id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Participant view of one booking's token state.
create function public.my_booking_tokens(p_booking uuid)
returns table (gross_tokens bigint, hold_status text, commission_pct numeric, creator_tokens bigint,
               commission_tokens bigint, policy_version text, confirmed_by_me boolean, confirmations int)
language sql
stable
security definer
set search_path = ''
as $$
  select q.gross_tokens, h.status, q.commission_pct, q.creator_tokens, q.commission_tokens, q.policy_version,
         exists (select 1 from public.booking_completion_confirmations c
                 where c.booking_id = p_booking and c.user_id = (select auth.uid())),
         (select count(*)::int from public.booking_completion_confirmations c where c.booking_id = p_booking)
  from public.booking_token_holds h
  join public.booking_token_quotes q on q.booking_id = h.booking_id
  where h.booking_id = p_booking and private.booking_participant(p_booking);
$$;

-- Creator summary: pending booking earnings in tokens. Not withdrawable, transferable or redeemable.
create function public.my_creator_booking_earnings()
returns table (pending_tokens bigint, settled_bookings bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.tokens), 0)::bigint, count(*) from public.creator_booking_earnings e
  where e.creator_id = (select auth.uid());
$$;

-- ===== Admin (role-checked, logged) =====
create function public.admin_set_booking_token_sandbox(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  update public.booking_token_settings set sandbox_spend_enabled = p_enabled, updated_by = (select auth.uid()),
    updated_at = now() where id = 1;
  perform private.log_action(case when p_enabled then 'booking_token_sandbox_on' else 'booking_token_sandbox_off' end,
    'settings', 'booking_tokens', null);
end;
$$;

-- Test tokens for tester accounts only, while the sandbox is on. Labelled sandbox_grant in the ledger.
create function public.admin_grant_sandbox_tokens(p_user uuid, p_tokens int, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare entry bigint;
begin
  perform private.require_role('admin');
  if not coalesce((select sandbox_spend_enabled from public.booking_token_settings where id = 1), false) then
    raise exception 'The booking token sandbox is off.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user and p.is_tester and not p.is_demo) then
    raise exception 'Sandbox tokens can only be granted to tester accounts.' using errcode = 'P0001';
  end if;
  if p_tokens is null or p_tokens < 1 or p_tokens > (select max_sandbox_grant from public.booking_token_settings
                                                      where id = 1) then
    raise exception 'Grant between 1 and the sandbox maximum.' using errcode = '22023';
  end if;
  entry := private.ledger_post(p_user, p_tokens, 'sandbox_grant', 'sandbox', null, 'sandbox_grant:' || p_key,
                               (select auth.uid()));
  perform private.log_action('sandbox_tokens_granted', 'user', p_user::text, null, jsonb_build_object('tokens', p_tokens));
  return entry;
end;
$$;

-- Moderator decision on a frozen hold: settle (creator share + commission) or refund the member.
create function public.admin_resolve_booking_tokens(p_booking uuid, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  if p_action not in ('settle', 'refund', 'unfreeze') then
    raise exception 'Action must be settle, refund or unfreeze.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.booking_token_holds h where h.booking_id = p_booking and h.status = 'frozen') then
    raise exception 'This booking has no frozen tokens.' using errcode = 'P0001';
  end if;
  if char_length(coalesce(btrim(p_note), '')) < 5 then
    raise exception 'Record a reason (at least 5 characters).' using errcode = '22023';
  end if;
  if p_action = 'settle' then
    perform private.booking_hold_settle(p_booking, true, p_note);
    -- The booking follows the decision (the status trigger finds the hold already settled).
    update public.bookings set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
    where id = p_booking and status in ('accepted', 'disputed');
  elsif p_action = 'refund' then
    perform private.booking_hold_release(p_booking, p_note);
    update public.bookings set status = 'cancelled', cancelled_by = (select auth.uid()),
      cancel_reason = left('Refunded after review: ' || p_note, 500), updated_at = now()
    where id = p_booking and status in ('requested', 'pending', 'accepted', 'disputed');
  else
    update public.booking_token_holds set status = 'held', freeze_reason = null, updated_at = now()
    where booking_id = p_booking;
    insert into public.booking_token_hold_events (booking_id, event, tokens, note, actor)
    select p_booking, 'unfrozen', h.tokens, left(p_note, 300), (select auth.uid())
    from public.booking_token_holds h where h.booking_id = p_booking;
  end if;
  perform private.log_action('booking_tokens_' || p_action, 'booking', p_booking::text, p_note);
end;
$$;

-- Reconciliation: every hold balances (held = released or settled once; settled = creator + commission).
create function public.admin_booking_token_reconciliation()
returns table (booking_id uuid, hold_status text, held bigint, released bigint, creator bigint, commission bigint,
               balanced boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query
  select h.booking_id, h.status, h.tokens,
         coalesce((select sum(l.delta) from public.token_ledger l where l.idempotency_key = 'booking_refund:' || h.booking_id), 0)::bigint,
         coalesce((select e.tokens from public.creator_booking_earnings e where e.booking_id = h.booking_id), 0)::bigint,
         coalesce((select c.commission_tokens from public.platform_commission_entries c where c.booking_id = h.booking_id), 0)::bigint,
         case h.status
           when 'released' then not exists (select 1 from public.creator_booking_earnings e where e.booking_id = h.booking_id)
           when 'settled' then coalesce((select e.tokens from public.creator_booking_earnings e where e.booking_id = h.booking_id), 0)
                               + coalesce((select c.commission_tokens from public.platform_commission_entries c where c.booking_id = h.booking_id), 0)
                               = h.tokens
           else not exists (select 1 from public.creator_booking_earnings e where e.booking_id = h.booking_id)
         end
  from public.booking_token_holds h order by h.created_at desc limit 1000;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'booking_token_quote(uuid, int)', 'booking_request_with_tokens(uuid, timestamptz, int, text, text, text)',
    'booking_expire_stale()', 'my_booking_tokens(uuid)', 'my_creator_booking_earnings()',
    'admin_set_booking_token_sandbox(boolean)', 'admin_grant_sandbox_tokens(uuid, int, text)',
    'admin_resolve_booking_tokens(uuid, text, text)', 'admin_booking_token_reconciliation()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
