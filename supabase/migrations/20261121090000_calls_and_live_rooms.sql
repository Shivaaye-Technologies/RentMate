-- RentMate calls and live rooms (docs/RENTMATE_LIVEKIT_IMPLEMENTATION.md). Append-only.
--
--  * One-to-one voice and video calls between matched members, with a server-side state machine
--    (ringing → accepted → ended; or rejected / cancelled / missed).
--  * Presence from verified LiveKit webhooks (the API checks the webhook signature, then calls
--    live_webhook_ingest with a dedicated integration secret). Presence is the only input to call billing.
--  * Server-authoritative billing: overlap of both parties' connected time, priced from metering_rates.
--    Recorded on every call; tokens are charged only when metering_rates.call_metering_enabled is true (it is false).
--  * A kick queue: blocking, suspension, unmatching and guest removal remove people from rooms they are already in.
--  * Live chat (screened, rate limited, moderated) and reactions; multi-guest invitations; a WebRTC viewer cap.
--  * BKG-02: accepting a booking re-checks blocks; blocking cancels open bookings between the two people.

-- ===== Helpers =====
create function private.blocked_pair(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.blocks b
                 where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;
revoke execute on function private.blocked_pair(uuid, uuid) from public;

create function private.matched(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.matches m where m.user_a = least(p_a, p_b) and m.user_b = greatest(p_a, p_b));
$$;
revoke execute on function private.matched(uuid, uuid) from public;

create function private.livekit_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.live_providers p where p.key = 'livekit' and p.integration_status <> 'disabled');
$$;
revoke execute on function private.livekit_enabled() from public;

-- Secrets for server-to-database integrations (stored as SHA-256 only). Set once by the founder in the SQL editor:
--   select private.set_integration_secret('livekit_webhook', '<long random value also set as LIVE_WEBHOOK_DB_SECRET>');
create table private.integration_secrets (
  name text primary key check (name in ('livekit_webhook')),
  secret_sha256 bytea not null,
  set_at timestamptz not null default now()
);
create function private.set_integration_secret(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_secret, '')) < 32 then
    raise exception 'Integration secrets must be at least 32 characters.' using errcode = '22023';
  end if;
  insert into private.integration_secrets (name, secret_sha256) values (p_name, sha256(convert_to(p_secret, 'UTF8')))
  on conflict (name) do update set secret_sha256 = excluded.secret_sha256, set_at = now();
end;
$$;
revoke execute on function private.set_integration_secret(text, text) from public, anon, authenticated;

create function private.integration_secret_ok(p_name text, p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and exists (
    select 1 from private.integration_secrets s
    where s.name = p_name and s.secret_sha256 = sha256(convert_to(p_secret, 'UTF8')));
$$;
revoke execute on function private.integration_secret_ok(text, text) from public, anon, authenticated;

-- ===== Calls =====
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles (id) on delete cascade,
  callee_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('voice', 'video')),
  status text not null default 'ringing'
    check (status in ('ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended')),
  room_name text not null unique default ('call-' || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  end_reason text check (char_length(end_reason) <= 60),
  billable_seconds int check (billable_seconds >= 0),
  tokens_due bigint check (tokens_due >= 0),
  tokens_charged bigint check (tokens_charged >= 0),
  billing_status text not null default 'pending'
    check (billing_status in ('pending', 'not_charged', 'charged', 'insufficient', 'free')),
  constraint not_self_call check (caller_id <> callee_id)
);
create index call_sessions_caller on public.call_sessions (caller_id, created_at desc);
create index call_sessions_callee on public.call_sessions (callee_id, created_at desc);
create unique index call_sessions_one_live_per_caller on public.call_sessions (caller_id)
  where status in ('ringing', 'accepted');
alter table public.call_sessions enable row level security;
revoke all on public.call_sessions from anon, authenticated;
grant select on public.call_sessions to authenticated;
create policy "calls read own" on public.call_sessions for select to authenticated
  using ((select auth.uid()) in (caller_id, callee_id));
alter publication supabase_realtime add table public.call_sessions;

-- A ringing call that nobody answers within 45 seconds is missed.
create function private.expire_calls()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.call_sessions set status = 'missed', ended_at = now(), end_reason = 'no_answer'
  where status = 'ringing' and created_at < now() - interval '45 seconds';
$$;
revoke execute on function private.expire_calls() from public;

-- Every reason p_user may not be in this call's room right now (empty = allowed).
create function private.call_problems(p_call uuid, p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.call_sessions;
  peer uuid;
  out text[] := '{}';
begin
  select * into c from public.call_sessions where id = p_call;
  if not found or p_user is null or p_user not in (c.caller_id, c.callee_id) then return array['call_not_found']; end if;
  peer := case when p_user = c.caller_id then c.callee_id else c.caller_id end;
  -- The caller connects while it rings (so media is ready); the callee only after accepting.
  if not (c.status = 'accepted' or (c.status = 'ringing' and p_user = c.caller_id
                                     and c.created_at >= now() - interval '45 seconds')) then
    out := out || 'call_not_active'::text;
  end if;
  if private.is_suspended(p_user) then out := out || 'account_suspended'::text; end if;
  if private.is_suspended(peer) then out := out || 'participant_suspended'::text; end if;
  if private.blocked_pair(p_user, peer) then out := out || 'blocked'::text; end if;
  if not private.matched(p_user, peer) then out := out || 'not_matched'::text; end if;
  if not private.livekit_enabled() then out := out || 'provider_not_enabled'::text; end if;
  return out;
end;
$$;
revoke execute on function private.call_problems(uuid, uuid) from public;

create function public.call_start(p_callee uuid, p_mode text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  rates public.metering_rates;
  bal bigint;
  min_tokens bigint;
  c uuid;
begin
  if p_mode not in ('voice', 'video') then raise exception 'Unknown call type.' using errcode = '22023'; end if;
  if p_callee is null or p_callee = me then raise exception 'Choose someone to call.' using errcode = '22023'; end if;
  if not private.matched(me, p_callee) then
    raise exception 'You can only call people you have matched with.' using errcode = '42501';
  end if;
  if private.blocked_pair(me, p_callee) or private.is_suspended(p_callee) then
    raise exception 'This person cannot be called.' using errcode = '42501';
  end if;
  if not private.livekit_enabled() then
    raise exception 'Calls are not available right now.' using errcode = 'P0001';
  end if;
  perform private.expire_calls();
  if exists (select 1 from public.call_sessions x where x.status in ('ringing', 'accepted')
             and (me in (x.caller_id, x.callee_id) or p_callee in (x.caller_id, x.callee_id))) then
    raise exception 'One of you is already on a call.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.call_sessions x where x.caller_id = me and x.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many calls in the last hour. Please wait a little.' using errcode = 'P0001';
  end if;
  select * into rates from public.metering_rates where id = 1;
  if rates.call_metering_enabled then
    select coalesce((select balance from public.token_wallets where user_id = me), 0) into bal;
    min_tokens := case p_mode when 'voice' then rates.voice_tokens_per_minute else rates.video_tokens_per_second * 60 end;
    if bal < min_tokens then
      raise exception 'Not enough tokens for a one-minute call.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.call_sessions (caller_id, callee_id, mode) values (me, p_callee, p_mode) returning id into c;
  return c;
end;
$$;

-- Returns the call's status afterwards: accepted, rejected, or missed/cancelled/ended if it stopped ringing first.
create function public.call_answer(p_call uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  c public.call_sessions;
begin
  perform private.expire_calls();
  select * into c from public.call_sessions where id = p_call for update;
  if not found or c.callee_id is distinct from me then raise exception 'Call not found.' using errcode = '42501'; end if;
  if c.status <> 'ringing' then return c.status; end if;
  if p_accept then
    if private.blocked_pair(c.caller_id, me) or private.is_suspended(c.caller_id) then
      raise exception 'This call cannot be connected.' using errcode = '42501';
    end if;
    update public.call_sessions set status = 'accepted', answered_at = now() where id = p_call;
  else
    update public.call_sessions set status = 'rejected', ended_at = now(), ended_by = me, end_reason = 'declined'
    where id = p_call;
  end if;
  return case when p_accept then 'accepted' else 'rejected' end;
end;
$$;

-- Hang up: cancels (caller, while ringing), declines (callee, while ringing) or ends (accepted). Returns the room so
-- the API can close it for both people. Suspended members can always hang up.
create function public.call_hangup(p_call uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  c public.call_sessions;
begin
  select * into c from public.call_sessions where id = p_call for update;
  if not found or me is null or me not in (c.caller_id, c.callee_id) then
    raise exception 'Call not found.' using errcode = '42501';
  end if;
  if c.status = 'ringing' then
    update public.call_sessions set status = case when me = c.caller_id then 'cancelled' else 'rejected' end,
      ended_at = now(), ended_by = me, end_reason = case when me = c.caller_id then 'cancelled' else 'declined' end
    where id = p_call;
  elsif c.status = 'accepted' then
    update public.call_sessions set status = 'ended', ended_at = now(), ended_by = me, end_reason = 'hung_up'
    where id = p_call;
  end if;
  return c.room_name;
end;
$$;

create function public.call_join_check(p_call uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.expire_calls();
  return private.call_problems(p_call, (select auth.uid()));
end;
$$;

create function public.call_room(p_call uuid)
returns table (room_name text, mode text, status text, caller_id uuid, callee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select c.room_name, c.mode, c.status, c.caller_id, c.callee_id from public.call_sessions c
  where c.id = p_call and (select auth.uid()) in (c.caller_id, c.callee_id);
$$;
revoke execute on function public.call_start(uuid, text) from public, anon;
revoke execute on function public.call_answer(uuid, boolean) from public, anon;
revoke execute on function public.call_hangup(uuid) from public, anon;
revoke execute on function public.call_join_check(uuid) from public, anon;
revoke execute on function public.call_room(uuid) from public, anon;
grant execute on function public.call_start(uuid, text) to authenticated;
grant execute on function public.call_answer(uuid, boolean) to authenticated;
grant execute on function public.call_hangup(uuid) to authenticated;
grant execute on function public.call_join_check(uuid) to authenticated;
grant execute on function public.call_room(uuid) to authenticated;

-- ===== Presence (from verified webhooks only) and billing =====
create table private.webhook_events (
  id text primary key check (char_length(id) between 1 and 120),
  event text not null,
  room_name text,
  identity text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table private.room_presence (
  id bigint generated always as identity primary key,
  room_name text not null,
  identity uuid not null,
  joined_at timestamptz not null,
  left_at timestamptz
);
create index room_presence_open on private.room_presence (room_name, identity) where left_at is null;

-- Seconds during which both people were connected. Open intervals end at p_until.
create function private.call_overlap_seconds(p_room text, p_a uuid, p_b uuid, p_until timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(greatest(0, extract(epoch from
           least(coalesce(a.left_at, p_until), coalesce(b.left_at, p_until)) - greatest(a.joined_at, b.joined_at)))), 0)::int
  from private.room_presence a
  join private.room_presence b on b.room_name = a.room_name and b.identity = p_b
  where a.room_name = p_room and a.identity = p_a;
$$;
revoke execute on function private.call_overlap_seconds(text, uuid, uuid, timestamptz) from public;

-- Settles a call once its room has finished. Idempotent: a settled call is never settled again.
create function private.call_settle(p_call uuid, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.call_sessions;
  rates public.metering_rates;
  secs int;
  due bigint;
  bal bigint;
  charged bigint := 0;
  st text;
begin
  select * into c from public.call_sessions where id = p_call for update;
  if not found or c.billing_status <> 'pending' then return; end if;
  select * into rates from public.metering_rates where id = 1;
  secs := private.call_overlap_seconds(c.room_name, c.caller_id, c.callee_id, p_until);
  due := case c.mode when 'voice' then ceil(secs / 60.0)::bigint * rates.voice_tokens_per_minute
                     else secs::bigint * rates.video_tokens_per_second end;
  if due = 0 then
    st := 'free';
  elsif not rates.call_metering_enabled then
    st := 'not_charged';
  else
    select coalesce((select balance from public.token_wallets where user_id = c.caller_id), 0) into bal;
    charged := least(due, bal);
    if charged > 0 then
      perform private.ledger_post(c.caller_id, -charged, case c.mode when 'voice' then 'voice_call' else 'video_call' end,
                                  'call', c.id::text, 'call:' || c.id);
    end if;
    st := case when charged = due then 'charged' else 'insufficient' end;
  end if;
  update public.call_sessions set billable_seconds = secs, tokens_due = due, tokens_charged = charged,
    billing_status = st, status = case when status in ('ringing', 'accepted') then 'ended' else status end,
    ended_at = coalesce(ended_at, p_until), end_reason = coalesce(end_reason, 'room_finished')
  where id = p_call;
end;
$$;
revoke execute on function private.call_settle(uuid, timestamptz) from public;

-- ===== Kick queue =====
create table private.room_kicks (
  id bigint generated always as identity primary key,
  room_name text not null,
  identity uuid not null,
  reason text not null check (char_length(reason) <= 60),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz
);
create index room_kicks_pending on private.room_kicks (created_at) where done_at is null;

create function private.kick(p_room text, p_identity uuid, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.room_kicks (room_name, identity, reason) values (p_room, p_identity, p_reason);
$$;
revoke execute on function private.kick(text, uuid, text) from public;

-- Ends a person's calls with someone (or with everyone when p_peer is null) and removes both from the rooms.
create function private.end_calls(p_user uuid, p_peer uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.call_sessions;
begin
  for c in select * from public.call_sessions x
           where x.status in ('ringing', 'accepted') and p_user in (x.caller_id, x.callee_id)
             and (p_peer is null or p_peer in (x.caller_id, x.callee_id)) for update loop
    update public.call_sessions set status = 'ended', ended_at = now(), end_reason = p_reason where id = c.id;
    perform private.kick(c.room_name, c.caller_id, p_reason);
    perform private.kick(c.room_name, c.callee_id, p_reason);
  end loop;
end;
$$;
revoke execute on function private.end_calls(uuid, uuid, text) from public;

-- Blocking: end calls between the two, remove each from the other's live room, cancel open bookings (BKG-02).
create function private.on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare p record;
begin
  perform private.end_calls(new.blocker_id, new.blocked_id, 'blocked');
  -- In a room hosted (or co-hosted) by one of them, the other one leaves.
  for p in select pr.room_name, pr.identity from private.room_presence pr
           join public.live_streams s on s.room_name = pr.room_name
           where pr.left_at is null and pr.identity in (new.blocker_id, new.blocked_id)
             and ((s.creator_id = new.blocker_id or new.blocker_id = any (s.participants)) and pr.identity = new.blocked_id
               or (s.creator_id = new.blocked_id or new.blocked_id = any (s.participants)) and pr.identity = new.blocker_id) loop
    perform private.kick(p.room_name, p.identity, 'blocked');
  end loop;
  update public.bookings b set status = 'cancelled', cancelled_by = new.blocker_id, cancel_reason = 'Blocked',
    late_cancellation = false, updated_at = now()
  where ((b.member_id = new.blocker_id and b.companion_id = new.blocked_id)
      or (b.member_id = new.blocked_id and b.companion_id = new.blocker_id))
    and (b.status in ('requested', 'pending') or (b.status = 'accepted' and b.starts_at > now()));
  return new;
end;
$$;
revoke execute on function private.on_block() from public;
create trigger end_rooms_on_block after insert on public.blocks for each row execute function private.on_block();

-- Suspension: end every call and leave every room immediately.
create function private.on_suspension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare p record;
begin
  if new.lifted_at is not null then return new; end if;
  perform private.end_calls(new.user_id, null, 'suspended');
  for p in select pr.room_name from private.room_presence pr where pr.identity = new.user_id and pr.left_at is null loop
    perform private.kick(p.room_name, new.user_id, 'suspended');
  end loop;
  return new;
end;
$$;
revoke execute on function private.on_suspension() from public;
create trigger end_rooms_on_suspension after insert on public.account_suspensions
  for each row execute function private.on_suspension();

-- Unmatching ends calls between the two.
create function private.on_unmatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.end_calls(old.user_a, old.user_b, 'unmatched');
  return old;
end;
$$;
revoke execute on function private.on_unmatch() from public;
create trigger end_calls_on_unmatch after delete on public.matches for each row execute function private.on_unmatch();

-- May this identity still be in this room? Used on every participant_joined webhook.
create function private.room_allowed(p_room text, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.call_sessions;
  s public.live_streams;
  ps public.private_sessions;
begin
  if p_user is null then return false; end if;
  select * into c from public.call_sessions where room_name = p_room;
  if found then return cardinality(private.call_problems(c.id, p_user)) = 0; end if;
  select * into s from public.live_streams where room_name = p_room;
  if found then
    if private.is_suspended(p_user) or s.status not in ('scheduled', 'live')
       or (select emergency_stop from public.live_settings where id = 1) then return false; end if;
    if p_user = s.creator_id or p_user = any (s.participants) then return true; end if;
    return s.status = 'live' and not private.blocked_pair(p_user, s.creator_id)
       and not exists (select 1 from unnest(s.participants) g where private.blocked_pair(p_user, g))
       and not private.is_suspended(s.creator_id);
  end if;
  select * into ps from public.private_sessions where room_name = p_room;
  if found then
    return p_user in (ps.creator_id, ps.viewer_id) and ps.status in ('accepted', 'active')
       and not private.is_suspended(ps.creator_id) and not private.is_suspended(ps.viewer_id)
       and not private.blocked_pair(ps.creator_id, ps.viewer_id);
  end if;
  return false; -- unknown room
end;
$$;
revoke execute on function private.room_allowed(text, uuid) from public;

-- Ingests one LiveKit webhook event that the API has already verified (signature and body hash).
-- Idempotent by event id. Returns {"kick": true} when the joining identity must be removed at once.
create function public.live_webhook_ingest(p_secret text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev text := p_event ->> 'event';
  ev_id text := p_event ->> 'id';
  room text := p_event #>> '{room,name}';
  ident text := p_event #>> '{participant,identity}';
  uid uuid;
  at timestamptz := coalesce(to_timestamp(nullif(p_event ->> 'createdAt', '')::bigint), now());
  c public.call_sessions;
begin
  if not private.integration_secret_ok('livekit_webhook', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if ev_id is null or ev is null then raise exception 'Invalid event.' using errcode = '22023'; end if;
  insert into private.webhook_events (id, event, room_name, identity, occurred_at)
  values (ev_id, ev, room, ident, at) on conflict (id) do nothing;
  if not found then return jsonb_build_object('duplicate', true, 'kick', false); end if;
  if ident ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then uid := ident::uuid; end if;

  if ev = 'participant_joined' then
    if uid is null or not private.room_allowed(room, uid) then
      return jsonb_build_object('duplicate', false, 'kick', true);
    end if;
    insert into private.room_presence (room_name, identity, joined_at) values (room, uid, at);
  elsif ev = 'participant_left' and uid is not null then
    update private.room_presence set left_at = greatest(at, joined_at)
    where id = (select id from private.room_presence where room_name = room and identity = uid and left_at is null
                order by joined_at desc limit 1);
  elsif ev = 'room_finished' then
    update private.room_presence set left_at = greatest(at, joined_at) where room_name = room and left_at is null;
    select * into c from public.call_sessions where room_name = room;
    if found then perform private.call_settle(c.id, at); end if;
  end if;
  return jsonb_build_object('duplicate', false, 'kick', false);
end;
$$;

create function public.live_kicks_claim(p_secret text, p_limit int default 50)
returns table (id bigint, room_name text, identity uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.integration_secret_ok('livekit_webhook', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query
  update private.room_kicks k set claimed_at = now()
  where k.id in (select x.id from private.room_kicks x
                 where x.done_at is null and (x.claimed_at is null or x.claimed_at < now() - interval '1 minute')
                 order by x.id limit least(greatest(p_limit, 1), 200) for update skip locked)
  returning k.id, k.room_name, k.identity, k.reason;
end;
$$;

create function public.live_kicks_done(p_secret text, p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.integration_secret_ok('livekit_webhook', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update private.room_kicks set done_at = now() where id = any (p_ids) and done_at is null;
end;
$$;
-- The API calls these with the publishable key (it holds no privileged database key); the secret is the guard.
revoke execute on function public.live_webhook_ingest(text, jsonb) from public;
revoke execute on function public.live_kicks_claim(text, int) from public;
revoke execute on function public.live_kicks_done(text, bigint[]) from public;
grant execute on function public.live_webhook_ingest(text, jsonb) to anon, authenticated;
grant execute on function public.live_kicks_claim(text, int) to anon, authenticated;
grant execute on function public.live_kicks_done(text, bigint[]) to anon, authenticated;

-- ===== Live chat and reactions =====
create table public.live_chat_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid
);
create index live_chat_stream_time on public.live_chat_messages (stream_id, created_at);
create table public.live_chat_mutes (
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_until timestamptz not null,
  muted_by uuid,
  primary key (stream_id, user_id)
);
create table public.live_reactions (
  id bigint generated always as identity primary key,
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('heart', 'clap', 'laugh', 'wow', 'fire')),
  created_at timestamptz not null default now()
);
create index live_reactions_stream_time on public.live_reactions (stream_id, created_at);

create function private.stream_host(p_stream uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.live_streams s where s.id = p_stream
                 and (s.creator_id = p_user or p_user = any (s.participants)));
$$;
revoke execute on function private.stream_host(uuid, uuid) from public;
grant execute on function private.stream_host(uuid, uuid) to authenticated; -- used inside RLS policies

-- Who may see and take part in a stream's chat: its hosts, moderators, and viewers allowed in the room.
create function private.chat_visible(p_stream uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.stream_host(p_stream, (select auth.uid())) or private.has_role('moderator')
      or private.room_allowed((select room_name from public.live_streams where id = p_stream), (select auth.uid()));
$$;
revoke execute on function private.chat_visible(uuid) from public;
grant execute on function private.chat_visible(uuid) to authenticated;

alter table public.live_chat_messages enable row level security;
alter table public.live_chat_mutes enable row level security;
alter table public.live_reactions enable row level security;
revoke all on public.live_chat_messages, public.live_chat_mutes, public.live_reactions from anon, authenticated;
grant select on public.live_chat_messages, public.live_reactions to authenticated;
grant insert (stream_id, sender_id, body) on public.live_chat_messages to authenticated;
grant select on public.live_chat_mutes to authenticated;
create policy "chat read" on public.live_chat_messages for select to authenticated
  using (private.chat_visible(stream_id) and not private.blocked_either(sender_id)
         and (hidden_at is null or sender_id = (select auth.uid()) or private.stream_host(stream_id, (select auth.uid()))
              or private.has_role('moderator')));
create policy "chat post" on public.live_chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.chat_visible(stream_id)
              and not private.is_suspended((select auth.uid()))
              and not exists (select 1 from public.live_chat_mutes m where m.stream_id = live_chat_messages.stream_id
                              and m.user_id = (select auth.uid()) and m.muted_until > now()));
create policy "mutes read own or hosted" on public.live_chat_mutes for select to authenticated
  using (user_id = (select auth.uid()) or private.stream_host(stream_id, (select auth.uid())) or private.has_role('moderator'));
create policy "reactions read" on public.live_reactions for select to authenticated using (private.chat_visible(stream_id));

create function private.screen_live_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.prohibited_text(new.body) is not null then
    raise exception 'RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.'
      using errcode = '23514';
  end if;
  if current_user in ('anon', 'authenticated') then new.created_at := now(); end if;
  if (select count(*) from public.live_chat_messages m where m.sender_id = new.sender_id and m.stream_id = new.stream_id
      and m.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'You are sending messages too fast.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function private.screen_live_chat() from public;
create trigger screen_live_chat before insert on public.live_chat_messages
  for each row execute function private.screen_live_chat();
alter publication supabase_realtime add table public.live_chat_messages;
alter publication supabase_realtime add table public.live_reactions;

create function public.live_react(p_stream uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare me uuid := private.require_member();
begin
  if p_kind is null or p_kind not in ('heart', 'clap', 'laugh', 'wow', 'fire') then
    raise exception 'Unknown reaction.' using errcode = '23514';
  end if;
  if not private.chat_visible(p_stream) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if exists (select 1 from public.live_reactions r where r.user_id = me and r.stream_id = p_stream
             and r.created_at > now() - interval '2 seconds') then
    return; -- quietly drop rapid repeats
  end if;
  insert into public.live_reactions (stream_id, user_id, kind) values (p_stream, me, p_kind);
end;
$$;

-- Hosts and moderators: hide a message, or mute someone in this stream's chat.
create function public.live_chat_hide(p_message uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare m public.live_chat_messages;
begin
  select * into m from public.live_chat_messages where id = p_message;
  if not found or not (private.stream_host(m.stream_id, (select auth.uid())) or private.has_role('moderator')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.live_chat_messages set hidden_at = now(), hidden_by = (select auth.uid()) where id = p_message;
  perform private.log_action('live_chat_hidden', 'live_chat_message', p_message::text, null,
                             jsonb_build_object('stream', m.stream_id, 'sender', m.sender_id));
end;
$$;

create function public.live_chat_mute(p_stream uuid, p_user uuid, p_minutes int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.stream_host(p_stream, (select auth.uid())) or private.has_role('moderator')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 1440 then
    raise exception 'Mute for 1 to 1440 minutes.' using errcode = '22023';
  end if;
  if private.stream_host(p_stream, p_user) then raise exception 'Hosts cannot be muted.' using errcode = '22023'; end if;
  insert into public.live_chat_mutes (stream_id, user_id, muted_until, muted_by)
  values (p_stream, p_user, now() + make_interval(mins => p_minutes), (select auth.uid()))
  on conflict (stream_id, user_id) do update set muted_until = excluded.muted_until, muted_by = excluded.muted_by;
  perform private.log_action('live_chat_muted', 'profile', p_user::text, null,
                             jsonb_build_object('stream', p_stream, 'minutes', p_minutes));
end;
$$;

-- ===== Multi-guest =====
create table public.live_guest_invites (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  guest_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'removed', 'cancelled')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (stream_id, guest_id)
);
alter table public.live_guest_invites enable row level security;
revoke all on public.live_guest_invites from anon, authenticated;
grant select on public.live_guest_invites to authenticated;
create policy "invites read own or hosted" on public.live_guest_invites for select to authenticated
  using (guest_id = (select auth.uid())
         or exists (select 1 from public.live_streams s where s.id = stream_id and s.creator_id = (select auth.uid())));
alter publication supabase_realtime add table public.live_guest_invites;

create function public.live_invite_guest(p_stream uuid, p_guest uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  s public.live_streams;
  inv uuid;
begin
  select * into s from public.live_streams where id = p_stream for update;
  if not found or s.creator_id <> me then raise exception 'Only the creator can invite guests.' using errcode = '42501'; end if;
  if s.status not in ('scheduled', 'live') then raise exception 'This stream has ended.' using errcode = 'P0001'; end if;
  if p_guest = me or p_guest = any (s.participants) then raise exception 'Already a host.' using errcode = '22023'; end if;
  if not exists (select 1 from public.creators c where c.user_id = p_guest and c.status = 'approved') then
    raise exception 'Guests must be approved creators.' using errcode = '22023';
  end if;
  if private.blocked_pair(me, p_guest) or private.is_suspended(p_guest) then
    raise exception 'This person cannot be invited.' using errcode = '42501';
  end if;
  if cardinality(s.participants)
     + (select count(*) from public.live_guest_invites i where i.stream_id = p_stream and i.status = 'invited') >= 4 then
    raise exception 'A stream can have at most 4 guests.' using errcode = 'P0001';
  end if;
  insert into public.live_guest_invites (stream_id, guest_id) values (p_stream, p_guest)
  on conflict (stream_id, guest_id) do update set status = 'invited', created_at = now(), answered_at = null
  returning id into inv;
  return inv;
end;
$$;

create function public.live_answer_guest_invite(p_invite uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_member();
  i public.live_guest_invites;
  s public.live_streams;
begin
  select * into i from public.live_guest_invites where id = p_invite for update;
  if not found or i.guest_id <> me then raise exception 'Invitation not found.' using errcode = '42501'; end if;
  if i.status <> 'invited' then raise exception 'This invitation is no longer open.' using errcode = 'P0001'; end if;
  if not p_accept then
    update public.live_guest_invites set status = 'declined', answered_at = now() where id = p_invite;
    return;
  end if;
  select * into s from public.live_streams where id = i.stream_id for update;
  if s.status not in ('scheduled', 'live') then raise exception 'This stream has ended.' using errcode = 'P0001'; end if;
  if private.blocked_pair(s.creator_id, me) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update public.live_streams set participants = array_append(participants, me) where id = s.id;
  update public.live_guest_invites set status = 'accepted', answered_at = now() where id = p_invite;
end;
$$;

create function public.live_remove_guest(p_stream uuid, p_guest uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.live_streams;
begin
  select * into s from public.live_streams where id = p_stream for update;
  if not found or not (s.creator_id = (select auth.uid()) or private.has_role('moderator')) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.live_streams set participants = array_remove(participants, p_guest) where id = p_stream;
  update public.live_guest_invites set status = case when status = 'invited' then 'cancelled' else 'removed' end,
    answered_at = now() where stream_id = p_stream and guest_id = p_guest and status in ('invited', 'accepted');
  perform private.kick(s.room_name, p_guest, 'removed_by_host');
  perform private.log_action('live_guest_removed', 'profile', p_guest::text, null, jsonb_build_object('stream', p_stream));
end;
$$;

-- For the API: may the caller control this stream's room (mute guests)? Hosts' creator or moderators only.
create function public.live_host_check(p_stream uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.live_streams s where s.id = p_stream and s.creator_id = (select auth.uid())
                 and not private.is_suspended((select auth.uid())))
      or private.has_role('moderator');
$$;

revoke execute on function public.live_react(uuid, text) from public, anon;
revoke execute on function public.live_chat_hide(uuid) from public, anon;
revoke execute on function public.live_chat_mute(uuid, uuid, int) from public, anon;
revoke execute on function public.live_invite_guest(uuid, uuid) from public, anon;
revoke execute on function public.live_answer_guest_invite(uuid, boolean) from public, anon;
revoke execute on function public.live_remove_guest(uuid, uuid) from public, anon;
revoke execute on function public.live_host_check(uuid) from public, anon;
grant execute on function public.live_react(uuid, text) to authenticated;
grant execute on function public.live_chat_hide(uuid) to authenticated;
grant execute on function public.live_chat_mute(uuid, uuid, int) to authenticated;
grant execute on function public.live_invite_guest(uuid, uuid) to authenticated;
grant execute on function public.live_answer_guest_invite(uuid, boolean) to authenticated;
grant execute on function public.live_remove_guest(uuid, uuid) to authenticated;
grant execute on function public.live_host_check(uuid) to authenticated;

-- ===== Viewer cap (WebRTC) =====
-- Beyond this many WebRTC viewers the API refuses new viewers ("stream_full") instead of overloading the SFU.
-- Larger audiences need LiveKit Cloud scaling or HLS egress (docs/RENTMATE_BROADCAST_ARCHITECTURE.md).
alter table public.live_settings add column max_webrtc_viewers int not null default 300
  check (max_webrtc_viewers between 1 and 100000);
create function public.live_viewer_cap()
returns int
language sql
stable
security definer
set search_path = ''
as $$ select max_webrtc_viewers from public.live_settings where id = 1; $$;
revoke execute on function public.live_viewer_cap() from public, anon;
grant execute on function public.live_viewer_cap() to authenticated;

-- ===== BKG-02: accepting re-checks blocks =====
create or replace function public.booking_respond(p_booking uuid, p_action text, p_note text default null)
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
  -- BKG-02: never accept a booking with someone either person has blocked, or who is suspended.
  if next_status = 'accepted' and (private.blocked_pair(me, bk.member_id) or private.is_suspended(bk.member_id)) then
    raise exception 'This booking cannot be accepted.' using errcode = 'P0001';
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
