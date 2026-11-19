# RentMate — Release Readiness

Date: 2026-11-20 · Branch `feature/rentmate-conversion` · PR #1 (open, not merged). Nothing has been deployed;
production (Render services, Supabase project) is unchanged.

**Verdict: not production-ready.** The code is feature-complete for a supervised beta of dating, booking requests,
calls and live streaming, and is covered by automated tests. A release still needs:

- the founder approvals and external services below;
- real-device testing;
- independent security, privacy, legal and operational reviews.

## 1. What is ready (automated evidence in this session)

| Area                                  | Evidence                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Dating, profiles, safety              | Unit, SQL and browser smoke suites                                          |
| Booking marketplace                   | SQL suites + 5 real-PostgreSQL concurrency races                            |
| Voice and video calls                 | 47 real-media checks through a real LiveKit server (Chromium, fake devices) |
| Live broadcast, viewers, guests, chat | Same suite + SQL `calls_and_live_rooms` 57                                  |
| Token wallet (no charging)            | SQL 27 + upgrade test + concurrency; read-only wallet screen                |
| Admin MFA (switch off)                | SQL 28 + 24, browser 17                                                     |
| Security headers                      | Enforced in all three browser suites                                        |
| Rollback                              | Every migration since 2026-11-20 has rehearsed rollback SQL                 |

## 2. Release blockers

| #   | Blocker                                                                                                                                  | Owner            | Ref        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------- |
| R1  | Review and merge PR #1; CI green on `main`                                                                                               | Founder          | F-02, F-16 |
| R2  | GitHub default branch → `main` (Render follows it)                                                                                       | Founder          | F-26       |
| R3  | Production backup, then migrations `20261024090000` … `20261122090000` in order                                                          | Founder          | F-03       |
| R4  | LiveKit Cloud project (plan, terms, India region), webhook URL, `LIVE_WEBHOOK_DB_SECRET` set in Render and the database                  | Founder          | F-06       |
| R5  | Every admin and moderator enrols MFA; then switch mandatory MFA on                                                                       | Founder + admins | F-25       |
| R6  | Real-device testing on Android and iPhone over mobile networks (script in the test report)                                               | Founder / QA     | —          |
| R7  | Independent penetration test and code review (auth, RLS, webhooks, LiveKit)                                                              | External         | —          |
| R8  | Legal review: DPDP (retention F-20, consent, children), companionship marketplace terms, content policy, grievance officer               | External lawyer  | F-20, F-24 |
| R9  | Supabase Auth production settings (Site URL, redirects, SMTP, leaked-password protection, JWT expiry)                                    | Founder          | F-17       |
| R10 | Operational readiness: on-call contact, incident response, moderation staffing and response times, backups and restore drill, monitoring | Founder          | —          |

## 3. Founder decisions required

| Ref         | Decision                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-05 / F-04 | Age/identity provider and SMS provider (see Phase D in `RENTMATE_SECURITY_REMEDIATION.md`)                                                                                                                                                                           |
| F-08 / F-09 | Enforce free allowances and price extras; switch call metering on (after independent billing review)                                                                                                                                                                 |
| F-14        | Recording/HLS policy (needed for large-audience broadcasts)                                                                                                                                                                                                          |
| F-20        | Retention period for suspension hashes (default 730 days) after legal advice                                                                                                                                                                                         |
| F-25        | Date to require admin MFA                                                                                                                                                                                                                                            |
| F-27        | Visual identity: the latest brief asks for "black/charcoal, champagne-gold and white"; an earlier instruction was "don't use gold, make them light and dark", which the app follows today (monochrome light/dark). Nothing was changed; please confirm which applies |
| F-10 / F-24 | Payments, purchases and payouts stay off until legal, tax and provider approval                                                                                                                                                                                      |

## 4. Deployment checklist (when approved)

1. R1–R5 and R9 done; decisions recorded in `docs/FOUNDER_APPROVALS.md`.
2. Backup, then `select version from supabase_migrations.schema_migrations` compared with `supabase/migrations/`.
3. Apply migrations in order. Then:
   - `select private.set_integration_secret('livekit_webhook', '<secret>')` in the SQL editor;
   - check that the registration bonus count equals non-demo members;
   - run the Supabase security advisors.
4. Render env (values never in the repository):
   - API: `CORS_ORIGINS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
     `LIVEKIT_API_SECRET`, `LIVE_WEBHOOK_DB_SECRET`;
   - Web: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
5. Enable the LiveKit provider in the admin console. Set the LiveKit webhook URL to `/api/v1/live/webhook`.
6. Deploy from `main`. Then:
   - `GET /health`;
   - `curl -I` on the web URL to confirm the CSP and other headers;
   - a test call between two phones.
7. Rollback: Render "Rollback" for code; the database rollback SQL in `docs/rollback/` only with approval and after an
   export of `token_ledger`.

## 5. Must stay off

Token purchases, deposits, transfers between members, withdrawals, cash redemption, creator payouts, payment
collection, subscriptions and call metering. They are locked by database constraints or switches and covered by tests.
No adult content, nudity, sexual services or escorting, ever.
