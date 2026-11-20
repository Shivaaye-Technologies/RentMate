# RentMate Conversion — Delivery Report

Date: 2026-11-18 · Repository: `rentmate970-hue/RentMate` · Branch: `feature/rentmate-conversion` (local; push blocked,
see Blockers) · Statuses: Completed · Partially completed · Not started · Blocked.

"Completed" means built, wired into the app and covered by tests that ran and passed in this session. Nothing is
deployed; production is unchanged.

## 1. Repository audit

See `RENTMATE_SOURCE_TARGET_REPORT.md`. Target had one commit (README only). Source (Soulmate-AI) is unreachable on
GitHub (owner account suspended) and was used from the verified local copy; its full history is now in the target.

## 2. Reused from Soulmate-AI

Authentication (email, confirmation, reset), 18+ enforcement, onboarding, profiles and photos, blocking, reporting,
safety introduction, notifications, presence, account deletion, demo mode, dating features, live foundation, RentMate
brand and light/dark themes, no-adult-content policy and text screening, repository policy guard, CI and hooks.

## 3. RentMate features

| Area                                                                                                               | Status              | Notes                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------- |
| Member registration/login, email verification, password recovery                                                   | Completed (reused)  | Same accounts for members and companions                                                           |
| Age verification                                                                                                   | Partially completed | 18+ enforced; companion verification recorded by moderators; no verification vendor yet (F-05)     |
| Companion registration/onboarding                                                                                  | Completed           | Application, moderator approval, verified flag, pause/resume                                       |
| Companion profile, interests, languages, area (no address)                                                         | Completed           |                                                                                                    |
| Companion photos                                                                                                   | Completed (reused)  | Profile photos; no automated image moderation (F-18)                                               |
| Services and pricing (hourly/session)                                                                              | Completed           | Allow-listed non-sexual activities; range-checked prices                                           |
| Availability                                                                                                       | Completed           | Weekly windows with time zones; bookings must fit                                                  |
| Discovery and search                                                                                               | Completed           | City, activity, price, date, language, interest, rating, verified; blocked/suspended excluded      |
| Location privacy                                                                                                   | Completed           | City and neighbourhood only; addresses and PIN codes refused in areas and meeting points           |
| Shortlists                                                                                                         | Completed           |                                                                                                    |
| Booking engine                                                                                                     | Completed           | REQUESTED → PENDING → ACCEPTED/REJECTED/CANCELLED → COMPLETED/DISPUTED; server prices; no overlaps |
| Booking notifications (in-app)                                                                                     | Completed           | Email/push notifications not built                                                                 |
| Calendar export, reminders                                                                                         | Not started         |                                                                                                    |
| Member ↔ companion messaging                                                                                       | Completed           | Unread counts, read status, block/suspension enforced, rate limited, screened                      |
| Reviews and ratings                                                                                                | Completed           | Completed bookings only, one per booking, 30 days, moderation, average rating                      |
| Admin: companion verification, bookings, disputes, reviews, suspensions, appeals, commission, analytics, audit log | Completed           | Server-side role checks; all actions logged                                                        |
| Admin: user management beyond suspension                                                                           | Partially completed | Suspend/restore by id; no user search screen                                                       |
| Monetisation design (commission, plans, transactions, refunds)                                                     | Partially completed | Tables and commission snapshots exist; payments and subscriptions locked off                       |
| Real payment processing                                                                                            | Blocked             | Needs provider, legal and tax approval (F-10, F-24)                                                |
| Hybrid online-to-physical                                                                                          | Not started         |                                                                                                    |
| Push to GitHub / pull request                                                                                      | Blocked             | No write access to `rentmate970-hue/RentMate` (see Blockers)                                       |
| Deployment                                                                                                         | Not started         | Awaiting approvals (F-03, F-23)                                                                    |

## 4. Files

- Database: `supabase/migrations/20261119090000_marketplace.sql`, `supabase/tests/marketplace.sql`,
  `scripts/test-db.mjs` (loads `btree_gist`).
- Web: `apps/web/src/market/` (`Marketplace.tsx`, `CompanionDashboard.tsx`, `MarketAdmin.tsx`, `BookingsList.tsx`,
  `MarketChat.tsx`, `marketData.ts`, `marketText.ts`, `market.test.ts`); `App.tsx` (routes `#companions`,
  `#companion`, `#market-admin`); `ProfileDashboard.tsx`, `AuthScreen.tsx`, `brand.test.ts`, `styles.css`.
- Docs: `RENTMATE_SOURCE_TARGET_REPORT.md`, this report, deployment guide, rollback plan, founder approvals, README.

## 5. Security

Server-side authorisation for every marketplace action; RLS on all 16 new tables with least-privilege column grants;
clients cannot write bookings, prices, statuses, reviews or roles; overlapping accepted bookings blocked by the
database; idempotent booking requests; rate limits on requests and messages; prohibited-content screening on all
new text; addresses refused; suspensions enforced; audit log for admin actions; payments locked off by constraints;
no service-role key in the frontend.

## 6. Test and build results (this session)

Policy guard 52/52 self-tests and 378 files clean · format, lint, typecheck, build pass · API 79/79 · web 159/159 ·
DB: rls_flow 53/53, demo_isolation 21/21, demo_mode 13/13, discover_activity 10/10, profile_details 29/29,
live_foundation 47/47, no_adult_content 16/16, policy_audit 36/36, marketplace 80/80 · hooks 21/21 · aihub 32 passed ·
browser smoke (e2e) pass · marketplace browser flows (member, companion, admin) pass with no page errors and no
horizontal scrolling at 360–390 px, light and dark · marketplace rollback rehearsal passes · mutation check: removing
the overlap constraint makes the marketplace test fail.

Not tested: real Supabase project (migrations not applied), real devices, email delivery, payments.

## 7. Blockers and remaining work

- **GitHub write access** to `rentmate970-hue/RentMate`: install the Claude GitHub App on the repository, or push the
  branch yourself. GitHub permits one free personal account per person; resolve the account situation first.
- Approvals F-03 (migrations), F-05 (verification vendor), F-10/F-24 (payments), F-18 (image moderation), F-23
  (Render repository).
- Remaining work: calendar export and reminders, email/push notifications, user search for admins, hybrid
  experiences, payments once approved, independent penetration test and legal review.
