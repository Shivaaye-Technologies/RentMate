-- Rollback for 20261126140000_booking_checkin_and_settlement.sql. NOT a migration. Stop the API's booking jobs first
-- (unset BOOKING_JOBS_DB_SECRET). Refuses to run once the feature has been used, because dropping the column would
-- erase check-in evidence and the old constraints would reject the new notification kinds and job runs. Bookings
-- already settled stay settled; their ledger, earnings and commission entries are untouched.
do $$
begin
  if exists (select 1 from public.bookings where checked_in_at is not null)
     or exists (select 1 from private.booking_job_runs where job in ('settle', 'review'))
     or exists (select 1 from public.notifications where kind in ('booking_checked_in', 'booking_under_review')) then
    raise exception 'Check-in or settlement records exist; this rollback would lose them. Keep the migration.';
  end if;
end $$;
drop function if exists public.admin_set_booking_dispute_window(int);
drop function if exists public.booking_jobs_settle(text, int);
drop function if exists public.booking_check_in(uuid, text);
drop function if exists public.booking_checkin_code(uuid);
drop function if exists private.checkin_window_open(public.bookings);
drop function if exists private.checkin_hash(uuid, text);
drop table if exists private.booking_checkin_codes;
alter table private.booking_job_runs drop constraint booking_job_runs_job_check;
alter table private.booking_job_runs add constraint booking_job_runs_job_check check (job in ('expire'));
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'booking_requested', 'booking_pending', 'booking_accepted', 'booking_rejected', 'booking_cancelled',
  'booking_completed', 'booking_disputed', 'dispute_resolved', 'review_received', 'companion_reviewed',
  'account_suspended', 'account_restored', 'appeal_decided'));
alter table public.booking_token_settings drop column dispute_window_hours;
alter table public.bookings drop column checked_in_at;
