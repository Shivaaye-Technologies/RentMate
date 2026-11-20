-- RentMate deep audit fixes (see docs/RENTMATE_SECURITY_FINDINGS.md). Append-only; changes no data except replacing
-- client-supplied timestamps on new rows. Safe to apply to a database that already has every earlier migration.
--
-- SEC-01  Clients could set created_at on likes, messages, passes, blocks and reports. The write limits count rows by
--         created_at, so back-dated rows bypassed them (verified: 350 likes against 300/day, 40 messages against
--         20/min) and messages could be dated in the future. created_at is now always the server's clock for API roles.
-- SEC-02  Account suspension only applied to the marketplace. Suspended accounts could still send dating messages,
--         like people, apply as creators, schedule streams, request private sessions and pass live checks.
-- BKG-01  Unanswered requests whose start time had passed counted towards the 10-open-requests limit forever and could
--         not be withdrawn, locking a member out of booking. A concurrent retry with the same idempotency key raised a
--         raw duplicate-key error instead of returning the existing booking.
-- SEC-03  Least privilege: API roles keep the TRUNCATE / REFERENCES / TRIGGER table rights Supabase grants by default,
--         and anon keeps write rights on dating tables. RLS already blocks them; this removes the rights themselves.

-- ===== SEC-01: server-owned timestamps =====
create function private.server_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only requests from the Data API (anon / authenticated) are re-stamped. Migrations, seeds and service jobs keep
  -- the timestamps they set on purpose.
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.created_at := now();
    else
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.server_created_at() from public;

-- "a_" sorts first so every other BEFORE trigger sees the server timestamp.
create trigger a_server_created_at before insert on public.likes
  for each row execute function private.server_created_at();
create trigger a_server_created_at before insert on public.messages
  for each row execute function private.server_created_at();
create trigger a_server_created_at before insert on public.passes
  for each row execute function private.server_created_at();
create trigger a_server_created_at before insert or update on public.blocks
  for each row execute function private.server_created_at();
create trigger a_server_created_at before insert on public.reports
  for each row execute function private.server_created_at();

-- ===== SEC-02: suspension applies everywhere a member acts =====
-- Restrictive policies are ANDed with the existing permissive ones. Reporting, blocking, unmatching, appeals, reading
-- one's own data and deleting the account stay available to suspended members.
create policy "suspended accounts cannot like" on public.likes as restrictive for insert to authenticated
  with check (not private.is_suspended((select auth.uid())));
create policy "suspended accounts cannot message" on public.messages as restrictive for insert to authenticated
  with check (not private.is_suspended((select auth.uid())));
create policy "suspended accounts cannot apply as creators" on public.creators as restrictive for insert
  to authenticated with check (not private.is_suspended((select auth.uid())));
create policy "suspended accounts cannot schedule streams" on public.live_streams as restrictive for insert
  to authenticated with check (not private.is_suspended((select auth.uid())));
create policy "suspended accounts cannot request sessions" on public.private_sessions as restrictive for insert
  to authenticated with check (not private.is_suspended((select auth.uid())));
create policy "suspended accounts cannot add availability" on public.creator_availability as restrictive for insert
  to authenticated with check (not private.is_suspended((select auth.uid())));

-- Live checks: every token, start and listing decision goes through these two functions (and live_session_check).
alter function private.broadcast_problems(uuid, uuid) rename to broadcast_problems_core;
alter function private.watch_problems(uuid, uuid, text) rename to watch_problems_core;

create function private.broadcast_problems(p_stream uuid, p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.broadcast_problems_core(p_stream, p_user)
         || case when private.is_suspended(p_user) then array['account_suspended'] else '{}'::text[] end;
$$;
revoke execute on function private.broadcast_problems(uuid, uuid) from public;

create function private.watch_problems(p_stream uuid, p_user uuid, p_viewer_country text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.watch_problems_core(p_stream, p_user, p_viewer_country)
         || case when private.is_suspended(p_user) then array['account_suspended'] else '{}'::text[] end
         -- A suspended creator's streams disappear for viewers.
         || case when exists (select 1 from public.live_streams s
                              where s.id = p_stream and s.creator_id <> p_user and private.is_suspended(s.creator_id))
                 then array['stream_not_found'] else '{}'::text[] end;
$$;
revoke execute on function private.watch_problems(uuid, uuid, text) from public;

alter function public.live_session_check(uuid, text) rename to live_session_check_core;
alter function public.live_session_check_core(uuid, text) set schema private;
revoke execute on function private.live_session_check_core(uuid, text) from public, anon, authenticated;

create function public.live_session_check(p_session uuid, p_viewer_country text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select private.live_session_check_core(p_session, p_viewer_country)
         || case when private.is_suspended((select auth.uid())) then array['account_suspended'] else '{}'::text[] end
         || case when exists (
              select 1 from public.private_sessions ps
              where ps.id = p_session
                and private.is_suspended(case when ps.creator_id = (select auth.uid()) then ps.viewer_id
                                              else ps.creator_id end))
            then array['participant_suspended'] else '{}'::text[] end;
$$;
revoke execute on function public.live_session_check(uuid, text) from public, anon;
grant execute on function public.live_session_check(uuid, text) to authenticated;

-- ===== BKG-01: stale requests and idempotent retries =====
create or replace function public.booking_request(
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
  -- Only requests that can still be answered count (BKG-01).
  if (select count(*) from public.bookings x
      where x.member_id = me and x.status in ('requested', 'pending') and x.starts_at > now()) >= 10 then
    raise exception 'You have 10 open requests. Wait for replies or cancel some first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings x where x.member_id = me and x.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily booking request limit reached.' using errcode = 'P0001';
  end if;
  begin
    insert into public.bookings (member_id, companion_id, service_id, category, service_title, pricing, starts_at,
      ends_at, timezone, price_inr, commission_pct, meeting_point, note, cancellation_policy, idempotency_key)
    values (me, s.companion_id, s.id, s.category, s.title, s.pricing, p_starts_at, ends, tz,
      private.booking_price(s.pricing, s.price_inr, p_minutes), cfg.commission_pct, btrim(p_meeting_point),
      coalesce(btrim(p_note), ''),
      format('Free cancellation until %s hours before the start. Later cancellations are recorded as late.',
             cfg.free_cancel_hours),
      p_idempotency_key)
    returning id into b;
  exception when unique_violation then
    -- A concurrent retry with the same key won the race: return its booking (BKG-01).
    select id into existing from public.bookings where member_id = me and idempotency_key = p_idempotency_key;
    if existing is null then raise; end if;
    return existing;
  end;
  perform private.booking_log(b, null, 'requested', null);
  perform private.notify(s.companion_id, 'booking_requested', 'New booking request',
    format('%s on %s', s.title, to_char(p_starts_at at time zone tz, 'Dy DD Mon, HH24:MI')), b);
  return b;
end;
$$;

create or replace function public.booking_cancel(p_booking uuid, p_reason text default null)
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
  -- Unanswered requests can always be withdrawn, even after their start time (BKG-01). Accepted bookings can only be
  -- cancelled before they start; after that the outcome is completion or a dispute.
  if not (bk.status in ('requested', 'pending') or (bk.status = 'accepted' and bk.starts_at > now())) then
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

-- ===== SEC-03: least privilege for API roles =====
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
    execute format('revoke insert, update, delete on public.%I from anon', t.relname);
  end loop;
end $$;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;
