-- Turn ON database-level age attestation for NEW non-demo profiles (P2-03).
--
-- NOT YET APPROVED FOR PRODUCTION. Run only with the founder's explicit approval for that environment, as the
-- database owner (Supabase SQL Editor or psql), after migration 20261123140000_age_attestation_enforcement.sql is
-- applied and the web app with the fail-closed onboarding (commit 769a5e3 or later) is deployed.
--
-- Effect: a new profile row is refused unless the account has a valid self-declared attestation (attest_adult) or is a
-- reserved demo account. Existing profiles are not checked, changed or hidden. It records a self-declaration, not age
-- or identity verification. Undo: docs/ops/require_age_attestation.disable.sql.
--
-- Safety: the whole change is one transaction. It stops with an error, and changes nothing, if the enforcement
-- migration is missing or if the update does not change exactly one platform_settings row (the table holds a single
-- settings row). A missing settings row is reported, never created here: restoring it is a separate, reviewed step.
-- With psql, run with ON_ERROR_STOP (psql -v ON_ERROR_STOP=1 -f ...); in the SQL Editor an error aborts the run.
begin;

do $$
declare
  changed int;
begin
  if to_regprocedure('private.age_attestation_required()') is null
     or to_regprocedure('private.is_reserved_demo_account(uuid)') is null then
    raise exception 'Apply migration 20261123140000_age_attestation_enforcement.sql before enabling. Nothing was changed.';
  end if;

  update public.platform_settings set require_age_attestation = true, updated_at = now() where id;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Expected to update exactly 1 platform_settings row, but % rows matched. Nothing was changed. '
      'Check that this is the right database and that the settings row exists.', changed;
  end if;
end $$;

select require_age_attestation, private.age_attestation_required() as enforced from public.platform_settings;

commit;
