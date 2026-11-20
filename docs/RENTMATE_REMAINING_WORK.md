# RentMate — Remaining Work

Date: 2026-11-19 · Branch: `feature/rentmate-conversion`. Ordered by priority. IDs refer to
`RENTMATE_SECURITY_FINDINGS.md`; F-numbers to `FOUNDER_APPROVALS.md`. Labels: **Verified** (shown by running code) ·
**Inspected** (read) · **Inferred** (reasoned risk).

## Founder decisions and external integrations (cannot be done by engineering alone)

| Ref         | Decision or integration                                                                                | Unblocks                              |
| ----------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| F-02 / F-16 | Review and merge PR #1; approve each production deploy                                                 | Everything                            |
| F-03        | Apply migrations to production after a backup                                                          | Every database feature on this branch |
| F-26        | GitHub default branch → `main`                                                                         | Safe auto-deploys (DEP-01)            |
| F-23        | Point Render at `Shivaaye-Technologies/RentMate` / `main`; grant this assistant push access (optional) | Deploys; direct PR updates            |
| F-25        | MFA for admins and moderators                                                                          | AUTH-01                               |
| F-20        | Retention of suspension and appeal records after deletion (DPDP Act review)                            | SEC-04                                |
| F-08        | Enforce 50 likes / 10 messages per 24 h, and the token price of extras                                 | Token spending on likes and messages  |
| F-06        | LiveKit plan and terms                                                                                 | Any live or call feature              |
| F-05        | Age and identity verification vendor                                                                   | AUTH-02, verified badges              |
| F-04        | SMS provider and DLT registration                                                                      | Phone OTP                             |
| F-10 / F-24 | Payments, KYC, GST, refund policy, legal opinion                                                       | Paid bookings, purchases, payouts     |
| F-14        | Recording policy                                                                                       | Any recording                         |
| F-17        | Supabase Auth production settings                                                                      | Reliable email sign-up                |
| F-18        | Automated photo moderation vendor                                                                      | Photo safety at scale                 |

## Engineering work, by priority

### P1

1. **AUTH-01 MFA (after F-25):** TOTP enrolment in Settings; require `aal2` in `private.has_role` for admin and
   moderator; tests for both levels.

### P2

2. **LIVE-02 LiveKit webhook receiver:**
   - `POST /api/v1/live/webhook` verifying the webhook JWT and the body's SHA-256;
   - idempotent segment records;
   - this is required before any call billing.
3. **LIVE-01 media client:**
   - `livekit-client` in the web app;
   - viewer screen (list + join);
   - creator broadcast screen;
   - private-session room;
   - dating voice and video calls between matches (new `call_sessions` table, consent to start, both parties must be
     matched and not blocked).
4. **Call metering (after 2, 3 and F-06):**
   - charge voice at 10 tokens/minute and video at 1 token/second, only for time when both parties are connected
     according to webhook events;
   - use `private.ledger_post` with keys derived from webhook ids;
   - refuse to start without enough balance; end the call when the balance runs out;
   - flip `metering_rates.call_metering_enabled` only through a reviewed migration.
5. **Allowances (after F-08):** count likes and messages per rolling 24 hours against `metering_rates`. Beyond the free
   allowance, either charge the decided token price or refuse. Show the remaining allowance in the UI.
6. **Wallet screen:** balance and recent ledger in Settings (read-only; RLS already restricts reads to the owner).
7. **LIVE-03 eject on block, suspension or termination:** call LiveKit `RemoveParticipant` for the affected identity.
8. **BKG-02:** refuse `accept` when either person blocked the other; cancel open requests between two people when one
   blocks the other.
9. **SEC-04 (after F-20):** keep suspension evidence according to the decided policy.
10. **OPS-01:** security headers for the static site (tested on a preview deploy).
11. **Readiness endpoint:** `GET /ready` that checks Supabase reachability, separate from liveness.
12. **Rescheduling:** an atomic `booking_reschedule` (accepted bookings only, both parties agree, overlap-checked in one
    transaction). Also calendar export and reminders.
13. **Email or push notifications** for bookings and messages.
14. **Admin user search** and an audit-log viewer.

### P3

15. Revoke `anon` SELECT on the six dating tables (no policy exists, so it already reads nothing).
16. Decide whether suspended members may edit their profile (today: allowed).
17. Rename the `soulmate-*` Render services (creates new URLs; plan a cut-over).
18. Remove the now-unreachable adult-content refusal messages from `apps/api/src/live/policy.ts` once F-07 is final
    everywhere (harmless today; they explain refusals).
19. Structured logging with request ids; error tracking.
20. Load testing before any large-audience live event.

## Not built, and must stay off without approval

Token purchases, deposits, member-to-member transfers, withdrawals, cash redemption, creator payouts, payment collection
and subscriptions. Each is locked by a database check constraint (`financial_flags`, `platform_settings`,
`subscription_plans`) and covered by tests. Adult or sexual content of any kind is never to be built (F-07).
