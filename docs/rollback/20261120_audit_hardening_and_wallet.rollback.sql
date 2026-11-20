-- Rollback for 20261120090000_audit_hardening.sql and 20261120100000_token_wallet.sql.
-- NOT a migration. Use only with founder approval, after a database backup and after exporting public.token_ledger.
-- Apply as a new, timestamped forward migration (applied migrations are never edited). Tested against PGlite in
-- scripts/test-rollback.mjs. Undo order: wallet first, then the audit hardening.

-- ===== 20261120100000_token_wallet.sql =====
drop trigger if exists grant_registration_bonus on public.profiles;
drop function if exists private.grant_registration_bonus();
drop table if exists public.token_ledger;
drop function if exists private.ledger_is_append_only();
drop function if exists private.ledger_post(uuid, bigint, text, text, text, text, uuid);
drop table if exists public.token_wallets;
drop table if exists public.financial_flags;
drop table if exists public.metering_rates;

-- ===== 20261120090000_audit_hardening.sql =====
-- SEC-01: server timestamps
drop trigger if exists a_server_created_at on public.likes;
drop trigger if exists a_server_created_at on public.messages;
drop trigger if exists a_server_created_at on public.passes;
drop trigger if exists a_server_created_at on public.blocks;
drop trigger if exists a_server_created_at on public.reports;
drop function if exists private.server_created_at();
-- SEC-02: suspension policies and live wrappers
drop policy if exists "suspended accounts cannot like" on public.likes;
drop policy if exists "suspended accounts cannot message" on public.messages;
drop policy if exists "suspended accounts cannot apply as creators" on public.creators;
drop policy if exists "suspended accounts cannot schedule streams" on public.live_streams;
drop policy if exists "suspended accounts cannot request sessions" on public.private_sessions;
drop policy if exists "suspended accounts cannot add availability" on public.creator_availability;
drop function private.broadcast_problems(uuid, uuid);
alter function private.broadcast_problems_core(uuid, uuid) rename to broadcast_problems;
drop function private.watch_problems(uuid, uuid, text);
alter function private.watch_problems_core(uuid, uuid, text) rename to watch_problems;
drop function public.live_session_check(uuid, text);
alter function private.live_session_check_core(uuid, text) set schema public;
alter function public.live_session_check_core(uuid, text) rename to live_session_check;
revoke execute on function public.live_session_check(uuid, text) from public, anon;
grant execute on function public.live_session_check(uuid, text) to authenticated;
-- SEC-03 (privilege revocations) is intentionally not reversed: re-granting TRUNCATE or anonymous writes has no use.
-- BKG-01: restore the original booking functions from 20261119090000_marketplace.sql, verbatim.
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
