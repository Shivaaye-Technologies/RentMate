# Android internal-testing APK — build, install and device smoke test

Branch `feature/rentmate-testing-apk`. Package `com.shivaayetechnologies.rentmate`, Expo SDK 58, React Native 0.88.1,
compileSdk 37, targetSdk 36, minSdk 24. Point it at **staging** only.

## 1. Build (GitHub Actions)

1. Repository → Settings → Secrets and variables → Actions → **Variables** (not secrets; these are public client
   values): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable key only — never the service
   role key), `EXPO_PUBLIC_API_URL` (staging API).
2. Actions → "Android device-test APK" → Run workflow → ref `feature/rentmate-testing-apk`
   (or `gh workflow run android-device-apk.yml --ref feature/rentmate-testing-apk`).
3. The run checks the package id with `aapt`, writes `apk-checksums.txt` and uploads artifact
   `rentmate-android-internal-test-<run number>`. Download it from the run page.

The workflow builds the release variant, `app-release.apk`. It embeds the JavaScript bundle, so it runs without a
Metro dev server, and it is not debuggable. It is signed with the Android debug key: installable on test devices,
not uploadable to Play. A release-signed build needs a release keystore stored as repository secrets (not built yet).

## 2. Install

- Phone: Settings → allow "Install unknown apps" for the browser/files app, open the APK.
- Or USB: `adb install -r app-release.apk` (uninstall any older build with a different signature first).
- Verify the checksum: `sha256sum app-release.apk` matches `apk-checksums.txt`.

## 3. Staging prerequisites

- Supabase Auth → URL configuration: add redirect URLs `rentmate://auth/callback` and `rentmate://auth/reset`.
- Staging database has migrations up to `20261126100000_play_billing_purchases.sql` applied.
- For token bookings: an admin runs `select public.admin_set_booking_token_sandbox(true);`, both test accounts have
  `is_tester = true`, and the companion is approved with a token-priced service.

## 4. Smoke test (mark each pass/fail)

| #   | Flow                 | Steps                                                                             | Expected                                                                 |
| --- | -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Launch               | Cold start, airplane mode off                                                     | Splash, then sign-in; no crash, no red screen                            |
| 2   | Sign up              | Email + password + 18+ declaration                                                | Verification email; link opens the app                                   |
| 3   | 18+ gate             | Try to continue without the declaration                                           | Blocked with a clear message                                             |
| 4   | Sign in / out        | Sign in, kill app, reopen                                                         | Session persists; sign out returns to sign-in                            |
| 5   | Password reset       | "Forgot password" → email link                                                    | Opens `auth/reset`, new password works                                   |
| 6   | Google sign-in       | Continue with Google                                                              | Returns to the app signed in                                             |
| 7   | Onboarding           | Complete profile steps                                                            | Lands on home; back button does not re-enter onboarding                  |
| 8   | Discover / likes     | Browse, like, mutual like with second account                                     | Match appears; chat opens                                                |
| 9   | Chat                 | Send messages both ways                                                           | Delivered in real time; prohibited text refused                          |
| 10  | Companions           | Open Companions, pick a service                                                   | Only public meetup venues; no hotel/residence option                     |
| 11  | Token booking        | Choose time/duration, see quote, request                                          | Hold shown; wallet balance drops by the quote; retry does not double     |
| 12  | Accept / reject      | Companion accepts one, rejects another                                            | Rejected hold refunded once; status labels update                        |
| 13  | Booking chat         | Message inside the booking                                                        | Only the two participants see it; third account cannot                   |
| 14  | Completion           | Both confirm completion                                                           | Hold settles; creator sees pending earnings; no cash option anywhere     |
| 15  | Report / block / SOS | Report the booking; block; tap emergency                                          | Hold frozen; blocked user hidden; dialer opens 112                       |
| 16  | Wallet               | Open Wallet                                                                       | Read-only balance and history; no transfer, withdraw or buy-with-cash    |
| 17  | Keyboard / small     | Small screen (≤ 5"), rotate, long text                                            | Inputs stay visible above keyboard; nothing clipped                      |
| 18  | Permissions          | Deny camera/mic/notifications                                                     | App keeps working; asks again only when needed                           |
| 19  | Offline              | Airplane mode mid-flow                                                            | Clear error, no crash; recovers when online                              |
| 20  | Notifications        | Make a booking request from a second account                                      | Companion sees an unread notification; tapping opens the booking         |
| 21  | Availability         | As a companion, add Mon 10:00–13:00, try an overlapping window, remove one        | Overlap refused; members can only request inside the windows             |
| 22  | Token pack (Play)    | Installed from the Play internal track, tester account, sandbox on: buy 50 tokens | Google test sheet; balance +50 once; replaying or reopening adds nothing |
| 23  | Pending purchase     | Use Play's "slow test card" (pending)                                             | "Waiting for payment" notice; no tokens until it completes               |
| 24  | Refund               | Refund the test order in Play Console                                             | Within minutes (RTDN) a reversal entry appears; balance never negative   |
| 25  | Monthly plan         | Subscribe with a test account, then cancel in Play                                | Wallet shows subscriber until period end; expires after                  |

Report failures with device model, Android version, step number and a screen recording.

## Not in this APK

- Push notifications (in-app notifications only), gifts, OTP/QR meetup check-in, published terms.
- Google Play purchases (rows 22–25) only work when the app is installed from a Play testing track with a
  release-signed build. The side-loaded debug APK shows "Google Play Billing is not available" or hides the store,
  which is expected.
