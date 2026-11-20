-- Rollback for 20261121090000_calls_and_live_rooms.sql. NOT a migration. Founder approval and a backup first; export
-- public.call_sessions (billing evidence) before using it. Apply as a new, timestamped forward migration.
-- Rehearsed by scripts/test-rollback.mjs. Apply before docs/rollback/20261120_audit_hardening_and_wallet.rollback.sql
-- if both are needed (newest first).

drop trigger if exists end_rooms_on_block on public.blocks;
drop trigger if exists end_rooms_on_suspension on public.account_suspensions;
drop trigger if exists end_calls_on_unmatch on public.matches;
drop function if exists private.on_block();
drop function if exists private.on_suspension();
drop function if exists private.on_unmatch();

drop function if exists public.live_viewer_cap();
alter table public.live_settings drop column if exists max_webrtc_viewers;

drop function if exists public.live_host_check(uuid);
drop function if exists public.live_remove_guest(uuid, uuid);
drop function if exists public.live_answer_guest_invite(uuid, boolean);
drop function if exists public.live_invite_guest(uuid, uuid);
drop table if exists public.live_guest_invites;

drop function if exists public.live_chat_mute(uuid, uuid, int);
drop function if exists public.live_chat_hide(uuid);
drop function if exists public.live_react(uuid, text);
drop trigger if exists screen_live_chat on public.live_chat_messages;
drop function if exists private.screen_live_chat();
drop table if exists public.live_reactions;
drop table if exists public.live_chat_messages; -- its policies reference live_chat_mutes
drop table if exists public.live_chat_mutes;
drop function if exists private.chat_visible(uuid);
drop function if exists private.stream_host(uuid, uuid);

drop function if exists public.live_kicks_done(text, bigint[]);
drop function if exists public.live_kicks_claim(text, int);
drop function if exists public.live_webhook_ingest(text, jsonb);
drop function if exists private.room_allowed(text, uuid);
drop function if exists private.end_calls(uuid, uuid, text);
drop function if exists private.kick(text, uuid, text);
drop table if exists private.room_kicks;
drop function if exists private.call_settle(uuid, timestamptz);
drop function if exists private.call_overlap_seconds(text, uuid, uuid, timestamptz);
drop table if exists private.room_presence;
drop table if exists private.webhook_events;

drop function if exists public.call_room(uuid);
drop function if exists public.call_join_check(uuid);
drop function if exists public.call_hangup(uuid);
drop function if exists public.call_answer(uuid, boolean);
drop function if exists public.call_start(uuid, text);
drop function if exists private.call_problems(uuid, uuid);
drop function if exists private.expire_calls();
drop table if exists public.call_sessions;

drop function if exists private.integration_secret_ok(text, text);
drop function if exists private.set_integration_secret(text, text);
drop table if exists private.integration_secrets;
drop function if exists private.livekit_enabled();
drop function if exists private.matched(uuid, uuid);
drop function if exists private.blocked_pair(uuid, uuid);

-- BKG-02: restore booking_respond from 20261119090000_marketplace.sql, verbatim.
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
