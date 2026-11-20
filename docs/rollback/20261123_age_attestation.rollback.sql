-- Rollback for 20261123130000_age_attestation.sql. Founder approval and a backup first. Removes the recorded dates of
-- birth (personal data) together with the functions, trigger and switch.

drop trigger profiles_age_attestation on public.profiles;
drop function private.profile_age_attestation();
drop function public.my_age_attestation();
drop function public.attest_adult(date, boolean);
drop function private.age_on(date, date);
alter table public.platform_settings drop column require_age_attestation;
drop table private.age_attestations;
