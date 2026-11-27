# RentMate — security audit (2026-11-26/27)

Scope: branch `feature/rentmate-testing-apk` (PR #19). This covers the database (RLS, security-definer functions,
accounting), the API's job and billing paths, and the Android client's use of them. It is an engineering review,
not a penetration test. A professional penetration test is still required before any public launch (see
`RENTMATE_STAGING_RELEASE_CHECKLIST.md`).

## Method

- Every `security definer` function in `public` was listed from the migrated schema (PGlite) and checked by hand
  for a caller check: `private.require_member()`, `private.require_role(...)`, `private.has_role(...)`, a host or
  participant check, `private.integration_secret_ok(...)` for jobs, or an explicit aggregate-only result.
- `supabase/tests/schema_security_audit.sql` (8/8) enforces this automatically: RLS on every public table, no
  definer function without `search_path = ''`, nothing granted to `anon` except an allowlist of secret-guarded
  jobs and public reads.
- Accounting tables were checked for append-only triggers, and money paths for idempotency keys.

## Findings and status

| ID    | Severity | Finding                                                                                                                                                                                                    | Status                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-1 | Medium   | A dispute raised after a booking settled froze nothing and could not be corrected: the tokens were already the creator's pending earnings and the platform commission.                                     | **Fixed** in `6c667eb` (`20261126160000`, `20261126170000`). `admin_decide_settled_dispute` (admins only, reason required, logged): _reverse_ refunds the member once (ledger key `booking_reversal:<id>`) and writes an append-only reversal; _uphold_ restores `completed`. Pending totals and reconciliation net out reversals. Tests 23/23, and a concurrent double reversal in `test-db-concurrency.sh`. Rollback rehearsed. |
| SEC-2 | Low      | `public.live_room_for` returned any stream's room name and creator to any signed-in member, and `live_streams.room_name` was readable by every member.                                                     | **Fixed** in `349e6b4` (`20261126150000`). The room is returned only to the creator, moderators, invited or accepted guests, and members who pass the watch checks. `room_name` is no longer column-readable. Tests 9/9; rollback rehearsed.                                                                                                                                                                                      |
| SEC-3 | Info     | The check-in code is 6 digits. Brute force is bounded: 5 wrong tries per code, 10 codes per booking, and only inside the meetup window, so at most 50 guesses against 10⁶.                                 | Accepted. Codes are stored only as SHA-256 hashes.                                                                                                                                                                                                                                                                                                                                                                                |
| SEC-4 | Info     | `booking_jobs_settle` and `booking_jobs_expire` are callable by `anon`.                                                                                                                                    | By design. Both are guarded by the `booking_jobs` integration secret and are in the audit allowlist. The secret must be long and random, and set only in the API host's secret store.                                                                                                                                                                                                                                             |
| SEC-5 | Info     | Gift functions were proposed this round. The wallet guard (`token_wallet.sql`) deliberately fails if any public function name matches `gift`, `transfer`, `withdraw`, `redeem`, `payout` or `send_tokens`. | The gifts migration was **held** (`docs/held-migrations/20261126180000_gifts_sandbox.HELD.sql.txt`) and the guard was not changed. It needs founder approval first.                                                                                                                                                                                                                                                               |
| F-RT1 | Decision | Removing a staff role tier needs `delete from`, which the policy guard forbids in new migrations.                                                                                                          | Open: founder decision.                                                                                                                                                                                                                                                                                                                                                                                                           |
| E-5   | Low      | `minimatch` (4 moderate advisories) through Expo development tooling. It is not shipped in the app.                                                                                                        | Open: wait for an Expo release.                                                                                                                                                                                                                                                                                                                                                                                                   |

## Invariants verified by tests in this session

- Users must be 18+ (`ProfileInput` and the `profiles.age` check). Unchanged.
- No explicit content: enforced in the database. Unchanged.
- Live token sales, cash conversion, withdrawals, transfers and creator payouts are locked off by `check`
  constraints (`token_wallet.sql`, `play_billing_purchases.sql`). The gift sandbox, if adopted, keeps `live_enabled`
  locked off and the creator share constrained to `NULL`.
- Every spend, refund, reversal and purchase credit goes through `private.ledger_post` with an idempotency key.
  Concurrency tests (CI job `db-concurrency`) cover double spends, replays, double refunds, double purchase
  records, concurrent settlement runs and concurrent reversals.
- Billing: notifications never credit; only the member's own app presenting a purchase does. Cancelled
  subscriptions stay entitled until the end of the paid period. Paused, on-hold, pending and lapsed plans are never
  entitled (`billing.test.ts`, 28/28).
- Auth fails closed (503) when unconfigured; helmet and rate limiting are untouched.

## Not reviewed (needs a human or an external party)

- A penetration test of the deployed staging API and Supabase project.
- Supabase project settings (Auth providers, redirect URLs, JWT expiry, network restrictions), which live outside
  the repository.
- Google Play Console and Firebase configuration, which do not exist yet.
