-- Rollback for 20261126090000_booking_token_holds.sql.
-- NOT a migration. Run only on a database where no booking token activity has happened (sandbox data included):
-- the wallet ledger is append-only, so hold and refund entries cannot be removed. The guard below refuses otherwise.
do $$
begin
  if exists (select 1 from public.token_ledger where reason in ('booking_hold', 'booking_refund', 'sandbox_grant'))
     or exists (select 1 from public.booking_token_holds) then
    raise exception 'Booking token activity exists; this rollback would lose accounting records. Nothing was changed.';
  end if;
end $$;

alter publication supabase_realtime drop table public.booking_messages;
drop trigger if exists booking_token_lifecycle on public.bookings;
drop trigger if exists freeze_booking_tokens_on_report on public.reports;

drop function if exists public.booking_token_quote(uuid, int);
drop function if exists public.booking_request_with_tokens(uuid, timestamptz, int, text, text, text);
drop function if exists public.booking_expire_stale();
drop function if exists public.my_booking_tokens(uuid);
drop function if exists public.my_creator_booking_earnings();
drop function if exists public.admin_set_booking_token_sandbox(boolean);
drop function if exists public.admin_grant_sandbox_tokens(uuid, int, text);
drop function if exists public.admin_resolve_booking_tokens(uuid, text, text);
drop function if exists public.admin_booking_token_reconciliation();

drop table if exists public.booking_messages;
drop table if exists public.booking_completion_confirmations;
drop table if exists public.platform_commission_entries;
drop table if exists public.creator_booking_earnings;
drop table if exists public.booking_token_hold_events;
drop table if exists public.booking_token_holds;
drop table if exists public.booking_token_quotes;
drop table if exists public.booking_token_settings;

drop function if exists private.booking_token_lifecycle();
drop function if exists private.freeze_on_booking_report();
drop function if exists private.booking_system_message(uuid, text);
drop function if exists private.screen_booking_message();
drop function if exists private.booking_chat_open(uuid);
drop function if exists private.booking_pair_blocked(uuid);
drop function if exists private.booking_hold_freeze(uuid, text);
drop function if exists private.booking_hold_settle(uuid, boolean, text);
drop function if exists private.booking_hold_release(uuid, text);
drop function if exists private.token_quote(text, integer, int, numeric);
drop function if exists private.booking_tokens_allowed(uuid, uuid);
drop function if exists private.booking_participant(uuid);
drop function if exists private.accounting_append_only();

-- Expired requests go back to the nearest earlier status before the constraint is narrowed.
update public.bookings set status = 'cancelled', cancel_reason = coalesce(cancel_reason, 'Expired')
where status = 'expired';
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check check (status in (
  'requested', 'pending', 'accepted', 'rejected', 'cancelled', 'completed', 'disputed'));
alter table public.token_ledger drop constraint token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check check (reason in (
  'registration_bonus', 'like', 'message', 'voice_call', 'video_call', 'admin_adjustment', 'refund'));
alter table public.companion_services drop column if exists price_tokens;

-- booking_complete as defined by 20261119090000_marketplace.sql.
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
  update public.bookings set status = 'completed', completed_at = now(), updated_at = now() where id = p_booking;
  perform private.booking_log(p_booking, 'accepted', 'completed', null);
  perform private.notify(case when me = bk.member_id then bk.companion_id else bk.member_id end,
    'booking_completed', 'Booking completed', format('%s · %s', bk.service_title, bk.reference), p_booking);
end;
$$;
