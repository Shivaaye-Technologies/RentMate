-- Date of birth and explicit 18+ confirmation (P2-03, preparation). Append-only; changes no existing rows.
--
-- IMPORTANT: this records what a member declares. It is NOT age or identity verification: anyone can type a false
-- date. Real verification needs a provider (founder decisions F-04/F-05). The record is labelled 'self_declared' so it
-- can never be mistaken for a verified age.
--
--   * public.attest_adult(birth_date, confirm) records the member's date of birth and confirmation once. Under-18
--     dates, impossible dates and missing confirmation are refused, and nothing is stored for a refusal. The first
--     recorded date cannot be changed by the member (no trial and error); support corrects mistakes.
--   * Other members can never read the date of birth (private schema, no client privileges).
--   * Once a member has attested, their profile age is kept consistent with the date of birth.
--   * platform_settings.require_age_attestation (default false) makes new non-demo profiles require an attestation.
--     It stays off until the app flow is released; existing profiles are never affected.

create table private.age_attestations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birth_date date not null,
  confirmed_at timestamptz not null default now(),
  method text not null default 'self_declared' check (method in ('self_declared'))
);
alter table private.age_attestations enable row level security;
revoke all on private.age_attestations from public, anon, authenticated;

alter table public.platform_settings
  add column require_age_attestation boolean not null default false;

-- Whole years between a birth date and a day.
create function private.age_on(p_birth date, p_day date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(year from age(p_day, p_birth))::int;
$$;
revoke execute on function private.age_on(date, date) from public;

create function public.attest_adult(p_birth_date date, p_confirm boolean)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  years int;
  prior private.age_attestations;
begin
  if me is null then
    raise exception 'Please sign in.' using errcode = '28000';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'Please confirm that you are 18 or older.' using errcode = 'P0001';
  end if;
  if p_birth_date is null or p_birth_date > current_date then
    raise exception 'Enter a valid date of birth.' using errcode = '22023';
  end if;
  years := private.age_on(p_birth_date, current_date);
  if years > 100 then
    raise exception 'Enter a valid date of birth.' using errcode = '22023';
  end if;
  if years < 18 then
    -- Nothing is stored for a refused attempt.
    raise exception 'RentMate is only for people aged 18 or over.' using errcode = 'P0001';
  end if;
  select * into prior from private.age_attestations where user_id = me;
  if prior.user_id is not null then
    if prior.birth_date <> p_birth_date then
      raise exception 'Your date of birth is already recorded. Contact support to correct it.' using errcode = 'P0001';
    end if;
    return years; -- same date again: nothing to do
  end if;
  insert into private.age_attestations (user_id, birth_date) values (me, p_birth_date);
  update public.profiles set age = years where id = me and age is distinct from years;
  return years;
end;
$$;
revoke execute on function public.attest_adult(date, boolean) from public, anon;
grant execute on function public.attest_adult(date, boolean) to authenticated;

-- The member's own record (never anyone else's).
create function public.my_age_attestation()
returns table (birth_date date, confirmed_at timestamptz, method text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.birth_date, a.confirmed_at, a.method from private.age_attestations a where a.user_id = (select auth.uid());
$$;
revoke execute on function public.my_age_attestation() from public, anon;
grant execute on function public.my_age_attestation() to authenticated;

-- Profiles: keep the age consistent with an attested birth date; when switched on, require an attestation for new
-- non-demo profiles.
create function private.profile_age_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  born date;
begin
  select a.birth_date into born from private.age_attestations a where a.user_id = new.id;
  if born is not null then
    new.age := private.age_on(born, current_date);
  elsif tg_op = 'INSERT' and not coalesce(new.is_demo, false)
        and coalesce((select s.require_age_attestation from public.platform_settings s limit 1), false) then
    raise exception 'Please confirm your date of birth before creating a profile.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function private.profile_age_attestation() from public;

create trigger profiles_age_attestation
  before insert or update of age on public.profiles
  for each row execute function private.profile_age_attestation();
