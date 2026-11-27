# RentMate — completion report

## Round 4 (2026-11-26/27)

Branch `feature/rentmate-testing-apk`, draft PR #19 (base `feature/rentmate-conversion`, open, mergeable, **not
merged**). Everything is pushed, through `d081489`. The founder granted the `workflow` OAuth scope on 2026-11-27,
so the APK workflow fix is pushed too.

Recovery points: the tag `backup/2026-11-26-before-round4` (`ab3f42f`) and the verified bundle
`/root/RentMate-backups/rentmate-2026-11-26-ab3f42f.bundle`.

### Commits this round

| Commit    | What                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| `349e6b4` | SEC-2: `live_room_for` and `room_name` restricted to people who may join (`20261126150000`)    |
| `6c667eb` | SEC-1: admin decision on disputes raised after settlement (`20261126160000`, `20261126170000`) |
| `d75fab6` | Gifts sandbox migration and test, **held** for founder approval (`docs/held-migrations/`)      |
| `55d8f1f` | Billing tests: cancelled, paused, pending and lapsed-grace subscription states                 |
| `13aad35` | Concurrency tests: concurrent settlement runs and concurrent settlement reversals              |
| `4a6db73` | APK workflow builds the release variant with the bundle embedded and fails if it is debuggable |
| `d081489` | R8 keep rules for the WebRTC classes native code calls by name (fixes the release build)       |

### Already present before this round (verified, not rebuilt)

Auth and the 18+ attestation, profiles, discovery, likes and matches, chat, live and creators (LiveKit), the token
wallet and ledger, the Play Billing sandbox, bookings with token holds, the check-in code and settlement job, staff
role tiers with admin MFA on the web, notifications, and the schema security audit.

### Migrations added

- `20261126150000_live_room_for_restricted.sql`
- `20261126160000_booking_settlement_reversal.sql`
- `20261126170000_reconciliation_keeps_release_rules.sql`. This is a follow-up: the file guard rightly blocked
  editing `160000`, so the reconciliation correction ships as a new migration.

Each has a rollback in `docs/rollback/` that refuses to run once the feature has been used, and each is rehearsed
in `npm run test:rollback`.

### Gifts (held, not applied)

`supabase/tests/token_wallet.sql` deliberately fails while any public function is named like `gift`. Gifts are
therefore written, tested on a throwaway database (gift test 23/23, schema audit 8/8), and **held** in
`docs/held-migrations/`. The guard was not weakened. The design has an empty, admin-priced catalogue with price
history; a sandbox switch for testers only, with live gifts locked off; idempotent sending with price snapshots;
an append-only gift ledger; and reconciliation. The creator share is constrained to `NULL` (no invented revenue
share, no payouts).

### Test results (run in this session; disposable databases only)

| Command                              | Result                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npm run check`                      | exit 0 (lint, format, typecheck, policy 612 files, build)                                              |
| API tests                            | 159/159                                                                                                |
| Web tests                            | 226/226                                                                                                |
| `npm run test:db`                    | 32 suites, all passing; settlement reversal 23/23; live room 9/9                                       |
| `npm run test:rollback`              | exit 0 (21 stages)                                                                                     |
| `npm run test:hooks` / `test:aihub`  | 21/21 / 32/32                                                                                          |
| Mobile `vitest run` / `tsc --noEmit` | 89/89 / clean (new: R8 keep-rules test)                                                                |
| `test:db:concurrency` (2 new cases)  | not run locally (no PostgreSQL); **passed in CI** `db-concurrency`, run 45933120742 (11 cases, all ok) |

### GitHub

| Item                      | Status                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI                        | success on `13aad35` (run 45909194104) and on `0893d91` (run 45933120742): check, browser, rtc, db-concurrency, mobile                                                     |
| CI on `d081489`           | success (run 45975566728)                                                                                                                                                  |
| APK workflow on `13aad35` | failure (run 45909194094): `SYSTEM_ALERT_WINDOW` from the debug manifest. Fixed in `4a6db73`                                                                               |
| APK workflow on `4a6db73` | failure (run 45970802476): R8 missing class `livekit.org.jni_zero.JniZeroJni` (LiveKit WebRTC). Fixed in `d081489`                                                         |
| APK workflow on `d081489` | **success** (run 45975566796)                                                                                                                                              |
| APK artifact              | `rentmate-android-internal-test-13` (ID 15189205015), expires 2026-12-04: https://github.com/Shivaaye-Technologies/RentMate/actions/runs/45975566796/artifacts/15189205015 |
| APK SHA-256               | `73d7665e418536559b15a6dd781a19de150d1245769209d58cb7e12a58daadb6` (`app-release.apk`, 145,416,535 bytes; matches the workflow's checksum file)                            |
| CodeQL                    | default setup; 0 open code-scanning alerts for the PR #19 ref (API query this session)                                                                                     |
| PR #19 description        | updated this round                                                                                                                                                         |

### APK checks (artifact downloaded and inspected in this session)

- Package `com.shivaayetechnologies.rentmate`, versionName 0.1.0, versionCode 1; minSdk 24, targetSdk 36, compileSdk 37.
- Release variant, debug-signed (APK signature block present). Not debuggable: the workflow's `aapt` check passed.
- Standalone: `assets/index.android.bundle` (4,564,524 bytes, Hermes bytecode) is embedded, so no Metro server is
  needed. Native libraries for arm64-v8a, armeabi-v7a, x86 and x86_64.
- Permissions: INTERNET, ACCESS_NETWORK_STATE, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, BLUETOOTH,
  BLUETOOTH_ADMIN, VIBRATE, WAKE_LOCK, FOREGROUND_SERVICE, BILLING, USE_BIOMETRIC, USE_FINGERPRINT. None of the
  blocked ones (location, contacts, `SYSTEM_ALERT_WINDOW`, external storage).
- After shrinking, `classes.dex` still holds `livekit.org.webrtc.PeerConnectionFactory`, `livekit.org.jni_zero.JniZero`
  and `com.oney.WebRTCModule.WebRTCModule`. The only `-dontwarn` rule is for the one generated class.
- Built with the staging Actions variables. The staging API `/health` returned 200 (`authConfigured: true`).

### Device evidence

None. No device testing was performed, because this machine has no Android device or emulator, so installing
without Metro is shown by the APK's contents, not by an install (see `RENTMATE_ANDROID_DEVICE_TEST_REPORT.md`).

### Founder approvals still required

Approve the gift rules, which unblocks the held migration; F-RT1
(removing staff roles); creator shares; the legal, tax and Play policy items in
`RENTMATE_STAGING_RELEASE_CHECKLIST.md`; and the merge of PR #19.

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
