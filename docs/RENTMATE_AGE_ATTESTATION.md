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

## Production activation (later, only with explicit approval)

1. Confirm a backup and that the web app at `769a5e3` or later (fail-closed onboarding) is deployed.
2. Apply migration `20261123140000_age_attestation_enforcement.sql` (after `20261123130000`). This changes no rows and
   leaves the switch off.
3. Run `docs/ops/require_age_attestation.enable.sql` as the database owner. It refuses to run if the migration is
   missing and prints the new value.
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

| Test                                                | Where                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| Staging rules, switch on (27 checks)                | `supabase/tests/age_attestation_enforcement.sql` (`npm run test:db`)          |
| Staging rehearsal on real PostgreSQL 16 (29 checks) | `scripts/test-age-attestation-staging.sh` (`npm run test:db:age-staging`, CI) |
| Declaration rules (22 checks)                       | `supabase/tests/age_attestation.sql`                                          |
| Rollback and re-apply                               | `npm run test:rollback`                                                       |
| API 422 mapping (5 tests)                           | `apps/api/test/ageAttestation.test.ts`                                        |
| App fails closed (15 unit tests, 17 browser checks) | `apps/web/src/onboardingSave.test.ts`, `npm run test:e2e:onboarding`          |
