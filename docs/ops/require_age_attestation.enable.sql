-- Turn ON database-level age attestation for NEW non-demo profiles (P2-03).
--
-- NOT YET APPROVED FOR PRODUCTION. Run only with the founder's explicit approval for that environment, as the
-- database owner (Supabase SQL Editor or psql), after migration 20261123140000_age_attestation_enforcement.sql is
-- applied and the web app with the fail-closed onboarding (commit 769a5e3 or later) is deployed.
--
-- Effect: a new profile row is refused unless the account has a valid self-declared attestation (attest_adult) or is a
-- reserved demo account. Existing profiles are not checked, changed or hidden. It records a self-declaration, not age
-- or identity verification. Undo: docs/ops/require_age_attestation.disable.sql.
begin;

do $$
begin
  if to_regprocedure('private.age_attestation_required()') is null
     or to_regprocedure('private.is_reserved_demo_account(uuid)') is null then
    raise exception 'Apply migration 20261123140000_age_attestation_enforcement.sql before enabling.';
  end if;
end $$;

update public.platform_settings set require_age_attestation = true, updated_at = now() where id;

select require_age_attestation, private.age_attestation_required() as enforced from public.platform_settings;

commit;
