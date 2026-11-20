-- Turn OFF database-level age attestation (undo of require_age_attestation.enable.sql).
--
-- Run only with approval, as the database owner. New profiles are then created without the database check (the web
-- app still asks for the date of birth and 18+ confirmation and fails closed). Recorded attestations, existing
-- profiles and the enforcement functions are kept; nothing is deleted.
begin;

update public.platform_settings set require_age_attestation = false, updated_at = now() where id;

select require_age_attestation from public.platform_settings;

commit;
