-- Rollback for 20261126120000_booking_expiry_job.sql. NOT a migration. Stop the API's expiry timer first
-- (unset BOOKING_JOBS_DB_SECRET). Bookings already expired stay expired and their refunds stay in the ledger.
drop function if exists public.admin_booking_job_runs(int);
drop function if exists public.booking_jobs_expire(text, int);
drop table if exists private.booking_job_runs;
delete from private.integration_secrets where name = 'booking_jobs';
alter table private.integration_secrets drop constraint integration_secrets_name_check;
alter table private.integration_secrets add constraint integration_secrets_name_check
  check (name in ('livekit_webhook', 'play_billing'));
