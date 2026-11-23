# RentMate — Deployment Guide

Nothing in this guide is executed without explicit founder approval. A green CI run or an open pull request is not deployment authorization.

## Canonical source

- Repository: `Shivaaye-Technologies/RentMate`
- Current earnings implementation branch: `feature/earnings-platform-foundation`
- Current review: [PR #5](https://github.com/Shivaaye-Technologies/RentMate/pull/5), targeting `feature/android-companionship-social`
- Keep PR #5 open and unmerged until its review and release-base decision are complete.
- Do not use the historical `rentmate970-hue/RentMate` repository or `feature/rentmate-conversion` branch as the current source of truth.

Confirm the actual Render service, deploy branch, Supabase project and environment variables in their respective dashboards before any release. This guide does not assert that existing production services have been repointed.

## Environments

| Environment | Intended use                               | Release gate                                                       |
| ----------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Local       | Development and automated tests          | No shared environment changes                                     |
| Preview     | Per-PR web/API validation where configured | Verify preview secrets and data isolation                          |
| Staging     | Isolated Supabase project and non-production services | Confirm project identity, full migration baseline and backup first |
| Production  | Approved public service                   | Separate founder approval for deploy and database changes          |

The staging project previously identified as `RentMate-Staging-Mumbai` (`mmopqsqvoenqaedlakyc`) was reported empty on 2026-11-22. Recheck its current state; do not assume that an empty database can accept only the newest feature migrations. A complete canonical bootstrap and migration-history reconciliation are required first.

## Build, start and health

| Service | Build command                                     | Start / publish                                                  | Health              |
| ------- | ------------------------------------------------ | ---------------------------------------------------------------- | ------------------- |
| API     | `npm ci --include=dev && npm run build -w apps/api` | `npm start -w apps/api`                                             | `GET /health` → 200 |
| Web     | `npm ci --include=dev && npm run build -w apps/web` | Static publish from `apps/web/dist`; configure SPA fallback | Landing page loads  |

Run the repository's current CI workflow rather than relying only on these abbreviated commands. Confirm the workflow scripts against the checked-out `package.json`.

## Environment variables

Use only the values required by the selected environment. Enter secrets through the hosting provider's secret manager; never commit them or place them in browser/mobile bundles.

| Where | Variable                                                | Notes                                                               |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| API   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`                      | Publishable/anon key only; do not expose service-role credentials   |
| API   | `CORS_ORIGINS`                                           | Explicit allowed web origins                                       |
| API   | `LIVEKIT_*`, `LIVE_COUNTRY_HEADER`                       | Only after provider terms and feature authorization                |
| Web   | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser-safe values only                                            |

## Canonical migration inventory

The following is the migration-file order currently present on `feature/earnings-platform-foundation`. It is an inventory, not permission to apply migrations. Before staging or production use, compare the target database's `supabase_migrations.schema_migrations` history with this exact chain, inspect every migration and dependency, take a restorable backup, and rehearse the full chain on a disposable database.

1. `20261022210236_init.sql`
2. `20261022210317_revoke_trigger_function_execute.sql`
3. `20261022210959_discovery_and_realtime.sql`
4. `20261022211449_photos_location_superlikes_meet.sql`
5. `20261022211514_ready_to_meet_invoker.sql`
6. `20261023095502_safety_private_helpers.sql`
7. `20261023101049_safety_policies_reports_limits.sql`
8. `20261023101225_safety_profile_functions_delete_account.sql`
9. `20261023101930_safety_hide_location_private_photos.sql`
10. `20261023103442_fix_write_limits_per_table.sql`
11. `20261023121400_demo_profiles_testers.sql`
12. `20261023165729_demo_mode_public.sql`
13. `20261024090000_profile_details.sql`
14. `20261101090000_live_foundation.sql`
15. `20261118090000_no_adult_content.sql`
16. `20261118100000_policy_hardening.sql`
17. `20261119090000_marketplace.sql`
18. `20261120090000_audit_hardening.sql`
19. `20261120100000_token_wallet.sql`
20. `20261121090000_calls_and_live_rooms.sql`
21. `20261121100000_admin_mfa.sql`
22. `20261122090000_recovery_codes_and_retention.sql`
23. `20261123090000_guest_host_mutes.sql`
24. `20261123100000_integration_secret_strength.sql`
25. `20261123110000_photo_privacy.sql`
26. `20261123120000_account_deletion_photos.sql`
27. `20261123130000_age_attestation.sql`
28. `20261123140000_age_attestation_enforcement.sql`
29. `20261123150000_payment_account_registry.sql`
30. `20261123160000_financial_config_versions.sql`

Do not mark migrations as applied manually to bypass execution. Do not run only items 29–30 against an empty staging database. Resolve missing, divergent or already-applied versions before proceeding. Run Supabase security/performance advisors and the full database test suite after a staging rehearsal.

## Pre-release checklist

- [ ] Confirm this canonical repository and the intended release branch.
- [ ] Review PR #5, including its base branch, migration diffs, RLS, grants, RPC permissions and test results.
- [ ] CI green on the exact head commit intended for release.
- [ ] Confirm staging project identity and migration history; rehearse the complete chain from a known baseline.
- [ ] Take a backup and demonstrate that it can be restored.
- [ ] Verify Supabase Auth site/redirect URLs, SMTP, CORS and provider configuration.
- [ ] Verify hosting service repository, branch, build command, runtime and environment variables.
- [ ] Run smoke tests for health, landing, sign-in, discovery, booking and relevant live features.
- [ ] Confirm payment capture, token purchases, withdrawals and payouts remain disabled unless separately reviewed and approved.

## Release and rollback

1. Complete code review and CI for the exact candidate commit.
2. Obtain explicit approval for the target environment, deployment and database migration separately.
3. Back up the target database and verify the restore procedure.
4. Reconcile migration history, then apply the reviewed chain using the approved Supabase migration workflow.
5. Run security/performance advisors, database tests and application smoke tests.
6. Deploy the approved commit to the explicitly selected hosting environment.
7. Verify health, authentication, key user journeys, logs and alerts.
8. If validation fails, follow `RENTMATE_ROLLBACK_PLAN.md`; prefer forward fixes for applied schema changes unless a rehearsed rollback is known to be safe.

A founder-approved code merge does not, by itself, authorize a production deployment or production database mutation.

## Payment, tax and payout restrictions

- The payment-account registry is metadata-only. It does not implement hosted card checkout, dynamic UPI QR issuance, provider credential management, webhook settlement verification or payment reconciliation.
- Payment account records are read through an admin-only RPC; browser roles must not receive direct table access.
- Token pricing and tax records are versioned configuration only. They do not activate purchases, deposits, withdrawals, cash redemption or payouts.
- Tax settings require jurisdiction-specific professional review; do not assume a tax rate or copy test-fixture values into a real configuration.
- Provider secrets belong in an approved server-side secret manager, never in repository files, database plaintext fields or client bundles.
- No live payment or payout activation until legal, provider, security and founder approvals are separately recorded.

## HostyCare / cPanel

Not audited as part of this guide. Consider it only for static HTTPS content unless its Node runtime, persistent process model, environment-secret handling, observability and operational controls are independently verified.
