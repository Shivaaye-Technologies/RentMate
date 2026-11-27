# RentMate — Android device test report

**Status: no real-device testing has been performed.** Nothing in this report is a pass on a phone.

## Why

- This session runs on a machine with no Android SDK, emulator or connected device.
- No installable APK from this round exists yet. The latest `android-device-apk.yml` run (45909194094, commit
  `13aad35`) failed on purpose at the permission check: the debug variant's manifest adds `SYSTEM_ALERT_WINDOW`
  (for the React Native dev menu), and the workflow blocks that permission. The fix (`4790fad`: build the release
  variant with the JS bundle embedded, still debug-signed, and fail if it is debuggable) is committed locally, but
  it can be pushed only with a GitHub token that has the `workflow` scope. The current token has `gist`,
  `read:org` and `repo`.

## What was verified without a device

| Check                                        | Result (this session)                   |
| -------------------------------------------- | --------------------------------------- |
| Mobile typecheck (`tsc --noEmit`)            | clean                                   |
| Mobile unit tests (`vitest run`)             | 88/88                                   |
| Shared check-in rules (web and mobile)       | covered by web 226/226 and mobile 88/88 |
| APK build in CI (debug variant, before fix)  | built; blocked by the permission check  |
| APK build in CI (release variant, after fix) | **not run**: needs the `workflow` scope |

## Device checklist (to be filled in by a tester)

Use `docs/ANDROID_INTERNAL_TEST_CHECKLIST.md` for the full steps. Record the device, the Android version, the APK
SHA-256 from the workflow summary, and pass/fail with a screenshot for each line.

| Area                                                                                 | Device 1 | Device 2 |
| ------------------------------------------------------------------------------------ | -------- | -------- |
| Install, launch, sign up, 18+ attestation, sign in, reset password                   | not run  | not run  |
| Onboarding, profile edit and photo upload; safe areas and keyboard on a small screen | not run  | not run  |
| Discovery, like, match, chat; block and report                                       | not run  | not run  |
| Booking request with tokens, accept, check-in code (member shows, companion enters)  | not run  | not run  |
| Wrong code 5 times, then locked; settlement after the dispute window                 | not run  | not run  |
| Wallet and token history; Indian digit grouping (₹1,50,000)                          | not run  | not run  |
| Play Billing sandbox purchase (needs an internal-track install, so not this APK)     | not run  | not run  |
| Live room (creator, guest, viewer) if LiveKit staging is configured                  | not run  | not run  |
| Back button, rotation, app kill and resume, offline banner                           | not run  | not run  |

Suggested devices: one small screen running Android 8 or 9, and one current Android phone.
