-- System-wide expiry of unanswered booking requests (refunds their token holds). Append-only.
--
-- public.booking_expire_stale() only expires the caller's own bookings, so a request nobody opens again would keep
-- its tokens on hold. The API server now runs public.booking_jobs_expire every minute with the 'booking_jobs'
-- integration secret (the same narrow-capability pattern as LiveKit and Play Billing; no privileged database key).
-- The booking_token_lifecycle trigger refunds each hold exactly once (idempotent ledger key).

alter table private.integration_secrets drop constraint integration_secrets_name_check;
alter table private.integration_secrets add constraint integration_secrets_name_check
  check (name in ('livekit_webhook', 'play_billing', 'booking_jobs'));

create table private.booking_job_runs (
  id bigint generated always as identity primary key,
  job text not null check (job in ('expire')),
  affected int not null check (affected >= 0),
  ran_at timestamptz not null default now()
);

create function public.booking_jobs_expire(p_secret text, p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if not private.integration_secret_ok('booking_jobs', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  with stale as (
    select id from public.bookings
    where status in ('requested', 'pending') and starts_at <= now()
    order by starts_at
    limit least(greatest(coalesce(p_limit, 500), 1), 2000)
    for update skip locked
  )
  update public.bookings b set status = 'expired', updated_at = now()
  from stale where b.id = stale.id;
  get diagnostics n = row_count;
  if n > 0 then
    insert into private.booking_job_runs (job, affected) values ('expire', n);
  end if;
  return n;
end;
$$;
revoke execute on function public.booking_jobs_expire(text, int) from public;
-- The API calls it with the publishable key; the secret is the guard.
grant execute on function public.booking_jobs_expire(text, int) to anon, authenticated;

-- Admin view of recent job runs (for the reconciliation screen).
create function public.admin_booking_job_runs(p_limit int default 50)
returns table (job text, affected int, ran_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('sub_admin');
  return query select r.job, r.affected, r.ran_at from private.booking_job_runs r
    order by r.ran_at desc limit least(greatest(coalesce(p_limit, 50), 1), 500);
end;
$$;
revoke execute on function public.admin_booking_job_runs(int) from public, anon;
grant execute on function public.admin_booking_job_runs(int) to authenticated;
