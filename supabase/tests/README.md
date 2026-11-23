# Database security tests

`npm run test:db` runs the complete database regression suite locally and in CI. It applies the canonical migration chain to a disposable in-memory Postgres ([PGlite](https://pglite.dev)) with minimal Supabase Auth and Storage stand-ins from `supabase_stubs.sql`, runs the SQL regression files, and verifies demo seeding and cleanup. The test runner is isolated; it does not connect to or modify a Supabase project.

## Important: do not run these test files in a live Supabase SQL editor

These SQL files are written for the PGlite test harness, not as production/staging migration scripts or live-project health checks. Some tests deliberately manipulate `auth.users`, `auth.mfa_factors`, `storage.objects`, storage bucket metadata, and seeded application rows. Supabase protects platform-owned Auth and Storage tables with behavior that the local stand-ins cannot reproduce. A test ending with `raise exception 'ROLLED BACK...'` is also an intentional test-runner convention, not a green SQL-editor result.

Running a file directly against a real Supabase project can fail for platform-specific reasons, can leave state behind if a test is edited or interrupted, and can give misleading results when the project's seed data differs. Never use the SQL editor to run the suite. Use `npm run test:db` / CI for the regression suite. Use read-only SQL queries or purpose-built staging smoke tests for inspecting a real project.

## Coverage

The suite includes focused regression files for RLS and discovery, demo isolation/mode, profile details, marketplace and booking, audit hardening, token wallet, payment-account registry, financial configuration versions, calls and live rooms, admin MFA, recovery-code retention, guest/host mutes, integration-secret strength, photo privacy, account-deletion photo cleanup, age attestation/enforcement/abuse, and the no-adult-content policy.

Every SQL test is run by the repository's database test harness against the disposable database. Each test reports its individual `ok` / `FAIL` assertions through the harness; any `FAIL` is a regression that must be investigated. Keep platform-specific integration tests separate and run them only against an explicitly isolated disposable Supabase project with a documented cleanup plan.
