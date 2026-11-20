# RentMate — Security Findings

Date: 2026-11-19 · Repository: `Shivaaye-Technologies/RentMate` · Branch: `feature/rentmate-conversion` · Audit start:
`c58ee51` · Companion reports: `RENTMATE_DEEP_AUDIT.md`, `RENTMATE_DEPLOYMENT_READINESS.md`, `RENTMATE_REMAINING_WORK.md`.

**Evidence labels.** **Verified**: reproduced in this session by running code (disposable PGlite or PostgreSQL 16, unit
tests, CodeQL). **Inspected**: read in the code, not executed. **Inferred**: a risk reasoned from the code, not
demonstrated. **Unverified**: an assumption about an environment this session cannot reach (production Supabase,
Render, GitHub settings).

**Severity.** P0 critical security or data loss · P1 high-impact security or correctness · P2 important gap · P3 hygiene.

No P0 issue was found. Nothing was tested against production; no production system was touched.

## Phase 2 audit (2026-11-20): new findings

Full detail, evidence, reproduction, fixes and required tests: `RENTMATE_FULL_AUDIT_REPORT.md`. Audited at `c5aa208`,
read-only. Nothing below is fixed yet.

| ID    | Severity | Finding                                                                                                                       | Where                                                                             |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| P2-01 | High     | Prohibited-content filter bypassed by common wording and obfuscation ("happy ending massage", "nude photos", "s3x", "e$c0rt") | `20261118100000_policy_hardening.sql:12-24`                                       |
| P2-02 | High     | "Public place" check accepts hotel rooms, homes and Airbnbs                                                                   | `20261119090000_marketplace.sql:114-121`, `:317`                                  |
| P2-03 | High     | 18+ is a self-entered age; no date of birth, confirmation or verification (F-04/F-05)                                         | `apps/api/src/validation.ts:6`, `20261022210236_init.sql:8`, `AuthScreen.tsx:413` |
| P2-04 | Medium   | Any signed-in member can read (and likely list) every member's photos                                                         | `20261023101225_safety_profile_functions_delete_account.sql:138-142`              |
| P2-05 | Medium   | Account deletion removes photos only from the browser; nothing server-side                                                    | `AccountPanel.tsx:33-45`, `…delete_account.sql:80-92`                             |
| P2-06 | Medium   | Production `Permissions-Policy` blocks geolocation, so location sharing fails                                                 | `render.yaml:78`, `Settings.tsx:160`                                              |
| P2-07 | Medium   | API on Render free plan; sleeping delays room removals                                                                        | `render.yaml:7`, `apps/api/src/server.ts:52-56`                                   |
| P2-08 | Medium   | Supabase Auth settings unversioned; password minimum enforced only in the browser                                             | no `supabase/config.toml`; `apps/web/src/auth.ts:93`                              |
| P2-09 | Low      | `anon` still holds `SELECT` on six tables (no rows exposed today)                                                             | Supabase default privileges                                                       |
| P2-10 | Low      | `transactions.kind` allows `payout`, `subscription` (table unused, closed to clients)                                         | `20261119090000_marketplace.sql:494`                                              |
| P2-11 | Low      | 33 foreign keys without an index                                                                                              | several migrations                                                                |
| P2-12 | Low      | Colour contrast on sign-in status pills                                                                                       | `apps/web/src/styles.css:3458`                                                    |
| P2-13 | Low      | No runtime ledger reconciliation                                                                                              | `20261120100000_token_wallet.sql`                                                 |
| P2-14 | Low      | Backups and restore not rehearsed                                                                                             | `docs/RENTMATE_ROLLBACK_PLAN.md:21`                                               |
| P2-15 | Info     | CodeQL alert #3: false positive, open pending approval                                                                        | `apps/api/src/live/providers.ts:70`                                               |

## Summary

| ID      | Sev | Title                                                                              | Evidence  | Status                       |
| ------- | --- | ---------------------------------------------------------------------------------- | --------- | ---------------------------- |
| SEC-01  | P1  | Client-set `created_at` bypasses like and message rate limits                      | Verified  | **Fixed** + regression test  |
| SEC-02  | P1  | Account suspension not enforced outside the marketplace                            | Verified  | **Fixed** + regression test  |
| BKG-01  | P1  | Expired unanswered requests lock a member out of booking permanently               | Verified  | **Fixed** + regression test  |
| DEP-01  | P1  | Render Blueprint would auto-deploy GitHub's default branch (the PR branch)         | Inspected | **Fixed in file**; F-26 open |
| AUTH-01 | P1  | No MFA for admin and moderator powers                                              | Inspected | Open (F-25)                  |
| SEC-04  | P2  | Account deletion erases suspension and appeal history                              | Verified  | Open (F-20)                  |
| LIVE-01 | P2  | No media UI: live, private sessions and dating calls cannot carry audio/video      | Inspected | Open                         |
| LIVE-02 | P2  | No LiveKit webhook receiver: no trusted join/leave events                          | Inspected | Open                         |
| LIVE-03 | P2  | Participants already in a room are not removed when blocked or suspended           | Inferred  | Open                         |
| BKG-02  | P2  | Accepting a request does not re-check blocks between the two people                | Inferred  | Open                         |
| AUTH-02 | P2  | Age is self-declared (18+ enforced on the number only)                             | Inspected | Open (F-05)                  |
| OPS-01  | P2  | Static web app ships without security headers (CSP, frame, referrer)               | Inspected | Open                         |
| SEC-03  | P3  | API roles held TRUNCATE/REFERENCES/TRIGGER; anon held write rights                 | Verified  | **Fixed** + regression test  |
| BKG-03  | P3  | Concurrent retry with one idempotency key raised a raw database error              | Verified  | **Fixed** + concurrency test |
| JWT-01  | P3  | `verifyJwt` timing-unsafe compare, no `alg` check (fixed in `c58ee51`); no exp/nbf | Verified  | **Fixed** + tests            |
| CQ-01   | P3  | CodeQL `js/file-system-race` in `scripts/policy-check.mjs`                         | Verified  | **Fixed**                    |
| CQ-02   | —   | CodeQL `js/insufficient-password-hash` at `providers.ts:57`                        | Verified  | False positive, dismiss      |

## Fixed findings

### SEC-01 · P1 · Client timestamps bypassed rate limits — Verified, fixed

- **Where:** `public.likes`, `public.messages`, `public.passes`, `public.blocks`, `public.reports` (table-level INSERT
  grants include `created_at`); `public.enforce_write_limits()` in `20261023103442_fix_write_limits_per_table.sql`
  counts rows by `created_at`.
- **Evidence:** as an authenticated member in a disposable database, 350 likes with `created_at = '2000-01-01'` were all
  accepted against the 300/day limit (control run with server time stopped at 299). Forty messages back-dated to 1999
  were accepted against 20/minute. A message dated 2099 was stored as 2099.
- **Impact:** spam and harassment limits were ineffective. Message timestamps (evidence for reports and moderation)
  could be forged.
- **Fix:** `20261120090000_audit_hardening.sql` adds `private.server_created_at()`, a BEFORE trigger that sets
  `created_at = now()` for `anon`/`authenticated` inserts (and keeps the original value on `blocks` updates). Seeds and
  migrations keep their own timestamps.
- **Tests:** `supabase/tests/audit_hardening.sql` (back-dated and future-dated rows get server time; back-dated rows hit
  the limit; block timestamps cannot be rewritten; seeds unaffected).

### SEC-02 · P1 · Suspension did not reach dating, creator and live features — Verified, fixed

- **Where:** `private.is_suspended` was referenced only in marketplace policies and RPCs.
- **Evidence:** after `admin_suspend_account`, the suspended member still sent a dating message (verified) and could
  update their profile. Creator applications, stream scheduling, private-session requests and the live
  `watch`/`broadcast`/`session` checks had no suspension condition (inspected).
- **Fix:** restrictive RLS policies on inserts into `likes`, `messages`, `creators`, `live_streams`, `private_sessions`
  and `creator_availability`. Wrappers around `private.broadcast_problems` and `private.watch_problems` add
  `account_suspended` (and hide a suspended creator's streams). A wrapper around `live_session_check` adds
  `account_suspended` or `participant_suspended`. Every token issue, stream start, stream list and admin health check uses
  these functions. The API returns 403 with a clear message. Reporting, blocking, unmatching, appeals and account
  deletion remain available.
- **Tests:** `audit_hardening.sql` (refusals, still-allowed actions, other members unaffected, lifting restores access);
  `apps/api/test/live.test.ts` ("refuses suspended accounts everywhere a token is issued").
- **Note:** profile edits remain allowed while suspended (inspected). That is a product choice and is listed in
  `RENTMATE_REMAINING_WORK.md`.

### BKG-01 · P1 · Expired requests locked members out of booking — Verified, fixed

- **Where:** `public.booking_request` counted every `requested`/`pending` booking towards the 10-open limit.
  `public.booking_cancel` refused any booking whose start time had passed.
- **Evidence (PostgreSQL 16):** a member with 10 unanswered requests whose start times had passed got "This booking can
  no longer be cancelled." for each and "You have 10 open requests…" for any new request. They were locked out of
  booking for good.
- **Fix:** only future open requests count. Unanswered requests can always be withdrawn. Accepted bookings still cannot be
  cancelled after they start (completion or dispute instead).
- **Tests:** `audit_hardening.sql` (limit still 10, expiry unblocks, withdrawal works, started accepted bookings stay
  non-cancellable).

### DEP-01 · P1 · Blueprint would deploy the PR branch — Inspected, fixed in file

- **Where:** `render.yaml` had `autoDeploy: true` and no `branch`, so Render uses the repository's default branch.
  `git ls-remote` shows GitHub's `HEAD` → `feature/rentmate-conversion`.
- **Impact (inferred):** connecting this Blueprint would deploy unreviewed PR code to production and redeploy on every
  push to the PR.
- **Fix:** `branch: main` on both services. **Still open:** change the GitHub default branch to `main` (F-26, a
  repository setting).

### SEC-03 · P3 · Least privilege — Verified, fixed

`anon` held INSERT/UPDATE/DELETE/TRUNCATE on six dating tables, and both API roles held TRUNCATE/REFERENCES/TRIGGER on
public tables. These are Supabase defaults. RLS already blocked the row operations, and PostgREST cannot issue TRUNCATE.
Removed for all current tables and future default privileges. Test: `audit_hardening.sql` (zero such grants remain).
`anon` keeps SELECT on six tables, with no matching policy (it reads nothing). That is residual hygiene.

### BKG-03 · P3 · Idempotent retries — Verified, fixed

Two simultaneous `booking_request` calls with one idempotency key (PostgreSQL 16, two sessions) created one booking. The
second caller got a raw `duplicate key value violates unique constraint "bookings_idempotency"` error. It now receives
the existing booking id. Test: `scripts/test-db-concurrency.sh` case 2 (fails without the fix).

### JWT-01 · P3 · LiveKit token verifier — Verified, fixed

Constant-time comparison and `alg: HS256` enforcement landed in `c58ee51`. This round adds optional `exp`/`nbf`
enforcement to `verifyJwt`, plus tests:

- expiry at and after `exp`, and not-yet-valid tokens;
- tokens without `exp`;
- wrong project secret;
- headers switched to `HS512`/`none`/`RS256`;
- issuer = API key, room-scoped grants, no `roomAdmin`/`roomRecord` on join tokens, 600-second lifetime.

Production tokens are verified by the LiveKit server. `verifyJwt` is defence in depth and test tooling.

### CQ-01 · P3 · File-system race in the policy guard — Verified, fixed

CodeQL `js/file-system-race` (security-extended): `statSync` followed by a separate `readFileSync`. The guard now opens
each file once and reads size, magic bytes and text from that one handle. Policy self-tests: 56/56, including four new
cases for the refined TRUNCATE rule.

## Open findings

### AUTH-01 · P1 · No MFA on privileged functions — Inspected, open (F-25)

`private.has_role` checks only the role table. A stolen admin password grants suspension, verification, commission and
emergency-stop powers. Requiring `auth.jwt() ->> 'aal' = 'aal2'` without an MFA enrolment screen would lock every admin
out, so this needs a small UI and a founder decision. Recommended fix: TOTP enrolment in Settings, then a guard in
`private.has_role` for admin and moderator.

### SEC-04 · P2 · Deletion erases moderation history — Verified, open (F-20)

A suspended member who deletes their account removes their `account_suspensions` and `account_appeals` rows (cascade).
`moderation_actions` survives. The person can then register again with the same email. Retention is a legal and privacy
decision under India's DPDP Act, so this was not changed. Options: keep suspension rows with a salted email hash, or keep
them for a fixed period.

### LIVE-01 · P2 · No media client — Inspected, open

The web app has no LiveKit client. Nothing calls `POST /api/v1/live/streams/:id/join` or `/sessions/:id/join`, and there
is no voice or video call screen for dating matches. "Start stream" in Creator Studio changes database state only. The
backend (policy checks, tokens, moderation, emergency stop) is implemented and tested; the media experience is not.

### LIVE-02 · P2 · No webhook receiver — Inspected, open

There is no endpoint for LiveKit webhooks (`participant_joined`/`left`, `room_finished`). As a result:

- call duration cannot be metered from trusted events, so token spending for calls is not built;
- "stream health" relies on polling `ListParticipants`.

Required before call metering: an endpoint that verifies the webhook JWT (HS256 with the API secret plus the body's
SHA-256), records segments idempotently, and charges only overlapping two-party time.

### LIVE-03 · P2 · Connected participants are not ejected — Inferred, open

Tokens last 600 seconds, but a LiveKit connection outlives its join token. Blocking or suspending someone stops new
tokens, but anyone already in a room stays there until a moderator terminates the room or the emergency stop runs. Add
`RemoveParticipant` calls on block, suspension and session termination.

### BKG-02 · P2 · Accept does not re-check blocks — Inferred, open

`booking_respond` checks the companion's own suspension (`require_member`). It does not check whether either person
blocked the other after the request was made. Blocking hides the companion from search but does not cancel open
requests. Recommended fix: refuse `accept` when `private.blocked_either` is true, and cancel open requests on block.

### AUTH-02 · P2 · Self-declared age — Inspected, open (F-05)

18+ is enforced by `ProfileInput` (`ageMin`/`ageMax` ≥ 18) and `profiles.age between 18 and 100`. Nobody verifies the
number. Companion and creator verification is recorded manually by moderators. No verification vendor is integrated, and
the app does not claim otherwise.

### OPS-01 · P2 · Static site headers — Inspected, open

`helmet` protects the API. The static web service in `render.yaml` sets no `headers`, so there is no CSP,
`X-Frame-Options`, `Referrer-Policy` or `X-Content-Type-Options`. Add them in `render.yaml` after checking the Supabase
and API origins in a preview deploy. A wrong CSP breaks the app, so this needs a live test.

## Verified as sound (no change needed)

- **RLS:** all 44 public tables have RLS enabled. The four with no policies (`live_providers`, `moderation_actions`,
  `subscription_plans`, `transactions`) are deny-all for clients and reached only through definer functions.
- **Definer functions:** all 96 `SECURITY DEFINER` functions in `public`/`private` set `search_path = ''`. No trigger
  function is executable by API roles.
- **Admin functions:** all 31 `admin_*` functions refuse a plain member (each called with every argument null).
  `admin_set_role` refuses self-promotion. `private.user_roles` is unreadable by clients.
- **Booking integrity (PostgreSQL 16, two real sessions):**
  - two simultaneous accepts of one slot: exactly one wins;
  - cancel versus accept at the same moment: serialised by the row lock, history consistent;
  - prices are computed on the server (`private.booking_price`);
  - `payment_status` can only be `not_collected`;
  - reviews require a completed booking (marketplace suite).
- **Token wallet (new):**
  - clients cannot write balances or the ledger, or call `private.ledger_post`;
  - balances never go negative;
  - two simultaneous spends from one wallet: one succeeds;
  - a simultaneous replay of one spend is charged once;
  - ledger rows cannot be edited or deleted directly;
  - transfers, withdrawals, redemption, purchases and payouts are locked off by check constraints.
- **Storage:** the private `photos` bucket allows images only, up to 5 MB, writes only into the uploader's own folder,
  and reads only for signed-in users who are not blocked.
- **Realtime:** only `matches` and `messages` are published. Supabase Realtime applies RLS to them (Unverified: depends
  on production Realtime settings).
- **API:**
  - Supabase `getUser` verifies the token on every `/api/v1` route, failing closed (503) when unconfigured;
  - zod validates every body;
  - `helmet`, a CORS allowlist and a 100 kb body limit are in place;
  - 120 requests/minute per IP, and 20 joins/minute;
  - the provider listing is admin-only and never returns secrets;
  - `LIVEKIT_API_SECRET` must be the LiveKit-generated secret (32+ characters, no spaces, 12+ distinct characters; 16 before 2026-11-20) and never leaves the server.
- **Secrets:** no `.env` is committed. The policy guard scans every file for key patterns. `npm audit` reports 0
  vulnerabilities.

## Unverified assumptions

- Production Supabase exposes only `public` (and `graphql_public`) through the Data API, so `private` functions cannot
  be called directly. Check Settings → API → Exposed schemas.
- The local Supabase stand-ins (`supabase/tests/supabase_stubs.sql`) behave like Supabase for roles, `auth.uid()`,
  storage and realtime.
- Production has not received migrations `20261024…` onwards (F-03). None of these fixes are live.
