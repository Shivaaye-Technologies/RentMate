# RentMate — Database-level age attestation (P2-03)

Status (2026-11-20): enforcement rules implemented and rehearsed in disposable staging databases only. **Not enabled
in production, no production migration applied, nothing deployed.** Founder approval covers enabling it for the
controlled beta; the production steps below still need their own explicit go-ahead.

**What this is, and is not.** Members declare their date of birth and confirm "I am 18 or older". The database stores
that privately, labelled `self_declared`. It is **not** age or identity verification: anyone can type a false date.
Real verification needs a provider (see `RENTMATE_PHASE3_PROPOSALS.md`); none is selected.

## Why the database must enforce it

The web app already refuses to create a profile until `attest_adult` succeeds (fails closed, commit `769a5e3`). That
only protects people using the app. Anyone with a member token can call Supabase directly
(`POST /rest/v1/profiles`) or the API (`PUT /api/v1/profile`) and skip the app. With the requirement on, the
database itself refuses the new profile, whatever the client.

## How the setting is read and enforced

| Piece                                                                    | Where                                                 | What it does                                                                                                                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `public.platform_settings.require_age_attestation`                       | `20261123130000_age_attestation.sql`                  | The switch. Single settings row. Members can read it, cannot change it (only the database owner can).                                                  |
| `private.age_attestation_required()`                                     | `20261123140000_age_attestation_enforcement.sql`      | Reads the switch. If the settings row were missing, returns **true** (fail closed).                                                                    |
| `public.attest_adult(birth_date, confirm)`                               | `20261123130000`                                      | Records the declaration once. Refuses a missing date, a future or impossible date, under 18 and a missing confirmation, storing nothing for a refusal. |
| `private.age_attestations`                                               | `20261123130000`                                      | Private table: no client privileges. Members read only their own record via `my_age_attestation()`. Deleted with the account.                          |
| Trigger `profiles_age_attestation` → `private.profile_age_attestation()` | `20261123140000` (replaces the `20261123130000` body) | Runs before every profile insert and before age changes, for every role. See rules below.                                                              |

**Trigger rules.**

1. If the account has an attestation: it must be `self_declared`, confirmed and 18+ today, otherwise the write is
   refused. The profile age is set from the date of birth.
2. Otherwise, a **new** profile row is refused ("Please confirm your date of birth before creating a profile.",
   `P0001`) when the switch is on, unless it is a demo profile (below).
3. An upsert of a row that already exists is an update, not a new profile, so it is not refused.
4. No exception for administrators or the service role.

The API maps the refusal to `422 {"code": "age_attestation_required"}` on `PUT /api/v1/profile`. The web app always
attests first.

## Values

| Environment                                       | `require_age_attestation`                                     |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Default (migration value)                         | `false`                                                       |
| Disposable staging rehearsal (PostgreSQL 16)      | `true` (set by `docs/ops/require_age_attestation.enable.sql`) |
| Staging test suite (PGlite, inside a transaction) | `true`, rolled back after the test                            |
| Production                                        | `false` — unchanged; enabling needs separate approval         |

## Existing accounts

- Existing profiles are never checked, hidden or changed. Members without an attestation keep full access: they can
  read, update and upsert their profile (tested).
- Accounts that signed up but have no profile yet go through onboarding, which records the declaration first.
- Optional later step (not implemented, needs a decision): ask existing members to add their date of birth from
  Settings, or require it before their next booking.

## Demo accounts

- Demo profiles are created only by the demo seed (`supabase/seed/demo_profiles.sql`), as the database owner, for
  accounts with a reserved, undeliverable email `demo-<n>@demo.soulmate.invalid` and no password.
- They need no attestation: they are fictional, cannot sign in, and are shown only in clearly labelled Demo Mode
  and to testers.
- The exemption requires **both** `is_demo = true` and a reserved demo email. Members cannot set `is_demo` (no
  column privilege), and a privileged client setting `is_demo` on a real account is still refused.

## Migration ordering (forward-dated version)

The version `20261123140000` is later than the date it was written (2026-11-20). That is intentional and follows the
repository's existing convention: migration versions are ordering slots, not creation times.

- Migrations dated 21–23 November were already on GitHub before this work (`20261121090000` … `20261123100000`,
  added 18–20 November). A new migration must sort after all of them, or `supabase db push` would apply it out of
  order or refuse it on a database that already has the newer ones. The policy guard enforces this
  (`checkMigrationOrder` in `scripts/policy-check.mjs`).
- The four Phase 3 migrations take the next slots: `20261123110000` photo privacy, `20261123120000` account deletion,
  `20261123130000` age attestation, `20261123140000` enforcement.
- None of them has been pushed or applied anywhere except disposable test databases, and none was renamed.
- For anyone adding the next migration: do not use `supabase migration new` as is. Until the calendar passes 23
  November, name it after the latest version (e.g. `20261123150000_…`); the guard fails otherwise.

## Exemptions: why they cannot be abused

Checked by `supabase/tests/age_attestation_abuse.sql` (18 checks, PGlite and real PostgreSQL 16).

- **Existing-profile upsert.** The trigger skips the check only when a profile row with the same id already exists.
  Members can only write their own id (RLS `id = auth.uid()`), and they cannot delete their profile row (no delete
  policy). So the exemption never creates a row: refused cases include an upsert or a multi-row insert of a new id
  (refused at the first row, even for the owner), a profile for another account, an insert or upsert over another
  member's existing profile (RLS), and re-creating a profile after the platform removed it (counts as new).
- **Demo profiles.** Need `is_demo = true` and a reserved demo email. Members have no privilege on `is_demo` (insert or
  update) or on `auth.users`, no member-callable function writes `is_demo` or creates profiles, and members cannot
  call the enforcement helpers. A member who signs up with a reserved-looking email still needs an attestation.

1. Confirm a backup and that the web app at `769a5e3` or later (fail-closed onboarding) is deployed.
2. Apply migration `20261123140000_age_attestation_enforcement.sql` (after `20261123130000`). This changes no rows and
   leaves the switch off.
3. Run `docs/ops/require_age_attestation.enable.sql` as the database owner (with psql, use `-v ON_ERROR_STOP=1`).
   It runs in one transaction and stops with an error, changing nothing, if the enforcement migration is missing or
   if the update does not change exactly one `platform_settings` row. It never creates a missing settings row: if
   that error appears, stop and check you are on the right database. A missing row already counts as "required"
   (fail closed) until it is restored in a separate, reviewed step. On success it prints the new value.
4. Check: sign up a test account in the app (succeeds after the date of birth step); a direct REST insert without a
   declaration is refused; an existing member can still edit their profile.

## Rollback

- **Turn off** (fast, no data change): `docs/ops/require_age_attestation.disable.sql`. New profiles are created as
  before; the app still asks for the date of birth.
- **Remove the enforcement rules**: first turn off, then
  `docs/rollback/20261123_age_attestation_enforcement.rollback.sql`. Restores the previous trigger function exactly
  and drops the two helpers. No rows change; recorded attestations stay.
- Both are rehearsed by `npm run test:db:age-staging` (real PostgreSQL) and `npm run test:rollback`.

## Tests

| Test                                                                                                         | Where                                                                         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Staging rules, switch on (27 checks)                                                                         | `supabase/tests/age_attestation_enforcement.sql` (`npm run test:db`)          |
| Abuse attempts on both exemptions (18 checks)                                                                | `supabase/tests/age_attestation_abuse.sql` (`npm run test:db`)                |
| Staging rehearsal on real PostgreSQL 16 (44 checks, incl. both suites and the enable script's failure cases) | `scripts/test-age-attestation-staging.sh` (`npm run test:db:age-staging`, CI) |
| Declaration rules (22 checks)                                                                                | `supabase/tests/age_attestation.sql`                                          |
| Rollback and re-apply                                                                                        | `npm run test:rollback`                                                       |
| API 422 mapping (5 tests)                                                                                    | `apps/api/test/ageAttestation.test.ts`                                        |
| App fails closed (15 unit tests, 17 browser checks)                                                          | `apps/web/src/onboardingSave.test.ts`, `npm run test:e2e:onboarding`          |
