# RentMate — remaining tasks

Owner key: **F** = founder or operator action (credentials, consoles, approval). **E** = engineering work that can
proceed in a session with GitHub write access.

## Blocking the internal-testing APK

| ID  | Owner | Task                                                                                                                                                      |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | F     | Push this round's commits (bundle), or give the session write access to `Shivaaye-Technologies/RentMate`.                                                 |
| A-2 | F/E   | Open a draft PR from `feature/rentmate-testing-apk` (check first that none exists). Get CI and CodeQL green. Do not merge without approval.               |
| A-3 | F     | Set the Actions variables `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable key only) and `EXPO_PUBLIC_API_URL` to staging values. |
| A-4 | done  | APK run 45975566796 on `d081489`; artifact 15189205015 (expires 2026-12-04); SHA-256 `73d7665e41853655…` (full value in the completion report).           |
| A-6 | done  | Update APK signed with the existing EAS keystore (`android-eas-signed-apk.yml`, run 45988842760). See `ANDROID_APK_SIGNING.md`.                           |
| A-5 | F     | Install on 2+ phones (one small screen, Android 8–9 and a current Android) and run the smoke test.                                                        |

## Staging setup (see `RENTMATE_DEPLOYMENT_RUNBOOK.md`)

| ID  | Owner | Task                                                                                                                                               |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | F     | Apply migrations through `20261126130000` to **staging** only, after a backup.                                                                     |
| S-2 | F     | Supabase Auth: redirect URLs `rentmate://auth/callback`, `rentmate://auth/reset`; Google provider.                                                 |
| S-3 | F     | Integration secrets: `play_billing`, `booking_jobs` (and `livekit_webhook` if live features are tested), each set the same in the API environment. |
| S-4 | F     | Mark tester accounts (`is_tester`). Switch on the booking sandbox and the billing sandbox. Enable each product.                                    |
| S-5 | F     | Grant the first `super_admin` from the SQL editor. Turn on admin MFA before giving out staff roles.                                                |

## Google Play (sandbox)

| ID  | Owner | Task                                                                                                                                                          |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | F     | Create the products `rentmate_tokens_50/100/250/500` (consumable) and `rentmate_monthly` (subscription with a base plan and offer).                           |
| P-2 | F     | Add license testers. Upload a build to the internal testing track: Play Billing only works for apps installed through Play.                                   |
| P-3 | F     | Service account with order and financial permissions; store its JSON in the API host's secret store only.                                                     |
| P-4 | F     | Set up Pub/Sub RTDN: create a topic, grant Publisher to Google Play's notification account, add a push subscription to `/api/v1/billing/google/rtdn?token=…`. |
| P-5 | F     | Release keystore for Play uploads (GitHub secrets or EAS credentials). The current workflow builds debug-signed APKs only.                                    |

## Session blockers (2026-11-27)

- Resolved: the `workflow` scope was granted and the APK now builds (run 45975566796). The artifact expires on
  2026-12-04; rerun the workflow for a fresh one.
- No Android SDK, emulator or device on this machine, so no device testing.
- No local PostgreSQL: the two new concurrency cases run only in CI.

## Engineering gaps (not built)

| ID    | Owner | Task                                                                                                                                                                                                                                                   |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-RT1 | F→E   | **Decision needed:** removing staff tiers. The policy guard forbids `delete from` in new migrations. Options: (a) approve a reviewed exception for role removal, or (b) leave removal with the database owner. Until then, removal is SQL-editor only. |
| E-1   | E     | Push notifications (FCM through `expo-notifications`): needs a Firebase project and `google-services.json` (F).                                                                                                                                        |
| E-2   | F→E   | Gifts: built and tested but **held** (`docs/held-migrations/20261126180000_gifts_sandbox.HELD.sql.txt`). Needs founder approval of prices, creator share and moderation, then a reviewed change to the `token_wallet.sql` guard.                       |
| E-3   | E     | **Done (2026-11-26):** 6-digit check-in code on Android and web (`20261126140000`) and the settlement job (24 h dispute window; no evidence means moderator review). Left: an optional QR display of the code.                                         |
| E-4   | E     | Effective-dated GST/tax records and invoices; maker-checker approval for catalog price changes (the `financial_config_versions` table exists, but packages are still edited by migration).                                                             |
| E-5   | E     | Upgrade the Expo tooling that pulls in a vulnerable `minimatch` (4 moderate, development tooling) when Expo ships a fix.                                                                                                                               |
| E-6   | E     | Android admin screens are intentionally absent (admin stays on the web with MFA). Revisit only if requested.                                                                                                                                           |
| E-7   | E     | Real-device fixes found during A-5.                                                                                                                                                                                                                    |
| SEC-1 | E     | **Done (`6c667eb`):** admins can reverse (refund once, append-only reversal) or uphold a dispute raised after settlement.                                                                                                                              |
| SEC-2 | E     | **Done (`349e6b4`):** `live_room_for` and `room_name` are restricted to the creator, moderators, guests and eligible viewers.                                                                                                                          |

## Before any public launch (founder approval required)

Legal, tax and Google Play policy review; published terms and privacy policy; a penetration test; a production backup
and migration plan; and production monitoring. Live purchases, cash conversion, withdrawals, transfers and creator
payouts stay locked off by constraints. Lifting any of them requires a separately approved migration.
