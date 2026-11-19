# RentMate — Deep Code Audit

Date: 2026-11-19 · Repository: `Shivaaye-Technologies/RentMate` · Branch: `feature/rentmate-conversion` · Start commit:
`c58ee51` (= remote branch head and PR #1 head when the audit began) · Base: `main` at `b34bf5b`.

Findings and fixes are in `RENTMATE_SECURITY_FINDINGS.md`; deployment in `RENTMATE_DEPLOYMENT_READINESS.md`; open items
in `RENTMATE_REMAINING_WORK.md`.

**Evidence labels:** **Verified** = executed in this session · **Inspected** = read in code · **Inferred** = reasoned risk ·
**Unverified** = assumption about an environment not reachable from here (production Supabase, Render, GitHub settings).

## 1. Method

| Area                     | How it was examined                                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database (19 migrations) | All migrations applied to a disposable PGlite database and to a fresh **PostgreSQL 16.15** server started for this audit (local socket, deleted afterwards). Catalog queries for RLS, policies, grants, definer functions, search paths, execute rights, storage, realtime and foreign-key cascades. |
| Exploits                 | Scripted attempts as real `authenticated` members: back-dated rows against rate limits, suspended-account actions, every `admin_*` function as a plain member, role escalation, account deletion side effects.                                                                                       |
| Concurrency              | Two simultaneous PostgreSQL sessions: double accept of one slot, idempotent retry, cancel versus accept, and (after the wallet was added) double spend and replayed spend. Now automated in `scripts/test-db-concurrency.sh` and in CI.                                                              |
| API                      | Read every route, middleware and config; ran the API suite.                                                                                                                                                                                                                                          |
| Live                     | Read the provider, policy, store and route code; ran the provider tests; checked token claims and grants.                                                                                                                                                                                            |
| Frontend                 | Mapped every screen's data module to the backend call it makes (RPC, table, API route, storage, realtime); searched for placeholder or mock controls.                                                                                                                                                |
| Static analysis          | CodeQL CLI 2.27.4 (official bundle): `javascript-code-scanning` (GitHub default setup), `javascript-security-extended` and `actions-security-extended`.                                                                                                                                              |
| Deployment               | Read `render.yaml`, `.env.example`, both deployment guides, health endpoints and CORS/proxy config.                                                                                                                                                                                                  |

## 2. Architecture as built (Inspected)

- **API** (`apps/api`, Express 4, TypeScript):
  - every `/api/v1` route goes through `requireAuth`, which calls Supabase `auth.getUser`;
  - routes: `PUT /profile` and `GET /matches` (ranking), plus the live routes (token issue, stats, moderation, emergency
    stop, health, provider status);
  - the API calls Supabase with the caller's own token, so RLS applies to API reads too.
- **Web** (`apps/web`, React 18 + Vite) talks to Supabase directly (RLS-protected tables and definer RPCs) for almost
  everything. It uses the API only for discovery ranking and live moderation.
- **Database** (Supabase Postgres): 44 public tables, all with RLS. Business rules live in database functions: booking
  state machine, pricing, suspension, live policy checks, admin actions with an audit log, and now the token ledger.
- **Live**: a LiveKit adapter signs HS256 room tokens server-side. The database decides who may join. There is no media
  client in the web app (see §4).

## 3. Area findings

### Database and Supabase (Verified unless marked)

- **RLS** on all 44 public tables. Policies are scoped to `authenticated`. Four tables are deliberately deny-all for
  clients.
- **Definer functions:** all 96 set `search_path = ''`. Private helpers are not executable by `anon`, except two harmless
  ones: `live_report_priority`, a pure function, and `demo_mode_profiles`, which backs the public demo.
- **Admin:** 31 `admin_*` functions, all refusing non-staff. Role grants are protected. Admin actions are written to
  `moderation_actions` (marketplace suite checks five kinds).
- **Protected records:** clients have no write path to bookings, prices, statuses, reviews, roles, transactions,
  subscription plans, wallet balances or ledger rows. Column grants restrict companion, service and profile edits to
  safe columns.
- **Fixed in this round:**
  - SEC-01: client timestamps defeated rate limits;
  - SEC-02: suspension enforcement gaps;
  - SEC-03: excess default privileges.
- **Open:** SEC-04, account deletion removes suspension/appeal history (F-20).
- **Fresh database:** all 19 migrations apply in order to an empty PostgreSQL 16 database and to PGlite. The demo seed
  runs twice without change (idempotent).
- **Rollback:** the rollback SQL for the two new migrations was rehearsed. The schema matched the pre-change database
  across 620 objects, earlier suites passed after rollback, and re-applying was clean.
- **Realtime and storage:** see Security Findings, "Verified as sound".

### Authentication, authorisation and admin (Inspected; tests Verified)

- Email/password sign-up, confirmation resend, sign-in, sign-out and password reset use Supabase Auth. Phone OTP is not
  built (F-04).
- **18+:** enforced on the declared age (API zod and the `profiles.age` check). Not verified by a vendor (AUTH-02, F-05).
- **Sessions:** Supabase JWTs. Suspension is enforced per request in the database and does not end existing sessions.
  The API re-verifies the token on every request.
- **Roles:** database-enforced. Changing frontend state cannot grant powers, because every privileged path is a definer
  function checking `private.has_role`.
- **Gaps:**
  - no MFA for admins (AUTH-01, P1, F-25);
  - no admin user-search screen;
  - admin audit entries are recorded, but there is no audit-log viewer beyond `admin_moderation_log`.

### Booking marketplace (Verified)

| Requirement                                       | Result                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Only approved companions listed                   | Yes: `private.companion_visible` (approved, not suspended, not blocked)                                    |
| Only allowed non-sexual activities                | Yes: services reference the 12-item `activity_categories` allow-list; prohibited text screened             |
| No residential addresses as locations             | Yes: `area_not_an_address` and meeting-point checks refuse house numbers and PIN codes (marketplace suite) |
| Server calculates prices                          | Yes: `private.booking_price`; the client never sends a price                                               |
| State transitions validated server-side           | Yes: definer RPCs with row locks; clients have no UPDATE on bookings                                       |
| Concurrent double-booking prevented               | Yes: exclusion constraints, proven with two real PostgreSQL sessions                                       |
| Temporary holds expire                            | **Not applicable / not built.** Requests do not reserve a slot; only acceptance does                       |
| Rescheduling reserves the new slot atomically     | **Not built.** Members cancel and re-request                                                               |
| Cancellation, disputes, refunds consistent        | Cancellation and disputes yes; refunds do not exist because no money is collected                          |
| Reviews require a completed booking               | Yes (marketplace suite)                                                                                    |
| Suspended or blocked users cannot book or message | Suspended: yes. Blocked: hidden from search and chat, but accept does not re-check blocks (BKG-02)         |
| Audit trail consistent                            | Yes: every transition writes `booking_events`; concurrency test checks the history                         |
| Expired requests                                  | Fixed: no longer lock members out (BKG-01)                                                                 |

### Token and financial accounting (Verified)

| Rule                                       | State after this round                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration bonus 100                     | **Built**: once per member via ledger, replay-safe; existing members backfilled on migration; demo profiles excluded                                      |
| Voice 10/min, video 1/sec                  | Rates stored in `metering_rates`; **not charged** (no call screen, no trusted webhook events: LIVE-01/02)                                                 |
| 50 free likes / 10 free messages per 24 h  | Stored; **not enforced** (`allowances_enforced = false`, founder decision F-08). Today: 300 likes/24 h, 20 messages/min                                   |
| Limits on the server, rolling 24 h         | Existing limits are server-side with rolling windows, and now cannot be bypassed with client timestamps (SEC-01)                                          |
| No transfers, cash redemption, withdrawals | Locked by check constraints in `financial_flags`; no function exists for them                                                                             |
| No creator payouts                         | Locked (`payouts_off`)                                                                                                                                    |
| Payments and subscriptions disabled        | Locked (`payments_enabled`, `subscriptions_enabled`, `subscription_plans.active`, `token_purchases`)                                                      |
| Ledger integrity                           | Append-only; non-negative; balance equals the ledger sum; per-entry running balance; idempotency keys; double-spend and replay races tested on PostgreSQL |
| Browser timers never trusted for billing   | Nothing is billed. Call metering must use verified LiveKit webhooks (LIVE-02)                                                                             |

### Live streaming (Inspected; tests Verified)

- **Joining:** only authorised users. The database decides watch, broadcast and session access (role, approval,
  verification, consent, country, blocks, emergency stop, and now suspension) before the API issues a token.
- **Tokens:** 600-second lifetime, scoped to one room. Viewers get `canPublish: false`, data publishing is off, and join
  tokens carry no room-admin or recording grants. Admin tokens last 60 seconds and are used only server-side.
- **Moderation:** creator and moderator controls are server-enforced. Terminate and emergency stop update the database
  first, then close provider rooms. Unit tests cover them with a fake provider. **Not tested against a real LiveKit
  server.**
- **Recording:** none. No egress or recording API is called, and no recording grant is issued (F-14).
- **Credentials:** the API secret and key stay on the server. The provider-status endpoint shows only "configured:
  yes/no".
- **Reporting and blocking:** both work during live sessions through `live_reports` and `blocks`. Blocking does not eject
  someone already connected (LIVE-03).
- **Reconnection:** not applicable; there is no client.
- **Scale:** large-audience broadcasting is not claimed. Rooms are ordinary LiveKit rooms with no load testing.
- **Demo-only:** "Start stream" in Creator Studio marks a stream live in the database, but no camera connects (LIVE-01).

## 4. Frontend feature classification (Inspected)

"API-backed" means the action goes through Supabase RLS, a database function or the RentMate API. These are the
categories the brief asked for.

| Feature                                                                                                                                  | Classification                                 | Backend calls (data module)                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Sign up, sign in, email confirmation, password reset                                                                                     | Fully implemented, API-backed                  | Supabase Auth (`AuthScreen.tsx`)                                                                     |
| Phone OTP                                                                                                                                | Blocked by missing provider                    | Not built (F-04)                                                                                     |
| Onboarding and profile editing                                                                                                           | Fully implemented, API-backed                  | `profiles` table (RLS, column grants). `PUT /api/v1/profile` exists but the web app does not call it |
| Photos                                                                                                                                   | Fully implemented, API-backed                  | Storage bucket `photos`, `profiles.photos`                                                           |
| Discovery and ranking                                                                                                                    | Fully implemented, API-backed                  | `GET /api/v1/matches`; `likes`, `passes`                                                             |
| Likes, matches, likes-you                                                                                                                | Fully implemented, API-backed                  | `likes`, `matches`, `profiles_by_ids`                                                                |
| Dating chat (with realtime) and "ready to meet"                                                                                          | Fully implemented, API-backed                  | `messages`, `match_reads`, realtime channel, `set_ready_to_meet`                                     |
| Dating voice and video calls                                                                                                             | **UI-only / not present**                      | No call screen exists; the sign-in page says "soon"                                                  |
| Blocking, reporting, safety sheet                                                                                                        | Fully implemented, API-backed                  | `blocks`, `reports`, `my_blocked_users`                                                              |
| Account deletion                                                                                                                         | Fully implemented, API-backed                  | `delete_my_account` (see SEC-04 on what it removes)                                                  |
| Browser notifications                                                                                                                    | Implemented but incomplete                     | Browser Notification API from realtime counts; no email or push                                      |
| Demo mode                                                                                                                                | Demo/mock by design (labelled)                 | `demo_mode_profiles` (anon)                                                                          |
| Companion marketplace: search, profiles, shortlists                                                                                      | Fully implemented, API-backed                  | `companions_search`, `companion_rating`, `shortlists`                                                |
| Booking request, respond, cancel, complete, dispute                                                                                      | Fully implemented, API-backed                  | `booking_*` RPCs                                                                                     |
| Rescheduling, calendar export, reminders                                                                                                 | Not built                                      | —                                                                                                    |
| Member ↔ companion chat                                                                                                                  | Fully implemented, API-backed                  | `conversations`, `conversation_messages`, `conversation_open/mark_read`                              |
| Reviews                                                                                                                                  | Fully implemented, API-backed                  | `review_create`, `reviews`                                                                           |
| Companion dashboard (profile, services, availability, pause, earnings view)                                                              | Fully implemented, API-backed                  | Column-granted tables, `companion_set_paused`, `companion_earnings` (illustrative, no payouts)       |
| Marketplace admin (verification, bookings, disputes, reviews, suspensions, appeals, commission, stats)                                   | Fully implemented, API-backed                  | `admin_*` RPCs                                                                                       |
| Payments, subscriptions                                                                                                                  | Blocked (disabled by design, F-10/F-24)        | Locked by constraints                                                                                |
| Creator Studio: application, agreement, verification status, availability, schedule, consents, tickets, appeals, private-session answers | Implemented but incomplete                     | `creators`, `live_*` RPCs and tables; no media                                                       |
| Creator "Start stream" / "End stream"                                                                                                    | Implemented but incomplete                     | Changes database state only; no camera or LiveKit connection                                         |
| Live discovery and viewer screen                                                                                                         | **Not present**                                | `GET /api/v1/live/streams` and `/join` exist, but no screen calls them                               |
| Live admin console: reports, creators, verification records, country policies, providers, terminate, emergency stop, health              | Implemented; provider blocked by configuration | `admin_*` RPCs and `/api/v1/live/*`; LiveKit row `disabled` until F-06                               |
| Token wallet                                                                                                                             | Backend only                                   | `token_wallets`, `token_ledger` (no screen yet)                                                      |

No button was found whose action is faked on the client.

## 5. Test inventory after this round (Verified in this session)

| Suite                                               | Result                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| Policy guard self-test / repository scan            | 56/56 · all files clean                                   |
| API unit tests                                      | 83/83                                                     |
| Web unit tests                                      | 159/159                                                   |
| SQL suites (PGlite), 11 files                       | All pass (new: audit_hardening 26/26, token_wallet 27/27) |
| Real-PostgreSQL concurrency (`test:db:concurrency`) | 5/5                                                       |
| Rollback rehearsal (`test:rollback`)                | Pass (620 objects identical)                              |
| Hooks · aihub · browser smoke · build               | See the final report in PR #1                             |
| CodeQL (local 2.27.4)                               | 1 result: CQ-02 false positive                            |

Mutation checks: without `20261120090000_audit_hardening.sql`, 18 checks in `audit_hardening.sql` fail and the
idempotent-retry concurrency case fails. With it, all pass.
