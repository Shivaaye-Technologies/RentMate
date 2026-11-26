# RentMate — completion report

## Round 3 (2026-11-26)

On top of `d963b06`, which is now on GitHub. The commits from this round are **local only**: this session has no
GitHub credentials, so pushing failed (no username), the GitHub MCP server failed to connect, and CodeQL needs
authentication. No PR exists for `feature/rentmate-testing-apk`. `ci.yml` runs only on pull requests (and pushes
to `main` or `staging/rentmate-android`), so CI has never run on this branch. No APK was built: there is no
Android SDK on this machine.

Work done:

1. **Meetup check-in and settlement** (`20261126140000_booking_checkin_and_settlement.sql`), which fixes a defect:
   an accepted token booking whose time had passed held the member's tokens indefinitely unless both people
   tapped "complete".
   - Check-in: inside the meetup window, the member shows a one-time 6-digit code and the companion enters it.
     The code is stored only as a hash, each code allows 5 wrong tries, and a member can issue at most 10 codes.
   - The `booking_jobs_settle` job runs from the API every minute, after the dispute window (24 hours by default;
     an admin can set 1 to 168 hours).
     - A booking that was checked in, or that the member confirmed, completes and settles exactly once.
     - Any other finished booking is frozen for a moderator to decide. A companion's confirmation alone never
       moves tokens.
   - Includes a rollback script (it refuses to run once the feature has been used) and a rollback rehearsal step.
   - Includes a check-in card on Android and web. The rules are shared from `apps/web/src/market/marketText.ts`.
2. **Indian digit grouping** (₹1,50,000) no longer depends on the runtime's locale data. A small-icu Node printed
   ₹150,000, and some Android JS engines can do the same. This applies to the web wallet and the Android wallet,
   token store and booking screens.
3. **Security sweep**: every security-definer function that members can call was checked for a caller check.
   - Every function was accounted for.
   - Two findings were recorded as SEC-1 and SEC-2 in `RENTMATE_REMAINING_TASKS.md`. SEC-1 is a disputes-after-
     settlement gap that needs a decision; SEC-2 is a low-severity room-name disclosure.

Test results, run in this session on disposable databases only:

| Command                             | Result                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `npm run check`                     | exit 0                                                             |
| API tests                           | 158/158                                                            |
| Web tests                           | 226/226                                                            |
| `npm run test:db`                   | exit 0; new suite: check-in and settlement 29/29; schema audit 8/8 |
| `npm run test:rollback`             | exit 0 (19 stages)                                                 |
| `npm run test:hooks` / `test:aihub` | 21/21 / 32/32                                                      |
| Mobile `vitest` / `typecheck`       | 88/88 / clean                                                      |

Environment notes (not committed):

- `node_modules` had Termux (android-arm64) native binaries. They were replaced with linux-arm64 Rollup and
  esbuild builds, and the mobile dependencies were reinstalled with `npm ci`. No lockfile changed.
- A stale, untracked `apps/mobile/.expo/types/router.d.ts` was moved aside so the typecheck runs as it does on a
  fresh CI checkout.

## Round 2

Branch `feature/rentmate-testing-apk`. Started from `e30eef4` (already on GitHub). New local commits since:
`7d61f92`, `006d3cb`, `5ed5492`, `cb76a43` and this documentation commit. They are **not pushed yet**: this
session can read the GitHub repository but has no write or API access (proxy 403). They are delivered as a git
bundle, so no PR, CI run or APK artifact exists for them yet.

## Feature status (brief section B)

| #   | Feature                         | Status                                                                                                           |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Email registration and login    | Built (Android and web); needs device test                                                                       |
| 2   | Google authentication           | Built; needs Supabase Google provider and redirect URLs in staging                                               |
| 3   | Password reset                  | Built (`rentmate://auth/reset`)                                                                                  |
| 4   | 18+ onboarding                  | Built; database enforces age 18+ and the date-of-birth declaration                                               |
| 5   | Profile and photos              | Built (private storage, resized and re-encoded, signed links)                                                    |
| 6   | Discovery                       | Built (discover, vibes, nearby screens)                                                                          |
| 7   | Likes and matching              | Built                                                                                                            |
| 8   | Messaging and notifications     | Chat built; **in-app notifications screen added**. Push notifications not built (needs FCM credentials)          |
| 9   | Live and creator foundations    | Built (LiveKit rooms, host controls); needs LiveKit credentials                                                  |
| 10  | Voice/video call foundations    | Built (LiveKit); needs LiveKit credentials and device test                                                       |
| 11  | Gifts and token ledger          | Ledger built and append-only. **Gifts not built** (no gift catalog or flow; product decision needed)             |
| 12  | Companion booking               | Built with token holds (sandbox)                                                                                 |
| 13  | Availability calendar           | Server built; **Android weekly editor added**; web dashboard already had it                                      |
| 14  | Booking chat                    | Built, participants only                                                                                         |
| 15  | Booking safety and moderation   | Report, block, emergency (112), dispute freeze, moderator decisions                                              |
| 16  | Wallet and subscription screens | Built; **Google Play purchase flow added** (sandbox, testers only)                                               |
| 17  | Admin and moderation            | Web admin console; **staff tiers added** (super, master, sub admin, agent). No Android admin screens (by design) |

## Work completed in this round

1. **Android Play Billing client.** Added `expo-iap` 6.6.0 (an Expo SDK 58 module), pinned to the Play store.
   - Each purchase is bound to the member with `obfuscatedAccountId = sha256("rentmate:" + userId)`; a test checks it
     against the API's hash.
   - Purchases are sent to the API, which verifies them, records them and then consumes or acknowledges them. The
     device never grants, consumes or acknowledges anything.
   - Pending purchases grant nothing. Purchases left unconfirmed are sent again on the next visit.
   - The token store is hidden unless the server's billing sandbox and at least one product are on.
   - Files: `apps/mobile/src/lib/billing.ts`, `src/lib/playBilling.ts`, `src/components/TokenStore.tsx` and
     `app/(app)/wallet.tsx`.
2. **Staff role tiers** (`20261126110000_admin_role_tiers.sql`).
   - Ranks: super_admin 50, master_admin = admin 40, sub_admin = moderator 30, agent 20. Every existing check keeps
     its meaning, and MFA still applies to every tier.
   - `admin_grant_staff_role` only grants roles below the caller's own, only to people below the caller, and never
     to the caller.
   - super_admin can only be added by the database owner.
   - Agents get a report triage queue that hides the reporter and the report text, and can escalate a report with a
     logged note.
   - Removing a new tier is not available through the app (see the remaining-tasks list, F-RT1).
3. **Booking expiry job** (`20261126120000_booking_expiry_job.sql` and `apps/api/src/jobs/bookingExpiry.ts`).
   - Across all members, unanswered requests past their start time expire every minute, and their holds are
     refunded exactly once.
   - Guarded by the `booking_jobs` integration secret, with a record of each run and a moderator view.
4. **Security hardening.**
   - `20261126130000` removes the leftover anon SELECT grants on social tables.
   - A new `schema_security_audit.sql` suite checks, after every migration:
     - every public table has RLS;
     - every security-definer function sets its own search_path;
     - signed-out (anon) users have no table access, and can call only a reviewed list of functions;
     - only the server can write the ledger;
     - all eight money switches stay locked off by constraints.
5. **Android screens.** Notifications (mark as read, open the booking) and the companion availability editor. Profile
   now links to notifications, bookings and availability.
6. **Web admin.** The admin console can grant staff tiers; the admin and moderator roles can still be granted and
   removed as before.
7. **CI.** The APK workflow now fails if Google Play Billing is not linked (`com.android.vending.BILLING`). The
   native check requires `openiapStore=play`.

The earlier round (also on this branch) delivered booking token accounting, server-side Play verification with
RTDN, email auth restoration, the booking screens, and fixes to the APK workflow.

## Test results (run in this session, disposable databases only)

| Command                                                                         | Result                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run check` (policy, format, lint, typecheck, tests, build, bundle secrets) | exit 0                                                                                          |
| API tests (`apps/api`, vitest)                                                  | 156/156                                                                                         |
| Web tests                                                                       | 223/223                                                                                         |
| `npm run test:db` (PGlite)                                                      | exit 0; new suites: role tiers 28/28, expiry job 10/10, schema audit 8/8                        |
| `npm run test:rollback`                                                         | exit 0; 18 rollback stages restore the schema                                                   |
| `npm run test:db:concurrency` (PostgreSQL 16, local, disposable)                | 9/9                                                                                             |
| Mobile `typecheck` / `vitest`                                                   | clean / 84/84                                                                                   |
| Mobile `check:native` (expo prebuild)                                           | 17/17 checks ok                                                                                 |
| Mobile `check:bundle-secrets`                                                   | ok (no server secret in the Android bundle)                                                     |
| `npm run test:hooks` / `test:aihub`                                             | 21/21 / 32/32                                                                                   |
| `npm audit --omit=dev` (root)                                                   | 0 vulnerabilities                                                                               |
| Mobile `npm audit --omit=dev`                                                   | 4 moderate, already present before this round (Expo tooling: minimatch via `@expo/fingerprint`) |

One failure was caught and fixed rather than bypassed. The policy guard refused the first version of the role
migration because it contained a `delete from`. The design was changed to insert-only grants; the guard was not
modified.

## GitHub, CI and APK

- Pushed branch: `e30eef4`. This round is local only (git bundle). PR, CI and CodeQL: **not run or checked**,
  because there is no API access.
- APK: **not built.** The workflow `android-device-apk.yml` is ready; see `ANDROID_INTERNAL_TEST_CHECKLIST.md`.
- Real-device testing: **not done.** No device is available to this session.

Live purchases, cash conversion, withdrawals and creator payouts remain impossible: they are blocked by database
constraints that only a reviewed migration can change.
