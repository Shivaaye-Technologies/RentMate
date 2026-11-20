-- Rollback for 20261123140000_age_attestation_enforcement.sql. Restores the trigger function exactly as
-- 20261123130000_age_attestation.sql created it and drops the two helper functions. Changes no rows.
--
-- Run only with approval, as the database owner. If the requirement is on, turn it off FIRST
-- (docs/ops/require_age_attestation.disable.sql): the restored function does not re-check the reserved demo email
-- or existing rows on upsert.
create or replace function private.profile_age_attestation()
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

drop function private.is_reserved_demo_account(uuid);
drop function private.age_attestation_required();
