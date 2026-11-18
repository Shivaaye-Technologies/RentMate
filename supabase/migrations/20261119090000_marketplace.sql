-- RentMate marketplace: non-sexual paid social companionship between verified adults.
--
-- Additive only: new tables, functions and triggers. Existing dating tables are not renamed or changed except for
-- two nullable reference columns on public.reports and a wider report-reason list (superset).
--
-- Rules enforced here, not in the app:
--   * companions are approved by moderators before they appear; activities come from an allow-list;
--   * prices are computed by the server from the companion's service, never sent by the client;
--   * booking status changes only through the functions below; accepted bookings can never overlap;
--   * meeting points and areas are public places, never residential addresses;
--   * reviews only for completed bookings, one per booking, by the member who booked;
--   * suspended accounts cannot book, list, message or review;
--   * payments are disabled: a booking is never proof that money moved.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------- Activity categories (allow-list; no free-text categories) ----------
create table public.activity_categories (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null check (char_length(label) between 2 and 60),
  description text not null default '' check (char_length(description) <= 300),
  sort int not null default 100,
  active boolean not null default true
);
insert into public.activity_categories (key, label, description, sort) values
  ('coffee', 'Coffee meetup', 'Conversation over coffee or tea in a cafe.', 10),
  ('dining', 'Dining', 'Lunch or dinner at a restaurant.', 20),
  ('movies', 'Movies', 'A film at a cinema.', 30),
  ('public_events', 'Public events', 'Concerts, exhibitions, festivals and talks.', 40),
  ('sports', 'Sports events', 'Watching a match or game together.', 50),
  ('gaming', 'Gaming', 'Board games, arcades or gaming cafes.', 60),
  ('sightseeing', 'Sightseeing and city walks', 'Exploring public places and landmarks.', 70),
  ('social', 'Social gatherings', 'Company at a public social event.', 80),
  ('friendship', 'Friendship and conversation', 'Friendly conversation in a public place.', 90),
  ('entertainment', 'Public entertainment', 'Comedy, theatre and live shows.', 100),
  ('language', 'Language practice', 'Practising a language in conversation.', 110),
  ('fitness', 'Fitness and walks', 'Walks, runs or workouts in public places.', 120);
alter table public.activity_categories enable row level security;
revoke all on public.activity_categories from anon, authenticated;
grant select on public.activity_categories to authenticated;
create policy "categories readable" on public.activity_categories for select to authenticated using (true);

-- ---------- Platform settings (single row) ----------
create table public.platform_settings (
  id boolean primary key default true check (id),
  commission_pct numeric(5, 2) not null default 15 check (commission_pct between 0 and 50),
  -- Payments and subscriptions stay off until the founder records the approvals (F-10, F-11).
  payments_enabled boolean not null default false check (not payments_enabled),
  subscriptions_enabled boolean not null default false check (not subscriptions_enabled),
  min_notice_hours int not null default 2 check (min_notice_hours between 0 and 168),
  max_advance_days int not null default 60 check (max_advance_days between 1 and 365),
  free_cancel_hours int not null default 24 check (free_cancel_hours between 0 and 168),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.platform_settings default values;
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;
create policy "settings readable" on public.platform_settings for select to authenticated using (true);

-- ---------- Account suspensions and appeals (members and companions) ----------
create table public.account_suspensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 1000),
  suspended_by uuid,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid,
  lift_note text check (char_length(lift_note) <= 1000)
);
create unique index account_suspensions_one_active on public.account_suspensions (user_id) where lifted_at is null;
alter table public.account_suspensions enable row level security;
revoke all on public.account_suspensions from anon, authenticated;
grant select on public.account_suspensions to authenticated;
create policy "suspensions read own" on public.account_suspensions for select to authenticated
  using (user_id = (select auth.uid()));

create function private.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_suspensions s where s.user_id = p_user and s.lifted_at is null);
$$;
revoke execute on function private.is_suspended(uuid) from public;
grant execute on function private.is_suspended(uuid) to authenticated;

create table public.account_appeals (
  id uuid primary key default gen_random_uuid(),
  suspension_id uuid not null references public.account_suspensions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  statement text not null check (char_length(statement) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decision_note text check (char_length(decision_note) <= 1000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index account_appeals_one_open on public.account_appeals (suspension_id) where status = 'open';
alter table public.account_appeals enable row level security;
revoke all on public.account_appeals from anon, authenticated;
grant select on public.account_appeals to authenticated;
create policy "appeals read own" on public.account_appeals for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Companion profiles ----------
-- Areas and meeting points name a neighbourhood or public venue. Anything that looks like a home address
-- (flat/house/plot numbers, PIN codes) is refused.
create function private.looks_like_address(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p, '') ~* '(\m(flat|house|h\.? ?no|plot|apt|apartment|room no|floor|pin ?code|pincode)\M|\m[0-9]{6}\M|#\s*[0-9])';
$$;
revoke execute on function private.looks_like_address(text) from public;
-- Used by check constraints, which run as the signed-in user. Pure function, no data access.
grant execute on function private.looks_like_address(text) to authenticated;

create table public.companion_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  headline text not null check (char_length(headline) between 5 and 80),
  about text not null default '' check (char_length(about) <= 1500),
  city text not null check (char_length(city) between 2 and 60),
  area text not null default '' check (char_length(area) <= 80),
  languages text[] not null default '{}' check (cardinality(languages) <= 8),
  interests text[] not null default '{}' check (cardinality(interests) <= 12),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended', 'paused')),
  verified boolean not null default false,
  status_reason text check (char_length(status_reason) <= 1000),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint area_not_an_address check (not private.looks_like_address(area))
);
create index companion_profiles_city_idx on public.companion_profiles (lower(city)) where status = 'approved';
alter table public.companion_profiles enable row level security;
revoke all on public.companion_profiles from anon, authenticated;
grant select on public.companion_profiles to authenticated;
grant insert (user_id, headline, about, city, area, languages, interests) on public.companion_profiles to authenticated;
grant update (headline, about, city, area, languages, interests) on public.companion_profiles to authenticated;

-- Visible to others only when approved, not suspended and not blocked either way.
create function private.companion_visible(p_companion uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companion_profiles c
    where c.user_id = p_companion and c.status = 'approved'
  ) and not private.is_suspended(p_companion) and not private.blocked_either(p_companion);
$$;
revoke execute on function private.companion_visible(uuid) from public;
grant execute on function private.companion_visible(uuid) to authenticated;

create policy "companions read own or visible" on public.companion_profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.companion_visible(user_id));
create policy "companions apply as self" on public.companion_profiles for insert to authenticated
  with check (user_id = (select auth.uid()) and not private.is_suspended((select auth.uid())));
create policy "companions edit own" on public.companion_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Services and prices ----------
create table public.companion_services (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.companion_profiles (user_id) on delete cascade,
  category text not null references public.activity_categories (key),
  title text not null check (char_length(title) between 3 and 80),
  description text not null default '' check (char_length(description) <= 800),
  pricing text not null check (pricing in ('hourly', 'session')),
  price_inr integer not null check (price_inr between 100 and 100000),
  min_minutes int not null default 60 check (min_minutes between 30 and 480),
  max_minutes int not null default 180,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint minutes_range check (max_minutes between min_minutes and 720)
);
create index companion_services_companion_idx on public.companion_services (companion_id) where active;
alter table public.companion_services enable row level security;
revoke all on public.companion_services from anon, authenticated;
grant select on public.companion_services to authenticated;
grant insert (companion_id, category, title, description, pricing, price_inr, min_minutes, max_minutes, active)
  on public.companion_services to authenticated;
grant update (category, title, description, pricing, price_inr, min_minutes, max_minutes, active)
  on public.companion_services to authenticated;
create policy "services read own or visible" on public.companion_services for select to authenticated
  using (companion_id = (select auth.uid()) or (active and private.companion_visible(companion_id)));
create policy "services add own" on public.companion_services for insert to authenticated
  with check (companion_id = (select auth.uid()) and not private.is_suspended((select auth.uid())));
create policy "services edit own" on public.companion_services for update to authenticated
  using (companion_id = (select auth.uid())) with check (companion_id = (select auth.uid()));

-- Only active, allow-listed categories.
create function private.check_service_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.activity_categories c where c.key = new.category and c.active) then
    raise exception 'Choose one of the listed activities.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.check_service_category() from public;
create trigger companion_services_category before insert or update on public.companion_services
  for each row execute function private.check_service_category();

-- ---------- Weekly availability ----------
create table public.companion_availability (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.companion_profiles (user_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute int not null check (start_minute between 0 and 1439),
  end_minute int not null check (end_minute between 1 and 1440),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 3 and 64),
  constraint availability_order check (end_minute > start_minute),
  unique (companion_id, weekday, start_minute)
);
alter table public.companion_availability enable row level security;
revoke all on public.companion_availability from anon, authenticated;
grant select, delete on public.companion_availability to authenticated;
grant insert (companion_id, weekday, start_minute, end_minute, timezone) on public.companion_availability
  to authenticated;
create policy "availability read own or visible" on public.companion_availability for select to authenticated
  using (companion_id = (select auth.uid()) or private.companion_visible(companion_id));
create policy "availability add own" on public.companion_availability for insert to authenticated
  with check (companion_id = (select auth.uid()));
create policy "availability delete own" on public.companion_availability for delete to authenticated
  using (companion_id = (select auth.uid()));

create function private.check_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform now() at time zone new.timezone;
  return new;
exception when others then
  raise exception 'Unknown time zone.' using errcode = '22023';
end;
$$;
revoke execute on function private.check_timezone() from public;
create trigger companion_availability_timezone before insert or update on public.companion_availability
  for each row execute function private.check_timezone();

-- ---------- Shortlists ----------
create table public.shortlists (
  member_id uuid not null references public.profiles (id) on delete cascade,
  companion_id uuid not null references public.companion_profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, companion_id),
  constraint not_self check (member_id <> companion_id)
);
alter table public.shortlists enable row level security;
revoke all on public.shortlists from anon, authenticated;
grant select, delete on public.shortlists to authenticated;
grant insert (member_id, companion_id) on public.shortlists to authenticated;
create policy "shortlist read own" on public.shortlists for select to authenticated
  using (member_id = (select auth.uid()));
create policy "shortlist add own" on public.shortlists for insert to authenticated
  with check (member_id = (select auth.uid()) and private.companion_visible(companion_id));
create policy "shortlist remove own" on public.shortlists for delete to authenticated
  using (member_id = (select auth.uid()));

-- ---------- Bookings ----------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique
    default ('RM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  -- Kept (set null) if an account is deleted, so booking and dispute records survive.
  member_id uuid references public.profiles (id) on delete set null,
  companion_id uuid references public.companion_profiles (user_id) on delete set null,
  service_id uuid references public.companion_services (id) on delete set null,
  category text not null,
  service_title text not null,
  pricing text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes int generated always as ((extract(epoch from (ends_at - starts_at)) / 60)::int) stored,
  timezone text not null,
  price_inr integer not null check (price_inr >= 0),
  commission_pct numeric(5, 2) not null,
  meeting_point text not null check (char_length(meeting_point) between 3 and 120),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'requested'
    check (status in ('requested', 'pending', 'accepted', 'rejected', 'cancelled', 'completed', 'disputed')),
  cancellation_policy text not null,
  cancelled_by uuid,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  late_cancellation boolean not null default false,
  dispute_reason text check (char_length(dispute_reason) <= 1000),
  -- Payments are disabled. This never changes from 'not_collected' until a verified payment provider exists.
  payment_status text not null default 'not_collected' check (payment_status in ('not_collected')),
  idempotency_key text check (char_length(idempotency_key) between 8 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  completed_at timestamptz,
  slot tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  constraint booking_order check (ends_at > starts_at),
  constraint meeting_point_public check (not private.looks_like_address(meeting_point)),
  constraint member_not_companion check (member_id is null or companion_id is null or member_id <> companion_id),
  -- No two accepted bookings for the same companion, or the same member, may overlap.
  constraint companion_no_overlap exclude using gist (companion_id with =, slot with &&) where (status = 'accepted'),
  constraint member_no_overlap exclude using gist (member_id with =, slot with &&) where (status = 'accepted')
);
create unique index bookings_idempotency on public.bookings (member_id, idempotency_key)
  where idempotency_key is not null;
create index bookings_companion_idx on public.bookings (companion_id, starts_at);
create index bookings_member_idx on public.bookings (member_id, starts_at);
alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;
create policy "bookings read participants" on public.bookings for select to authenticated
  using (member_id = (select auth.uid()) or companion_id = (select auth.uid()));

create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  actor_id uuid,
  from_status text,
  to_status text not null,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
alter table public.booking_events enable row level security;
revoke all on public.booking_events from anon, authenticated;
grant select on public.booking_events to authenticated;
create policy "booking events read participants" on public.booking_events for select to authenticated
  using (exists (select 1 from public.bookings b where b.id = booking_id
                 and (b.member_id = (select auth.uid()) or b.companion_id = (select auth.uid()))));

-- ---------- Notifications ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('booking_requested', 'booking_pending', 'booking_accepted', 'booking_rejected',
    'booking_cancelled', 'booking_completed', 'booking_disputed', 'dispute_resolved', 'review_received',
    'companion_reviewed', 'account_suspended', 'account_restored', 'appeal_decided')),
  title text not null check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 500),
  booking_id uuid references public.bookings (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "notifications read own" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "notifications mark own" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_booking uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, booking_id)
  select p_user, p_kind, p_title, coalesce(p_body, ''), p_booking where p_user is not null;
$$;
revoke execute on function private.notify(uuid, text, text, text, uuid) from public;

-- ---------- Marketplace conversations ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  companion_id uuid not null references public.companion_profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (member_id, companion_id),
  constraint conversation_not_self check (member_id <> companion_id)
);
alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
create policy "conversations read participants" on public.conversations for select to authenticated
  using (member_id = (select auth.uid()) or companion_id = (select auth.uid()));

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index conversation_messages_idx on public.conversation_messages (conversation_id, created_at);
alter table public.conversation_messages enable row level security;
revoke all on public.conversation_messages from anon, authenticated;
grant select on public.conversation_messages to authenticated;
grant insert (conversation_id, sender_id, body) on public.conversation_messages to authenticated;

create function private.conversation_peer(p_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.member_id = (select auth.uid()) then c.companion_id
              when c.companion_id = (select auth.uid()) then c.member_id end
  from public.conversations c where c.id = p_conversation;
$$;
revoke execute on function private.conversation_peer(uuid) from public;
grant execute on function private.conversation_peer(uuid) to authenticated;

create policy "conversation messages read participants" on public.conversation_messages for select to authenticated
  using (private.conversation_peer(conversation_id) is not null);
create policy "conversation messages send" on public.conversation_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.conversation_peer(conversation_id) is not null
    and not private.blocked_either(private.conversation_peer(conversation_id))
    and not private.is_suspended((select auth.uid()))
  );

create function private.conversation_message_written()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.conversation_messages m
      where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too fast. Please wait a moment.' using errcode = 'P0001';
  end if;
  new.read_at := null;
  update public.conversations set last_message_at = now() where id = new.conversation_id;
  return new;
end;
$$;
revoke execute on function private.conversation_message_written() from public;
create trigger conversation_messages_written before insert on public.conversation_messages
  for each row execute function private.conversation_message_written();

-- ---------- Reviews ----------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings (id) on delete set null,
  reviewer_id uuid references public.profiles (id) on delete set null,
  companion_id uuid references public.companion_profiles (user_id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  hidden_reason text check (char_length(hidden_reason) <= 500),
  created_at timestamptz not null default now()
);
create index reviews_companion_idx on public.reviews (companion_id) where status = 'visible';
alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to authenticated;
create policy "reviews read visible or own" on public.reviews for select to authenticated
  using ((status = 'visible' and private.companion_visible(companion_id))
         or reviewer_id = (select auth.uid()) or companion_id = (select auth.uid()));

-- ---------- Financial records (payments disabled) ----------
-- Written only by a verified payment-provider integration, which does not exist yet (F-10). No client grants.
create table public.subscription_plans (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  audience text not null check (audience in ('member', 'companion')),
  label text not null,
  price_inr integer not null check (price_inr >= 0),
  period text not null check (period in ('month', 'year')),
  active boolean not null default false check (not active)
);
alter table public.subscription_plans enable row level security;
revoke all on public.subscription_plans from anon, authenticated;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('charge', 'refund', 'commission', 'payout', 'subscription')),
  amount_inr integer not null check (amount_inr >= 0),
  provider text not null,
  provider_reference text not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
alter table public.transactions enable row level security;
revoke all on public.transactions from anon, authenticated;

-- ---------- Reports can reference bookings and reviews ----------
alter table public.reports add column booking_id uuid references public.bookings (id) on delete set null;
alter table public.reports add column review_id uuid references public.reviews (id) on delete set null;
grant insert (booking_id, review_id) on public.reports to authenticated;
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in (
  'fake', 'inappropriate', 'harassment', 'underage', 'scam', 'other', 'sexual_content', 'sexual_solicitation',
  'booking_issue', 'unsafe_behaviour'));

-- ---------- Text screening covers marketplace text ----------
create or replace function private.reject_prohibited_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(new);
  t text;
begin
  t := case tg_table_name
    when 'profiles' then concat_ws(' ', r->>'display_name', r->>'bio', r->>'job', r->>'prompts')
    when 'messages' then r->>'body'
    when 'likes' then r->>'message'
    when 'creators' then concat_ws(' ', r->>'stage_name', r->>'bio')
    when 'live_streams' then r->>'title'
    when 'companion_profiles' then concat_ws(' ', r->>'headline', r->>'about', r->>'area', r->>'interests')
    when 'companion_services' then concat_ws(' ', r->>'title', r->>'description')
    when 'conversation_messages' then r->>'body'
    when 'reviews' then r->>'comment'
    when 'bookings' then concat_ws(' ', r->>'meeting_point', r->>'note')
    else null
  end;
  if private.prohibited_text(t) is not null then
    raise exception 'RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger companion_profiles_no_prohibited_text
  before insert or update of headline, about, area, interests on public.companion_profiles
  for each row execute function private.reject_prohibited_text();
create trigger companion_services_no_prohibited_text
  before insert or update of title, description on public.companion_services
  for each row execute function private.reject_prohibited_text();
create trigger conversation_messages_no_prohibited_text
  before insert on public.conversation_messages
  for each row execute function private.reject_prohibited_text();
create trigger reviews_no_prohibited_text
  before insert or update of comment on public.reviews
  for each row execute function private.reject_prohibited_text();
create trigger bookings_no_prohibited_text
  before insert or update of meeting_point, note on public.bookings
  for each row execute function private.reject_prohibited_text();

-- ================================================================
-- Functions (the only way to change bookings, reviews and status)
-- ================================================================

create function private.require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me) then
    raise exception 'Please sign in and complete your profile.' using errcode = '42501';
  end if;
  if private.is_suspended(me) then
    raise exception 'Your account is suspended.' using errcode = '42501';
  end if;
  return me;
end;
$$;
revoke execute on function private.require_member() from public;

create function private.booking_log(p_booking uuid, p_from text, p_to text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, note)
  values (p_booking, (select auth.uid()), p_from, p_to, p_note);
$$;
revoke execute on function private.booking_log(uuid, text, text, text) from public;

-- Companion pauses or resumes appearing in search (approved companions only).
create function public.companion_set_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  st text;
begin
  select status into st from public.companion_profiles where user_id = me for update;
  if st is null then raise exception 'You do not have a companion profile.' using errcode = 'P0001'; end if;
  if p_paused and st = 'approved' then
    update public.companion_profiles set status = 'paused', updated_at = now() where user_id = me;
  elsif not p_paused and st = 'paused' then
    update public.companion_profiles set status = 'approved', updated_at = now() where user_id = me;
  else
    raise exception 'Only approved companions can pause or resume.' using errcode = 'P0001';
  end if;
end;
$$;

-- Search: approved, visible companions only. Never returns exact locations.
create function public.companions_search(
  p_city text default null, p_category text default null, p_max_price integer default null,
  p_language text default null, p_interest text default null, p_verified_only boolean default false,
  p_min_rating numeric default null, p_on_date date default null, p_limit int default 30, p_offset int default 0
)
returns table (user_id uuid, display_name text, photo_path text, headline text, city text, area text,
               languages text[], interests text[], verified boolean, min_price_inr integer, categories text[],
               rating numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  base as (
    select c.*, p.display_name, p.photo_path
    from public.companion_profiles c
    join public.profiles p on p.id = c.user_id
    where c.status = 'approved'
      and c.user_id <> (select id from me)
      and not private.is_suspended(c.user_id)
      and not private.blocked_either(c.user_id)
      and (p_city is null or lower(c.city) = lower(btrim(p_city)))
      and (not coalesce(p_verified_only, false) or c.verified)
      and (p_language is null or exists (select 1 from unnest(c.languages) l where lower(l) = lower(p_language)))
      and (p_interest is null or exists (select 1 from unnest(c.interests) i where lower(i) = lower(p_interest)))
      and (p_on_date is null or exists (select 1 from public.companion_availability a
                                        where a.companion_id = c.user_id
                                          and a.weekday = extract(dow from p_on_date)))
  ),
  priced as (
    select b.user_id, min(s.price_inr) as min_price, array_agg(distinct s.category) as cats
    from base b join public.companion_services s on s.companion_id = b.user_id and s.active
    where (p_category is null or s.category = p_category)
      and (p_max_price is null or s.price_inr <= p_max_price)
    group by b.user_id
  ),
  rated as (
    select r.companion_id, round(avg(r.rating)::numeric, 1) as rating, count(*) as n
    from public.reviews r where r.status = 'visible' group by r.companion_id
  )
  select b.user_id, b.display_name, b.photo_path, b.headline, b.city, b.area, b.languages, b.interests, b.verified,
         pr.min_price, pr.cats, rt.rating, coalesce(rt.n, 0)
  from base b
  join priced pr on pr.user_id = b.user_id
  left join rated rt on rt.companion_id = b.user_id
  where p_min_rating is null or coalesce(rt.rating, 0) >= p_min_rating
  order by b.verified desc, rt.rating desc nulls last, pr.min_price asc
  limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.companions_search(text, text, integer, text, text, boolean, numeric, date, int, int) from public, anon;
grant execute on function public.companions_search(text, text, integer, text, text, boolean, numeric, date, int, int) to authenticated;

create function public.companion_rating(p_companion uuid)
returns table (rating numeric, review_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select round(avg(r.rating)::numeric, 1), count(*)
  from public.reviews r where r.companion_id = p_companion and r.status = 'visible';
$$;

-- Price is always computed here from the service; the client never sends a price.
create function private.booking_price(p_pricing text, p_price integer, p_minutes int)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_pricing = 'session' then p_price else ceil(p_price * p_minutes / 60.0)::int end;
$$;
revoke execute on function private.booking_price(text, integer, int) from public;

create function public.booking_request(
  p_service uuid, p_starts_at timestamptz, p_minutes int, p_meeting_point text, p_note text default '',
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  s public.companion_services;
  cfg public.platform_settings;
  tz text;
  existing uuid;
  b uuid;
  ends timestamptz;
begin
  if p_idempotency_key is not null then
    select id into existing from public.bookings where member_id = me and idempotency_key = p_idempotency_key;
    if existing is not null then return existing; end if;
  end if;
  select * into s from public.companion_services where id = p_service and active;
  if s.id is null or not private.companion_visible(s.companion_id) then
    raise exception 'This service is not available.' using errcode = 'P0001';
  end if;
  if s.companion_id = me then raise exception 'You cannot book yourself.' using errcode = 'P0001'; end if;
  if p_minutes is null or p_minutes < s.min_minutes or p_minutes > s.max_minutes then
    raise exception 'Choose between % and % minutes for this service.', s.min_minutes, s.max_minutes
      using errcode = 'P0001';
  end if;
  select * into cfg from public.platform_settings;
  if p_starts_at < now() + make_interval(hours => cfg.min_notice_hours) then
    raise exception 'Bookings need at least % hours notice.', cfg.min_notice_hours using errcode = 'P0001';
  end if;
  if p_starts_at > now() + make_interval(days => cfg.max_advance_days) then
    raise exception 'Bookings can be made up to % days ahead.', cfg.max_advance_days using errcode = 'P0001';
  end if;
  ends := p_starts_at + make_interval(mins => p_minutes);
  -- Must fit inside one of the companion's weekly availability windows, in that window's time zone.
  select a.timezone into tz
  from public.companion_availability a
  where a.companion_id = s.companion_id
    and a.weekday = extract(dow from (p_starts_at at time zone a.timezone))
    and extract(hour from (p_starts_at at time zone a.timezone)) * 60
        + extract(minute from (p_starts_at at time zone a.timezone)) >= a.start_minute
    and extract(hour from (p_starts_at at time zone a.timezone)) * 60
        + extract(minute from (p_starts_at at time zone a.timezone)) + p_minutes <= a.end_minute
  limit 1;
  if tz is null then
    raise exception 'The companion is not available at that time.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bookings x where x.companion_id = s.companion_id and x.status = 'accepted'
             and x.slot && tstzrange(p_starts_at, ends, '[)')) then
    raise exception 'That time is already booked. Please choose another time.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings x where x.member_id = me and x.status in ('requested', 'pending')) >= 10 then
    raise exception 'You have 10 open requests. Wait for replies or cancel some first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings x where x.member_id = me and x.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily booking request limit reached.' using errcode = 'P0001';
  end if;
  insert into public.bookings (member_id, companion_id, service_id, category, service_title, pricing, starts_at,
    ends_at, timezone, price_inr, commission_pct, meeting_point, note, cancellation_policy, idempotency_key)
  values (me, s.companion_id, s.id, s.category, s.title, s.pricing, p_starts_at, ends, tz,
    private.booking_price(s.pricing, s.price_inr, p_minutes), cfg.commission_pct, btrim(p_meeting_point),
    coalesce(btrim(p_note), ''),
    format('Free cancellation until %s hours before the start. Later cancellations are recorded as late.',
           cfg.free_cancel_hours),
    p_idempotency_key)
  returning id into b;
  perform private.booking_log(b, null, 'requested', null);
  perform private.notify(s.companion_id, 'booking_requested', 'New booking request',
    format('%s on %s', s.title, to_char(p_starts_at at time zone tz, 'Dy DD Mon, HH24:MI')), b);
  return b;
end;
$$;

-- Companion: acknowledge (pending), accept or reject.
create function public.booking_respond(p_booking uuid, p_action text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  bk public.bookings;
  next_status text;
begin
  select * into bk from public.bookings where id = p_booking for update;
  if bk.id is null or bk.companion_id is distinct from me then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;
  if bk.status not in ('requested', 'pending') then
    raise exception 'This booking can no longer be answered.' using errcode = 'P0001';
  end if;
  next_status := case p_action when 'pending' then 'pending' when 'accept' then 'accepted'
                               when 'reject' then 'rejected' end;
  if next_status is null then raise exception 'Unknown action.' using errcode = '22023'; end if;
  if next_status = 'pending' and bk.status = 'pending' then return; end if;
  if next_status = 'accepted' and bk.starts_at <= now() then
    raise exception 'This booking has already started.' using errcode = 'P0001';
  end if;
  begin
    update public.bookings set status = next_status, responded_at = now(), updated_at = now() where id = p_booking;
  exception when exclusion_violation then
    raise exception 'That time overlaps another accepted booking.' using errcode = 'P0001';
  end;
  perform private.booking_log(p_booking, bk.status, next_status, p_note);
  perform private.notify(bk.member_id, 'booking_' || next_status,
    case next_status when 'accepted' then 'Booking accepted' when 'rejected' then 'Booking declined'
                     else 'Booking request seen' end,
    format('%s · %s', bk.service_title, bk.reference), p_booking);
end;
$$;

create function public.booking_cancel(p_booking uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  bk public.bookings;
  cfg public.platform_settings;
  late boolean;
begin
  select * into bk from public.bookings where id = p_booking for update;
  if bk.id is null or (bk.member_id is distinct from me and bk.companion_id is distinct from me) then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;
  if bk.status not in ('requested', 'pending', 'accepted') or bk.starts_at <= now() then
    raise exception 'This booking can no longer be cancelled.' using errcode = 'P0001';
  end if;
  select * into cfg from public.platform_settings;
  late := bk.status = 'accepted' and bk.starts_at < now() + make_interval(hours => cfg.free_cancel_hours);
  update public.bookings set status = 'cancelled', cancelled_by = me, cancel_reason = left(p_reason, 500),
    late_cancellation = late, updated_at = now() where id = p_booking;
  perform private.booking_log(p_booking, bk.status, 'cancelled', p_reason);
  perform private.notify(case when me = bk.member_id then bk.companion_id else bk.member_id end,
    'booking_cancelled', 'Booking cancelled', format('%s · %s', bk.service_title, bk.reference), p_booking);
end;
$$;

create function public.booking_complete(p_booking uuid)
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
  update public.bookings set status = 'completed', completed_at = now(), updated_at = now() where id = p_booking;
  perform private.booking_log(p_booking, 'accepted', 'completed', null);
  perform private.notify(case when me = bk.member_id then bk.companion_id else bk.member_id end,
    'booking_completed', 'Booking completed', format('%s · %s', bk.service_title, bk.reference), p_booking);
end;
$$;

create function public.booking_dispute(p_booking uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  bk public.bookings;
begin
  if char_length(coalesce(btrim(p_reason), '')) < 10 then
    raise exception 'Please describe what happened (at least 10 characters).' using errcode = '22023';
  end if;
  select * into bk from public.bookings where id = p_booking for update;
  if bk.id is null or (bk.member_id is distinct from me and bk.companion_id is distinct from me) then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;
  if not ((bk.status = 'accepted' and bk.starts_at <= now())
          or (bk.status = 'completed' and bk.completed_at > now() - interval '7 days')) then
    raise exception 'This booking cannot be disputed.' using errcode = 'P0001';
  end if;
  update public.bookings set status = 'disputed', dispute_reason = left(p_reason, 1000), updated_at = now()
    where id = p_booking;
  perform private.booking_log(p_booking, bk.status, 'disputed', p_reason);
  perform private.notify(case when me = bk.member_id then bk.companion_id else bk.member_id end,
    'booking_disputed', 'Booking disputed', format('%s · %s', bk.service_title, bk.reference), p_booking);
end;
$$;

-- Reviews: the member of a completed booking, once, within 30 days.
create function public.review_create(p_booking uuid, p_rating int, p_comment text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  bk public.bookings;
  rid uuid;
begin
  select * into bk from public.bookings where id = p_booking;
  if bk.id is null or bk.member_id is distinct from me then
    raise exception 'Only the member who booked can review.' using errcode = '42501';
  end if;
  if bk.status <> 'completed' or bk.completed_at < now() - interval '30 days' then
    raise exception 'Reviews are for completed bookings, within 30 days.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reviews r where r.booking_id = p_booking) then
    raise exception 'You have already reviewed this booking.' using errcode = 'P0001';
  end if;
  insert into public.reviews (booking_id, reviewer_id, companion_id, rating, comment)
  values (p_booking, me, bk.companion_id, p_rating, coalesce(btrim(p_comment), ''))
  returning id into rid;
  perform private.notify(bk.companion_id, 'review_received', 'New review', format('%s stars', p_rating), p_booking);
  return rid;
end;
$$;

-- Members open a conversation with a visible companion; either side can then write.
create function public.conversation_open(p_companion uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  cid uuid;
begin
  select id into cid from public.conversations where member_id = me and companion_id = p_companion;
  if cid is not null then return cid; end if;
  if p_companion = me or not private.companion_visible(p_companion) then
    raise exception 'This companion is not available.' using errcode = 'P0001';
  end if;
  insert into public.conversations (member_id, companion_id) values (me, p_companion) returning id into cid;
  return cid;
end;
$$;

create function public.conversation_mark_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_messages m set read_at = now()
  where m.conversation_id = p_conversation and m.read_at is null and m.sender_id <> (select auth.uid())
    and private.conversation_peer(p_conversation) is not null;
$$;

create function public.appeal_suspension(p_statement text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  aid uuid;
begin
  select id into sid from public.account_suspensions where user_id = me and lifted_at is null;
  if sid is null then raise exception 'Your account is not suspended.' using errcode = 'P0001'; end if;
  insert into public.account_appeals (suspension_id, user_id, statement) values (sid, me, btrim(p_statement))
  returning id into aid;
  return aid;
end;
$$;

-- Companion earnings summary. Estimates only: no payments are collected or paid out yet.
create function public.companion_earnings()
returns table (completed_bookings bigint, booked_value_inr bigint, commission_inr bigint, estimated_earnings_inr bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*), coalesce(sum(price_inr), 0)::bigint,
         coalesce(sum(round(price_inr * commission_pct / 100)), 0)::bigint,
         coalesce(sum(price_inr - round(price_inr * commission_pct / 100)), 0)::bigint
  from public.bookings where companion_id = (select auth.uid()) and status = 'completed';
$$;

-- ---------------- Admin (moderators unless noted) ----------------
create function public.admin_review_companion(p_user uuid, p_status text, p_verified boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  if p_status not in ('pending', 'approved', 'rejected', 'suspended') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.companion_profiles
     set status = p_status, verified = coalesce(p_verified, verified), status_reason = p_reason,
         reviewed_by = (select auth.uid()), reviewed_at = now(), updated_at = now()
   where user_id = p_user;
  if not found then raise exception 'Companion not found.' using errcode = 'P0001'; end if;
  perform private.log_action('companion_' || p_status, 'companion', p_user::text, p_reason,
    jsonb_build_object('verified', p_verified));
  perform private.notify(p_user, 'companion_reviewed', 'Companion profile ' || p_status, coalesce(p_reason, ''), null);
end;
$$;

create function public.admin_list_companions(p_status text default null)
returns table (user_id uuid, display_name text, headline text, city text, status text, verified boolean,
               services bigint, completed_bookings bigint, rating numeric, open_reports bigint, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query
  select c.user_id, p.display_name, c.headline, c.city, c.status, c.verified,
         (select count(*) from public.companion_services s where s.companion_id = c.user_id),
         (select count(*) from public.bookings b where b.companion_id = c.user_id and b.status = 'completed'),
         (select round(avg(r.rating)::numeric, 1) from public.reviews r
           where r.companion_id = c.user_id and r.status = 'visible'),
         (select count(*) from public.reports rp where rp.reported_id = c.user_id),
         c.created_at
  from public.companion_profiles c join public.profiles p on p.id = c.user_id
  where p_status is null or c.status = p_status
  order by c.created_at desc limit 500;
end;
$$;

create function public.admin_list_bookings(p_status text default null)
returns setof public.bookings
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query select * from public.bookings b where p_status is null or b.status = p_status
    order by b.starts_at desc limit 500;
end;
$$;

create function public.admin_resolve_dispute(p_booking uuid, p_outcome text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bk public.bookings;
begin
  perform private.require_role('moderator');
  if p_outcome not in ('completed', 'cancelled') then
    raise exception 'Outcome must be completed or cancelled.' using errcode = '22023';
  end if;
  select * into bk from public.bookings where id = p_booking for update;
  if bk.status is distinct from 'disputed' then
    raise exception 'This booking is not disputed.' using errcode = 'P0001';
  end if;
  update public.bookings set status = p_outcome, updated_at = now(),
    completed_at = case when p_outcome = 'completed' then coalesce(completed_at, now()) else completed_at end
  where id = p_booking;
  perform private.booking_log(p_booking, 'disputed', p_outcome, p_note);
  perform private.log_action('dispute_' || p_outcome, 'booking', p_booking::text, p_note, '{}');
  perform private.notify(bk.member_id, 'dispute_resolved', 'Dispute resolved', coalesce(p_note, ''), p_booking);
  perform private.notify(bk.companion_id, 'dispute_resolved', 'Dispute resolved', coalesce(p_note, ''), p_booking);
end;
$$;

create function public.admin_set_review_status(p_review uuid, p_visible boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  update public.reviews set status = case when p_visible then 'visible' else 'hidden' end,
    hidden_reason = case when p_visible then null else p_reason end where id = p_review;
  if not found then raise exception 'Review not found.' using errcode = 'P0001'; end if;
  perform private.log_action(case when p_visible then 'review_shown' else 'review_hidden' end, 'review',
    p_review::text, p_reason, '{}');
end;
$$;

create function public.admin_list_reviews(p_status text default null)
returns setof public.reviews
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query select * from public.reviews r where p_status is null or r.status = p_status
    order by r.created_at desc limit 500;
end;
$$;

create function public.admin_suspend_account(p_user uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  if p_user = (select auth.uid()) then raise exception 'You cannot suspend yourself.' using errcode = 'P0001'; end if;
  if private.is_suspended(p_user) then return; end if;
  insert into public.account_suspensions (user_id, reason, suspended_by) values (p_user, p_reason, (select auth.uid()));
  -- Cancel the person's upcoming bookings so nobody is left waiting.
  update public.bookings set status = 'cancelled', cancelled_by = (select auth.uid()),
    cancel_reason = 'Cancelled by RentMate (account suspended)', updated_at = now()
  where (member_id = p_user or companion_id = p_user) and status in ('requested', 'pending', 'accepted')
    and starts_at > now();
  perform private.log_action('account_suspended', 'user', p_user::text, p_reason, '{}');
  perform private.notify(p_user, 'account_suspended', 'Account suspended', p_reason, null);
end;
$$;

create function public.admin_lift_suspension(p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  update public.account_suspensions set lifted_at = now(), lifted_by = (select auth.uid()), lift_note = p_note
  where user_id = p_user and lifted_at is null;
  if not found then raise exception 'This account is not suspended.' using errcode = 'P0001'; end if;
  perform private.log_action('account_restored', 'user', p_user::text, p_note, '{}');
  perform private.notify(p_user, 'account_restored', 'Account restored', coalesce(p_note, ''), null);
end;
$$;

create function public.admin_decide_account_appeal(p_appeal uuid, p_overturn boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ap public.account_appeals;
begin
  perform private.require_role('moderator');
  select * into ap from public.account_appeals where id = p_appeal and status = 'open' for update;
  if ap.id is null then raise exception 'Appeal not found or already decided.' using errcode = 'P0001'; end if;
  update public.account_appeals set status = case when p_overturn then 'overturned' else 'upheld' end,
    decision_note = p_note, decided_by = (select auth.uid()), decided_at = now() where id = p_appeal;
  if p_overturn then
    update public.account_suspensions set lifted_at = now(), lifted_by = (select auth.uid()), lift_note = p_note
    where id = ap.suspension_id and lifted_at is null;
  end if;
  perform private.log_action(case when p_overturn then 'account_appeal_overturned' else 'account_appeal_upheld' end,
    'user', ap.user_id::text, p_note, '{}');
  perform private.notify(ap.user_id, 'appeal_decided', 'Appeal decided', coalesce(p_note, ''), null);
end;
$$;

create function public.admin_list_account_appeals()
returns setof public.account_appeals
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query select * from public.account_appeals order by created_at desc limit 500;
end;
$$;

-- Admins only: commission.
create function public.admin_set_commission(p_pct numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  update public.platform_settings set commission_pct = p_pct, updated_at = now(), updated_by = (select auth.uid());
  perform private.log_action('commission_set', 'settings', 'platform', null, jsonb_build_object('pct', p_pct));
end;
$$;

-- Analytics. "booked value" is the value of completed bookings, not money received (payments are disabled).
create function public.admin_marketplace_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return jsonb_build_object(
    'members', (select count(*) from public.profiles where not is_demo),
    'companions', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.companion_profiles group by status) x),
    'bookings', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.bookings group by status) x),
    'completed_booked_value_inr', (select coalesce(sum(price_inr), 0) from public.bookings where status = 'completed'),
    'estimated_commission_inr', (select coalesce(sum(round(price_inr * commission_pct / 100)), 0) from public.bookings where status = 'completed'),
    'payments_enabled', (select payments_enabled from public.platform_settings),
    'active_suspensions', (select count(*) from public.account_suspensions where lifted_at is null),
    'open_disputes', (select count(*) from public.bookings where status = 'disputed'),
    'hidden_reviews', (select count(*) from public.reviews where status = 'hidden')
  );
end;
$$;

-- Execute rights: signed-in users only (each function checks who may do what).
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('companion_set_paused', 'companion_rating', 'booking_request',
             'booking_respond', 'booking_cancel', 'booking_complete', 'booking_dispute', 'review_create',
             'conversation_open', 'conversation_mark_read', 'appeal_suspension', 'companion_earnings',
             'admin_review_companion', 'admin_list_companions', 'admin_list_bookings', 'admin_resolve_dispute',
             'admin_set_review_status', 'admin_list_reviews', 'admin_suspend_account', 'admin_lift_suspension',
             'admin_decide_account_appeal', 'admin_list_account_appeals', 'admin_set_commission',
             'admin_marketplace_stats')
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
