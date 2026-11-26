# Booking token accounting (sandbox)

Implements founder decision F-10/F-11/F-24 (2026-11-26, `docs/FOUNDER_APPROVALS.md`) against the specification in
`docs/INDIA_LAUNCH_AND_BOOKING_SAFETY.md`. Migration: `supabase/migrations/20261126090000_booking_token_holds.sql`.
Rollback: `docs/rollback/20261126_booking_token_holds.rollback.sql` (refuses to run once any token activity exists).

**Status: sandbox only.** Members can spend tokens on a booking only when `booking_token_settings.sandbox_spend_enabled`
is on (admins only) **and** both the member and the companion are tester accounts. `live_spend_enabled` is locked
`false` by a database constraint. No token purchase, INR conversion, withdrawal, transfer, redemption or creator payout
exists anywhere.

## Separate records

| Domain                  | Where                                                                                              | Written by                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Member wallet           | `token_ledger` + `token_wallets` (existing)                                                        | `private.ledger_post` only (reasons `booking_hold`, `booking_refund`, `sandbox_grant` added) |
| Quote snapshot          | `booking_token_quotes` (immutable)                                                                 | `booking_request_with_tokens`                                                                |
| Booking hold            | `booking_token_holds` (one per booking, never deleted) + `booking_token_hold_events` (append-only) | lifecycle functions                                                                          |
| Creator pending earning | `creator_booking_earnings` (append-only, tokens)                                                   | settlement only                                                                              |
| Platform commission     | `platform_commission_entries` (append-only, admin-only read)                                       | settlement only                                                                              |
| Booking chat            | `booking_messages` (participants only)                                                             | members (text) and the server (system events)                                                |

Subscription entitlements stay in `subscription_entitlements` and are never treated as a balance.

## Lifecycle

| Event                                                       | Token effect                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking_request_with_tokens` (idempotency key required)    | Server quote from the stored service (`price_tokens`, minutes, commission); snapshot; debit wallet; create hold. One transaction: any failure (gates, availability, balance) keeps nothing. Retrying the key returns the same booking.  |
| Reject, cancel, block, expiry (`booking_expire_stale`)      | Compensating `booking_refund` credit, hold `released`. Idempotent.                                                                                                                                                                      |
| `booking_dispute`, participant safety report                | Hold `frozen`; completion refused until a moderator decides.                                                                                                                                                                            |
| `booking_complete`                                          | Token bookings need **both** participants to confirm; then hold `settled`: creator share → `creator_booking_earnings`, commission → `platform_commission_entries`, both from the snapshot (later price/commission changes never apply). |
| `admin_resolve_booking_tokens` (moderator, reason required) | `settle` (booking completes), `refund` (booking cancelled) or `unfreeze`. Logged.                                                                                                                                                       |
| `admin_resolve_dispute` (existing)                          | `completed` settles the frozen hold, `cancelled` refunds it.                                                                                                                                                                            |

`admin_booking_token_reconciliation()` lists every hold with a `balanced` flag (released holds have no earnings;
settled holds: creator + commission = held tokens). Concurrency: a per-member advisory lock plus the wallet row lock in
`ledger_post` serialise spends; the existing idempotency key on bookings deduplicates retries.

Booking chat is open from the request until `chat_retention_days` (30) after the booking ends, only to the two
participants, refuses prohibited wording, rate limits, and closes when either blocks the other. The sender is always set
by the server; members cannot write system events.

## Tests

- `supabase/tests/booking_token_holds.sql` (PGlite): 58 checks — gates, quotes, holds, idempotency, insufficient
  balance, reject/cancel/expiry refunds, two-party completion, snapshot split, append-only records, dispute and report
  freezes, moderator decisions, reconciliation, RLS, booking chat isolation, blocking.
- `scripts/test-db-concurrency.sh` (real PostgreSQL): concurrent token bookings from one wallet, a double-tapped
  request, reject vs cancel refund race.
- `scripts/test-rollback.mjs`: rollback restores the previous schema and the suites pass after re-applying.

## Not built yet (remaining launch work)

- Booking-scoped OTP/QR arrival check-in (hashed, single-use, attempt-limited). Completion currently needs both
  participants' explicit confirmation in the app; arrival is not tracked.
- City rollout allowlist (Delhi and Bengaluru disabled) and per-city kill switch.
- Published cancellation, late-arrival, no-show and refund terms; time-based partial refunds.
- Scheduled expiry/reminder job (expiry currently runs when a participant opens their bookings).
- Live enablement: needs India legal/tax review, store/provider approval and a migration that removes the
  `live_spend_off` constraint.
