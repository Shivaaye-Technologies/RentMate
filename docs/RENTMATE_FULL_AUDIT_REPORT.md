# RentMate — Full Platform Audit (Phase 2, read-only)

Date: 2026-11-20 · Repository `Shivaaye-Technologies/RentMate` · Branch `feature/rentmate-conversion` · Audited at
`c5aa208` (application code identical to GitHub's `1cea99b`; `c5aa208` adds a bundle-secret test and documentation only).

**Method.** Read-only. No application code, migration, setting or production system was changed. Evidence labels:

- **Verified**: reproduced in this session by running code. Schema findings come from all 24 migrations applied to a
  throwaway PGlite database and queried through `pg_catalog`. Browser findings come from Chromium (Playwright) and
  axe-core 4.10.2.
- **Inspected**: read in the code, not executed.
- **Unverified**: depends on production settings this session cannot see (Supabase dashboard, Render, GitHub).

Companion documents: `RENTMATE_SECURITY_FINDINGS.md` (Phase 2 section), `RENTMATE_DEPLOYMENT_READINESS.md` (Phase 2
section), `SECURITY_NOTES_LIVEKIT_JWT.md`, `POST_CI_SECURITY_AUDIT.md`, `RENTMATE_PHASE3_PROPOSALS.md`.

## Phase 3 status (2026-11-20, approved fixes)

Committed locally on `feature/rentmate-conversion`; **not pushed, not merged, not deployed, no production
migration applied.** The rest of this report is the original Phase 2 text, unchanged.

| ID                                | Status               | Commit(s)             | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-04                             | Fixed                | `6fbd3d9`             | Storage read policy now uses `private.can_view_photo()`: own folder, or a **published** photo of a member who is visible to you and not blocked either way. Unpublished files and hidden/blocked members' photos cannot be listed or downloaded. Signed URLs shortened to 10 min.                                                                                                                                                                                                                                                                                                                                  |
| P2-05                             | Fixed                | `923d939` + `ac396b7` | `DELETE /api/v1/account` removes every photo with the member's session, then deletes the account. A database trigger refuses self-deletion while photos remain, so closing the browser or calling the RPC directly cannot leave orphans. Retry-safe; admins can list orphans. `923d939` alone fails the policy guard; `ac396b7` fixes it (no history rewrite). Correction: the browser fallback (removing photos and calling `delete_my_account` from the browser when the API was unreachable) is removed; deletion goes through the API only, and any failure leaves the account untouched with a retry message. |
| P2-03                             | Prepared (not a fix) | `0369f63`             | Date of birth + explicit "I am 18 or older" confirmation at sign-up and onboarding; stored privately as `self_declared`. **This is not age or identity verification.** The `require_age_attestation` switch is off; public launch is not enabled. Provider options in `RENTMATE_PHASE3_PROPOSALS.md`.                                                                                                                                                                                                                                                                                                              |
| —                                 | Test harness fix     | `42c671a`             | PGlite `auth.uid()` stub now treats empty JWT claims as no user, matching Supabase. Found by the full run after `0369f63`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P2-01, P2-02, P2-06, P2-07, P2-08 | Proposals only       | —                     | See `RENTMATE_PHASE3_PROPOSALS.md`. Not implemented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Verification on `42c671a` (run in this session, all PASS):** npm ci; policy guard; Prettier; ESLint; typecheck; API
118/118 and web 184/184 unit tests; demo generator 13/13; 19 SQL suites 539/539 (new: `photo_privacy` 14,
`account_deletion_photos` 11, `age_attestation` 22); build; bundle-secrets scan; hook tests; aihub; rollback
rehearsal (incl. the three new rollbacks); wallet upgrade; browser smoke (16 checks, incl. the 18+ confirmation),
admin MFA and RTC e2e; concurrency on PostgreSQL 16; `npm audit` 0 vulnerabilities. Mutation checks: removing each
new guard makes its tests fail.

## 1. Summary

| Severity      | Count | IDs                                                                                                                                                                                                      |
| ------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical      |     0 | —                                                                                                                                                                                                        |
| High          |     3 | P2-01 prohibited-text filter bypass · P2-02 "public place" bypass · P2-03 self-declared age                                                                                                              |
| Medium        |     5 | P2-04 photo bucket readable by every member · P2-05 photos survive account deletion · P2-06 geolocation blocked in production · P2-07 API on Render free plan · P2-08 Supabase Auth settings unversioned |
| Low           |     6 | P2-09 to P2-14                                                                                                                                                                                           |
| Informational |     6 | P2-15 to P2-20 (including CodeQL alert #3)                                                                                                                                                               |

**What is solid** (Verified unless marked):

- **Database access control.**
  - All 49 public tables have row-level security; no client role can touch the 12 private tables.
  - All 150 `SECURITY DEFINER` functions have an empty `search_path`.
  - Anonymous visitors can run only the demo-profile function and three secret-guarded integration functions.
  - Other members cannot read location coordinates; `verified`, `is_tester` and `is_demo` are not client-writable.
- **Bookings.**
  - Double booking is prevented by exclusion constraints plus row-level checks, and races are tested on PostgreSQL 16.
  - Every marketplace, call and live-chat function requires a signed-in, profiled (18+), unsuspended member
    (`private.require_member`).
- **Token ledger.**
  - Append-only, with a non-negative balance and row locks.
  - A unique idempotency key makes a replay return the original entry; reusing a key for different values is refused.
  - The registration bonus is granted once per member.
  - Purchases, deposits, transfers, withdrawals, cash redemption and payouts are all pinned off by CHECK constraints.
- **LiveKit.**
  - Tokens are issued server-side only after a database check.
  - HS256 only, with constant-time comparison and `exp`/`nbf` enforced.
  - Admin tokens carry minimum grants for 60 seconds.
  - Host mutes are persistent and enforced by LiveKit.
  - No recording or egress grant exists.
  - The secret never reaches the browser bundle.
- **API.**
  - helmet, a CORS allowlist and a 100 kB JSON limit.
  - 120 requests a minute per IP before authentication.
  - Supabase session check on every request (revocation honoured).
  - Fails closed with 503 when unconfigured.
  - zod validation on every body.
- **Web.**
  - Strict CSP, HSTS, `X-Frame-Options: DENY`.
  - No horizontal scrolling at 390 px on any screen tested.
  - One accessibility violation found (P2-12).

## 2. Prioritised issue list

### High

**P2-01 — Prohibited-content filter is easy to bypass** · Verified

- **Where:** `supabase/migrations/20261118100000_policy_hardening.sql:12-24` (`private.prohibited_text`), applied by
  `private.reject_prohibited_text` (`20261119090000_marketplace.sql:515-559`) to profiles, likes, messages, companion
  profiles and services, bookings, reviews and live titles, and by live chat (`20261121090000_calls_and_live_rooms.sql:678`).
- **Evidence:** the function called directly on the final schema.

  |             | Phrases                                                                                                                                                                                                                                 |
  | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Refused     | "escort service", "sexual services", "OnlyFans link"                                                                                                                                                                                    |
  | **Allowed** | "happy ending massage", "nude photos" (only the plural _nudes_ is listed), "n00ds", "s3x", "e$c0rt", "es cort", "full service", "body massage", "hookup", "sugar daddy", "one night stand", "fwb", "overnight", "night stay", "sensual" |

- **Impact:** the core legal promise (no sexual services or solicitation) rests on a 13-term regular expression. Common
  solicitation wording, misspellings and spacing pass into companion listings, booking notes and messages.
- **Reproduce:** `select private.prohibited_text('happy ending massage');` returns null (allowed).
- **Fix:**
  1. Normalise before matching: lower-case, strip punctuation and spacing between letters, map look-alike characters
     (0→o, 3→e, $→s, @→a).
  2. Expand the term list with code-switched Hindi/Hinglish terms, reviewed by the founder and counsel.
  3. Hold the risky categories (massage, overnight, travel companion) for human review instead of publishing them.
  4. Rate-limit and flag repeat attempts.
- **Tests:** an SQL suite with refused phrases (including every one above and obfuscated forms), allowed phrases (to
  catch false positives, for example "Sussex", "massage chair shopping"), and the trigger on each table.

**P2-02 — "Public place only" for meetings is a word filter, and private venues pass** · Verified

- **Where:** `20261119090000_marketplace.sql:114-121` (`private.looks_like_address`) and `:317` (constraint
  `meeting_point_public`).
- **Evidence:**

  |             | Meeting points                                                                                                                                                                  |
  | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Refused     | "my flat", "Flat 4B", "411001 Pune"                                                                                                                                             |
  | **Allowed** | "my hotel room", "Hotel Taj, room 204", "OYO Rooms Andheri", "my place", "your home", "Airbnb near station", "private room upstairs", "lodge near station", "my car in parking" |

- **Impact:** companionship must be limited to lawful, non-sexual, public or social activities. Free text lets a booking
  name a hotel room or a home, which is the main legal and safety exposure of the marketplace.
- **Reproduce:** `select private.looks_like_address('my hotel room');` returns false (accepted).
- **Fix:** replace free text with a structured choice of public venue types (café, restaurant, mall, park, museum,
  cinema, co-working, event venue) plus a venue name. Refuse lodging words (hotel, room, OYO, lodge, Airbnb, home,
  place, car) in the name. Show safety guidance, and offer a "report unsafe location" action on the booking.
- **Tests:** the SQL suite above for meeting points, plus a booking request with each refused phrase failing with 23514.

**P2-03 — 18+ rests on a self-entered age** · Inspected · Founder decisions F-04/F-05

- **Where:** `apps/api/src/validation.ts:6` (min 18), `supabase/migrations/20261022210236_init.sql:8`
  (`check (age between 18 and 100)`), sign-up notice text at `apps/web/src/components/AuthScreen.tsx:413`.
- **Evidence:** age is an integer the member types. There is no date of birth, no age or identity check, and no
  explicit 18+ confirmation control at sign-up (the form shows notice text). `verified` is admin-set only.
- **Impact:** a minor can join by typing 18. For a dating and companionship platform this is a legal and safety
  blocker, not a code bug.
- **Fix:**
  1. Add a required "I am 18 or older" confirmation at sign-up, stored with a timestamp.
  2. Collect a date of birth (stored, not shown) and refuse anyone under 18 on the server.
  3. Integrate an age or ID verification provider before companions or live broadcasting (F-04/F-05).
  4. Gate companion listing and broadcasting on `verified`.
- **Tests:** API and SQL refuse a date of birth under 18; the sign-up form cannot submit without the confirmation;
  a companion cannot publish while unverified.

### Medium

**P2-04 — Every signed-in member can read (and likely list) every member's photos** · Inspected (policy text)

- **Where:** `20261023101225_safety_profile_functions_delete_account.sql:138-142`, policy _"photos read signed-in unless
  blocked"_: `bucket_id = 'photos' and not private.blocked_either(folder owner)`.
- **Impact:** any account can read every member's folder in the private bucket, not just people discovery would show
  them. That includes paused, hidden or suspended members, unused uploads, and photos of deleted accounts (P2-05).
  Supabase Storage's list call is governed by the same `SELECT` policy, so bulk enumeration is expected to work.
  Scraping risk for a dating app.
- **Reproduce (staging):** sign in as A, then `supabase.storage.from('photos').list('<B's user id>')` for a B that A was
  never shown. Expected: files listed.
- **Fix:** restrict `SELECT` to the owner, or to profiles the caller may see (`private.people` / `companion_visible`
  rules), or serve photos only through short-lived signed URLs created by a definer function after that check.
- **Tests:** a staging or local-Supabase test that A cannot list or download B's photos unless B is visible to A; still
  works for matches and discovery.

**P2-05 — Account deletion does not remove photos on the server** · Inspected

- **Where:** `apps/web/src/components/AccountPanel.tsx:33-45` removes files in the browser, then calls
  `delete_my_account` (`20261023101225_…:80-92`), which deletes only `auth.users`.
- **Impact:** if the remove call is skipped (direct RPC, network failure after the remove, missed files), photos outlive
  the account and, under P2-04, stay readable by every member. This is a data-protection exposure: deletion must be
  complete.
- **Fix:** delete storage objects on the server. Use an API endpoint using the Storage API with a server-only key, or a
  scheduled sweep that removes objects whose folder owner no longer exists. Also tighten P2-04.
- **Tests:** after `delete_my_account`, no object remains under the user's folder (staging); a sweep test with an
  orphaned folder.

**P2-06 — "Share approximate location" cannot work in production** · Verified

- **Where:** `render.yaml:78` sends `Permissions-Policy: … geolocation=() …`; `apps/web/src/components/Settings.tsx:160`
  calls `navigator.geolocation.getCurrentPosition`.
- **Evidence:** Chromium with geolocation permission granted.

  | Header                        | Result                                                                                       |
  | ----------------------------- | -------------------------------------------------------------------------------------------- |
  | `geolocation=()` (production) | `PERMISSION_DENIED: "Geolocation has been disabled in this document by permissions policy."` |
  | `geolocation=(self)`          | Returns the position                                                                         |

- **Impact:** the distance feature is dead in production, and the error message wrongly tells members to change their
  browser settings.
- **Fix:** `geolocation=(self)` in `render.yaml` (and `scripts/lib/render-headers.mjs` follows automatically).
- **Tests:** a browser check under the production headers that "Share approximate location" saves a rounded position.

**P2-07 — API on Render's free plan** · Inspected

- **Where:** `render.yaml:7` (`plan: free`).
- **Impact:** free services sleep when idle and cold-start slowly. The API also drains the room-removal queue every 3
  seconds (`apps/api/src/server.ts:52-56`), which is how blocked, suspended and removed people are taken out of live
  rooms. While asleep, those removals wait until the next request wakes it, which is a safety-enforcement delay.
  Webhook deliveries can time out during a cold start.
- **Fix:** a paid instance with a health check (at least one always-on instance) before launch; alert on drain failures.
- **Tests:** none in code; an operational check after deploy.

**P2-08 — Supabase Auth settings are not in the repository** · Unverified

- **Where:** no `supabase/config.toml`; the password minimum is enforced only in the browser
  (`apps/web/src/auth.ts:93`, `PASSWORD_MIN = 8`; `AuthScreen.tsx:341`).
- **Impact:** password length and strength, leaked-password protection, email confirmation, auth rate limits, session
  lifetime and redirect URL allowlist exist only in the dashboard and cannot be reviewed or reproduced. Supabase's own
  minimum (6 unless changed) applies to direct API sign-ups, bypassing the 8-character rule.
- **Fix:** set them in the dashboard and record them: minimum 8 or more, leaked-password protection if the plan allows,
  email confirmation on, redirect allowlist limited to the production origin. Add `supabase/config.toml` or a checked-in
  settings document, and re-check after every change.
- **Tests:** a staging sign-up with a 7-character password via the Supabase API is refused.

### Low

| ID    | Finding                                                                                                                                                                                                                                              | Where                                                                                                         | Fix                                                                                       | Tests                                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P2-09 | `anon` holds `SELECT` on `blocks`, `likes`, `matches`, `messages`, `passes`, `reports`. Verified. No rows are exposed today (every policy is `TO authenticated`), but one mistaken `TO public` policy would expose them                              | Supabase default privileges, never revoked (`20261120090000_audit_hardening.sql:244-249` revoked writes only) | New migration: `revoke select on … from anon`                                             | Catalog test: anon has no privilege on public tables except where intended |
| P2-10 | `transactions.kind` allows `payout` and `subscription`; nothing writes the table and clients cannot. Verified                                                                                                                                        | `20261119090000_marketplace.sql:494`                                                                          | New migration restricting kinds, or drop the unused table after review                    | Constraint test                                                            |
| P2-11 | 33 foreign keys without an index on the leading column. Verified. Examples: `booking_events.booking_id`, `transactions.user_id`, `conversation_messages.sender_id`, `live_chat_messages.sender_id`, `bookings.service_id`, `live_streams.creator_id` | Several migrations                                                                                            | One migration adding the indexes used by lookups and `ON DELETE` cascades                 | Catalog test: no unindexed foreign keys (or an allow-list)                 |
| P2-12 | Colour contrast below WCAG AA on the "available" status pills on the sign-in page. Verified, axe-core                                                                                                                                                | `apps/web/src/styles.css:3458`; `AuthScreen.tsx:186`, `:193`                                                  | Darken text or lighten background to at least 4.5:1                                       | axe check in the browser smoke test                                        |
| P2-13 | No runtime ledger reconciliation (balance = sum of entries); only the tests check it                                                                                                                                                                 | `20261120100000_token_wallet.sql`                                                                             | Admin read-only reconciliation view or scheduled check with alert                         | SQL test for the view                                                      |
| P2-14 | Backups and restore never rehearsed; backup availability depends on the Supabase plan. Unverified                                                                                                                                                    | `docs/RENTMATE_ROLLBACK_PLAN.md:21`                                                                           | Confirm plan backups (or point-in-time recovery); rehearse a restore to a scratch project | Recorded restore drill                                                     |

### Informational

| ID    | Note                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-15 | **CodeQL alert #3** (`js/insufficient-password-hash`, `apps/api/src/live/providers.ts:70`): false positive, open pending founder approval. Evidence in `SECURITY_NOTES_LIVEKIT_JWT.md`                                         |
| P2-16 | Most data access goes straight from the browser to Supabase. The API's 120/min limit does not cover it; abuse limits are the per-table write limits in SQL and Supabase's own limits. Discovery is capped at 500 rows per call |
| P2-17 | `/health` (`apps/api/src/app.ts:153`) reports `authConfigured` but does not check the database or LiveKit; logs are `console` lines without request ids                                                                        |
| P2-18 | Render service names are still `soulmate-api` / `soulmate-web` (`render.yaml:5`, `:41`); auto-deploy only from `main`                                                                                                          |
| P2-19 | Build warning: two bundles over 500 kB (`index` 667 kB / 188 kB gzip; lazy LiveKit `room` 580 kB / 152 kB gzip)                                                                                                                |
| P2-20 | Fake accounts: email-only sign-up (no phone check, F-04), manual verification; tokens have no cash value, so bonus farming has no financial impact                                                                             |

## 3. Coverage by area

| Area                         | State                                                                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Authentication            | Supabase Auth; server-side session check per request; MFA (TOTP, `aal2` for admin roles once enforced, recovery codes) tested in the browser. Gaps: P2-03, P2-08                                                                                                 |
| 2. Database                  | RLS complete, definer functions safe, migrations append-only, ordered and guarded, rollback rehearsed for 6 steps. Gaps: P2-09, P2-10, P2-11                                                                                                                     |
| 3. Dating and social         | Profiles, discovery (rounded distance, blocked people hidden), likes, matches, messages (participants only), blocking and reporting tested. Gaps: P2-04, P2-05, P2-06, P2-01                                                                                     |
| 4. Marketplace               | Availability windows, notice and advance limits, open-request caps, double-booking prevention (tested on PostgreSQL 16), cancellation policy text, disputes with admin resolution, reviews, commission recorded per booking (no money moves). Gaps: P2-01, P2-02 |
| 5. Token ledger              | Sound; P2-13                                                                                                                                                                                                                                                     |
| 6. Live and LiveKit          | Sound; P2-07 affects removal latency; P2-15                                                                                                                                                                                                                      |
| 7. Moderation and compliance | 18+ (P2-03), adult-content constraints and filters (P2-01, P2-02), reports, blocks, suspensions with appeal, account deletion (P2-05), privacy pages present                                                                                                     |
| 8. Frontend and API          | Validation, CORS, headers good; P2-06, P2-12, P2-19; no dead routes found in the screens reachable without a backend                                                                                                                                             |
| 9. Infrastructure            | P2-07, P2-08, P2-14, P2-17, P2-18                                                                                                                                                                                                                                |
| 10. Tests                    | See §4 and §5                                                                                                                                                                                                                                                    |

## 4. Test results

Run on `c5aa208` from a clean `npm ci` (Node 22.22.0, npm 10.9.4). Every command was executed in this session.

| Check                                         | Command                             | Result                                               |
| --------------------------------------------- | ----------------------------------- | ---------------------------------------------------- |
| Install                                       | `npm ci`                            | Pass                                                 |
| Policy guard and advisory matcher             | `npm run test:policy`               | 103/103 policy cases, 443 files clean; matcher 12/12 |
| Format / lint / types                         | `format:check`, `lint`, `typecheck` | Pass, 0 lint warnings                                |
| API unit tests                                | `npm test`                          | 108/108                                              |
| Web unit tests                                | `npm test`                          | 175/175                                              |
| Database suites (PGlite)                      | `npm test`                          | 16 suites, 492 checks                                |
| Production build                              | `npm run build`                     | Pass; 1 warning (P2-19)                              |
| Server secrets absent from the browser bundle | `npm run test:bundle-secrets`       | 4/4 absent                                           |
| Rollback rehearsal                            | `npm run test:rollback`             | 6/6 steps                                            |
| Wallet upgrade                                | `npm run test:wallet-upgrade`       | 6/6                                                  |
| Concurrency on PostgreSQL 16                  | `npm run test:db:concurrency`       | 5/5                                                  |
| Browser smoke under production headers        | `npm run test:e2e`                  | 13/13                                                |
| Admin MFA in the browser                      | `npm run test:e2e:mfa`              | 17/17                                                |
| Real-media LiveKit 1.13.11                    | `npm run test:e2e:rtc`              | 59/59                                                |
| Hook guards / aihub                           | `test:hooks` / `test:aihub`         | 21/21 / 32/32                                        |
| Dependency audit                              | `npm audit`                         | 0 vulnerabilities                                    |

Audit-only checks (not committed scripts): schema catalogue queries on all 24 migrations; filter probes for P2-01 and
P2-02; axe-core WCAG 2.1 A/AA and 390 px layout on six screens (1 violation, 0 overflow); geolocation under production
headers (P2-06).

**Every test passes, yet the High findings stand.** The suites test what the code was designed to do. They do not
cover the bypass phrases, storage behaviour or production headers above.

## 5. Missing test coverage

1. Prohibited-text and meeting-point phrase suites (P2-01, P2-02).
2. Storage policies: nothing tests `storage.objects` behaviour against a real Supabase Storage (P2-04, P2-05).
3. A browser check under production headers for location sharing (P2-06).
4. Catalog regression tests: no anon table privileges (P2-09), no unindexed foreign keys (P2-11).
5. Accessibility checks in CI (P2-12).
6. Signed-in screens against a real Supabase (local stack or staging) beyond the mocked browser tests.

## 6. Recommended order

1. **Before any real users:** P2-01, P2-02 and P2-03 (with founder and legal input), P2-04, P2-05.
2. **Before launch:** P2-06 (one-line fix), P2-07, P2-08, P2-14.
3. **Hardening:** P2-09 to P2-13.

No fix has been made. Each needs founder approval first; P2-01 to P2-03 also need legal review of the wording and
venue rules.
