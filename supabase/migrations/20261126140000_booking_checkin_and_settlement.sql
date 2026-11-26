-- Meetup check-in codes and automatic settlement of finished token bookings (sandbox). Append-only.
--
-- Before this, an accepted token booking whose time had passed stayed on hold until BOTH participants tapped
-- "complete". If either forgot, the member's tokens were held indefinitely and the companion was never credited.
--
-- Check-in: inside the meetup window the member opens a one-time 6-digit code and shows it to the companion, who
-- enters it. The code is stored only as a hash, each code allows 5 wrong tries, and only the member can issue one.
--
-- Settlement job (booking_jobs integration secret, run by the API every minute): once an accepted token booking
-- has been over for the dispute window (default 24 hours) with its hold still 'held':
--   * if the meetup was checked in, or the member confirmed completion, the booking completes and the hold
--     settles through the existing lifecycle trigger (exactly once, as before);
--   * otherwise nothing settles: the hold is frozen for a moderator, who decides with admin_resolve_booking_tokens.
-- A companion's confirmation alone never settles tokens. Disputes and reports still freeze holds as before.

alter table public.bookings add column checked_in_at timestamptz;

alter table public.booking_token_settings
  add column dispute_window_hours int not null default 24 check (dispute_window_hours between 1 and 168);

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'booking_requested', 'booking_pending', 'booking_accepted', 'booking_rejected', 'booking_cancelled',
  'booking_completed', 'booking_disputed', 'dispute_resolved', 'review_received', 'companion_reviewed',
  'account_suspended', 'account_restored', 'appeal_decided', 'booking_checked_in', 'booking_under_review'));

alter table private.booking_job_runs drop constraint booking_job_runs_job_check;
alter table private.booking_job_runs add constraint booking_job_runs_job_check
  check (job in ('expire', 'settle', 'review'));

create table private.booking_checkin_codes (
  booking_id uuid primary key references public.bookings (id) on delete cascade,
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  attempts int not null default 0 check (attempts between 0 and 5),
  issues int not null default 1 check (issues between 1 and 10),
  issued_at timestamptz not null default now(),
  used_at timestamptz
);
alter table private.booking_checkin_codes enable row level security;
revoke all on private.booking_checkin_codes from public, anon, authenticated;

create function private.checkin_hash(p_booking uuid, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to('rentmate-checkin:' || p_booking::text || ':' || p_code, 'UTF8')), 'hex');
$$;
revoke execute on function private.checkin_hash(uuid, text) from public, anon, authenticated;

-- The window opens 30 minutes before the start and closes at the end of the booking.
create function private.checkin_window_open(bk public.bookings)
returns boolean
language sql
stable
set search_path = ''
as $$
  select bk.status = 'accepted' and now() >= bk.starts_at - interval '30 minutes' and now() <= bk.ends_at;
$$;
revoke execute on function private.checkin_window_open(public.bookings) from public, anon, authenticated;

-- Member only. Each call issues a fresh code (the old one stops working) and resets the wrong-try count.
create function public.booking_checkin_code(p_booking uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  bk public.bookings;
  code text;
  n int;
begin
  select * into bk from public.bookings where id = p_booking for update;
  if bk.id is null or bk.member_id is distinct from me then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;
  if bk.checked_in_at is not null then
    raise exception 'This meetup is already checked in.' using errcode = 'P0001';
  end if;
  if not private.checkin_window_open(bk) then
    raise exception 'Check-in opens 30 minutes before the booking and closes when it ends.' using errcode = 'P0001';
  end if;
  select issues into n from private.booking_checkin_codes where booking_id = p_booking for update;
  if n >= 10 then
    raise exception 'Too many check-in codes for this booking. Contact support.' using errcode = 'P0001';
  end if;
  -- 32 random bits from gen_random_uuid() (a strong random source), reduced to six digits.
  code := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text,
               6, '0');
  insert into private.booking_checkin_codes (booking_id, code_hash)
  values (p_booking, private.checkin_hash(p_booking, code))
  on conflict (booking_id) do update
    set code_hash = excluded.code_hash, attempts = 0, issues = private.booking_checkin_codes.issues + 1,
        issued_at = now();
  return code;
end;
$$;
revoke execute on function public.booking_checkin_code(uuid) from public, anon;
grant execute on function public.booking_checkin_code(uuid) to authenticated;

-- Companion only. Returns false for a wrong code (the try is counted, so it must not raise and roll back).
create function public.booking_check_in(p_booking uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  bk public.bookings;
  c private.booking_checkin_codes;
begin
  select * into bk from public.bookings where id = p_booking for update;
  if bk.id is null or bk.companion_id is distinct from me then
    raise exception 'Booking not found.' using errcode = '42501';
  end if;
  if bk.checked_in_at is not null then
    return true;
  end if;
  if not private.checkin_window_open(bk) then
    raise exception 'Check-in opens 30 minutes before the booking and closes when it ends.' using errcode = 'P0001';
  end if;
  if coalesce(p_code, '') !~ '^[0-9]{6}$' then
    raise exception 'Enter the 6-digit code from the member''s app.' using errcode = '22023';
  end if;
  select * into c from private.booking_checkin_codes where booking_id = p_booking for update;
  if c.booking_id is null or c.code_hash is null then
    raise exception 'Ask the member to open their check-in code first.' using errcode = 'P0001';
  end if;
  if c.attempts >= 5 then
    raise exception 'Too many wrong codes. Ask the member for a new code.' using errcode = 'P0001';
  end if;
  if c.code_hash <> private.checkin_hash(p_booking, p_code) then
    update private.booking_checkin_codes set attempts = attempts + 1 where booking_id = p_booking;
    return false;
  end if;
  update private.booking_checkin_codes set code_hash = null, used_at = now() where booking_id = p_booking;
  update public.bookings set checked_in_at = now(), updated_at = now() where id = p_booking;
  perform private.booking_system_message(p_booking, 'Meetup check-in confirmed.');
  perform private.notify(bk.member_id, 'booking_checked_in', 'Meetup checked in',
    format('%s · %s', bk.service_title, bk.reference), p_booking);
  return true;
end;
$$;
revoke execute on function public.booking_check_in(uuid, text) from public, anon;
grant execute on function public.booking_check_in(uuid, text) to authenticated;

-- System-wide settlement of finished token bookings. Guarded by the booking_jobs integration secret.
create function public.booking_jobs_settle(p_secret text, p_limit int default 200)
returns table (completed int, held_for_review int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  win int;
  bk record;
  n_done int := 0;
  n_review int := 0;
begin
  if not private.integration_secret_ok('booking_jobs', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  select s.dispute_window_hours into win from public.booking_token_settings s where s.id = 1;
  win := coalesce(win, 24);
  for bk in
    select b.id, b.member_id, b.companion_id, b.service_title, b.reference, b.checked_in_at
    from public.bookings b
    join public.booking_token_holds h on h.booking_id = b.id
    where b.status = 'accepted' and h.status = 'held' and b.ends_at <= now() - make_interval(hours => win)
    order by b.ends_at
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
    for update of b skip locked
  loop
    if bk.checked_in_at is not null or exists (
         select 1 from public.booking_completion_confirmations c
         where c.booking_id = bk.id and c.user_id = bk.member_id) then
      -- The lifecycle trigger settles the hold and posts the system message.
      update public.bookings set status = 'completed', completed_at = now(), updated_at = now() where id = bk.id;
      perform private.booking_log(bk.id, 'accepted', 'completed',
        case when bk.checked_in_at is not null then 'Completed automatically: checked in, no dispute'
             else 'Completed automatically: member confirmed, no dispute' end);
      perform private.notify(bk.member_id, 'booking_completed', 'Booking completed',
        format('%s · %s', bk.service_title, bk.reference), bk.id);
      perform private.notify(bk.companion_id, 'booking_completed', 'Booking completed',
        format('%s · %s', bk.service_title, bk.reference), bk.id);
      n_done := n_done + 1;
    else
      perform private.booking_hold_freeze(bk.id, 'No check-in or member confirmation after the meetup');
      perform private.booking_system_message(bk.id,
        'No check-in or confirmation was recorded, so a moderator will review this booking before any tokens move.');
      perform private.notify(bk.member_id, 'booking_under_review', 'Booking under review',
        format('%s · %s', bk.service_title, bk.reference), bk.id);
      perform private.notify(bk.companion_id, 'booking_under_review', 'Booking under review',
        format('%s · %s', bk.service_title, bk.reference), bk.id);
      n_review := n_review + 1;
    end if;
  end loop;
  if n_done > 0 then
    insert into private.booking_job_runs (job, affected) values ('settle', n_done);
  end if;
  if n_review > 0 then
    insert into private.booking_job_runs (job, affected) values ('review', n_review);
  end if;
  completed := n_done;
  held_for_review := n_review;
  return next;
end;
$$;
revoke execute on function public.booking_jobs_settle(text, int) from public;
-- The API calls it with the publishable key; the secret is the guard (same as booking_jobs_expire).
grant execute on function public.booking_jobs_settle(text, int) to anon, authenticated;

-- Admins tune the window (1 to 168 hours).
create function public.admin_set_booking_dispute_window(p_hours int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_role('admin');
  if p_hours is null or p_hours not between 1 and 168 then
    raise exception 'The dispute window must be between 1 and 168 hours.' using errcode = '22023';
  end if;
  update public.booking_token_settings set dispute_window_hours = p_hours, updated_by = (select auth.uid()),
    updated_at = now() where id = 1;
  perform private.log_action('booking_dispute_window_set', 'settings', 'booking_tokens', p_hours::text);
end;
$$;
revoke execute on function public.admin_set_booking_dispute_window(int) from public, anon;
grant execute on function public.admin_set_booking_dispute_window(int) to authenticated;
