-- Database-level age attestation: enforcement rules (P2-03). Append-only. Changes no rows and does NOT turn the
-- requirement on: public.platform_settings.require_age_attestation keeps its current value (false by default).
-- Turning it on is a separate, approved operation: docs/ops/require_age_attestation.enable.sql.
--
-- The attestation is a self-declaration (date of birth + "I am 18 or older"), labelled 'self_declared'. It is NOT age
-- or identity verification.
--
-- When the requirement is on, a NEW profile row is accepted only if one of these holds:
--   * the account has a valid attestation in private.age_attestations: method 'self_declared', a confirmation time,
--     and a date of birth that makes the member 18 or older today (public.attest_adult refuses anything else, and
--     stores nothing for a refusal); or
--   * it is a demo profile: is_demo is true AND the account's email is a reserved demo address
--     (demo-<n>@demo.soulmate.invalid). Those accounts are created only by the demo seed, as the database owner, with
--     no password and an undeliverable email. Members cannot set is_demo (no column privilege), and the email check
--     stops a privileged client from exempting a real account just by setting is_demo.
-- There is no exception for administrators or the service role: the rule is a trigger and applies to every role,
-- including direct REST requests and the API (which writes with the member's own token).
--
-- Existing members are never locked out. Only the creation of a new profile row is checked: an existing profile is
-- never re-checked, and an upsert (INSERT ... ON CONFLICT) of a row that already exists is an update, not a new
-- profile. If the settings row were ever missing, the requirement is treated as ON (fail closed).
--
-- Unchanged: an attested member's profile age always follows their date of birth; other members cannot read anyone's
-- date of birth; the attestation is deleted with the account.

-- Whether new non-demo profiles need an attestation. Missing settings row: yes (fail closed).
create function private.age_attestation_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.require_age_attestation from public.platform_settings s where s.id), true);
$$;
revoke execute on function private.age_attestation_required() from public;

-- A demo account created by the demo seed (reserved, undeliverable address).
create function private.is_reserved_demo_account(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user and u.email ~ '^demo-[0-9]+@demo\.soulmate\.invalid$'
  );
$$;
revoke execute on function private.is_reserved_demo_account(uuid) from public;

create or replace function private.profile_age_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  att private.age_attestations;
  years int;
begin
  select * into att from private.age_attestations a where a.user_id = new.id;
  if att.user_id is not null then
    years := private.age_on(att.birth_date, current_date);
    if att.method <> 'self_declared' or att.confirmed_at is null or years < 18 then
      raise exception 'Your recorded date of birth cannot be used. Please contact support.' using errcode = 'P0001';
    end if;
    new.age := years;
    return new;
  end if;
  if tg_op = 'INSERT'
     and private.age_attestation_required()
     and not exists (select 1 from public.profiles p where p.id = new.id)
     and not (coalesce(new.is_demo, false) and private.is_reserved_demo_account(new.id)) then
    raise exception 'Please confirm your date of birth before creating a profile.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function private.profile_age_attestation() from public;
