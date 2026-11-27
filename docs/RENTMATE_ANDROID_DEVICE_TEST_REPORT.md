# RentMate — Android device test report

**Status: no real-device testing has been performed.** Nothing in this report is a pass on a phone.

## Why

- This session runs on a machine with no Android SDK, emulator or connected device.
- An installable APK now exists, but no one has installed it on a phone yet.

## APK to use on a phone that already has RentMate

Use the **EAS-signed** APK: run 45988842760, artifact 15193937202 (https://github.com/Shivaaye-Technologies/RentMate/actions/runs/45988842760/artifacts/15193937202),
SHA-256 `72fdcf4b9fa2d68edb8405dd7c10cc0b387a8ba094ba45b42e87af0e438278a4`. It is signed with the EAS keystore (`60:A1:2F:…:DC:44`), like every earlier EAS build, so it
installs as an update and keeps the app's data. The CI APK below uses a different (public debug) key and gives
"package conflicts with an existing package" over an EAS install. See `ANDROID_APK_SIGNING.md`.

## CI APK (fresh installs only)

| Field    | Value                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ |
| Run      | 45975566796 (`android-device-apk.yml`, commit `d081489`)                                         |
| Artifact | `rentmate-android-internal-test-13`, ID 15189205015, expires 2026-12-04                          |
| Link     | https://github.com/Shivaaye-Technologies/RentMate/actions/runs/45975566796/artifacts/15189205015 |
| SHA-256  | `73d7665e418536559b15a6dd781a19de150d1245769209d58cb7e12a58daadb6`                               |
| Package  | `com.shivaayetechnologies.rentmate` 0.1.0 (1); minSdk 24, targetSdk 36                           |
| Signing  | debug key (internal testing only; not for Play)                                                  |

Check the SHA-256 after downloading (`sha256sum app-release.apk`) before installing it with `adb install` or by
sideloading.

## What was verified without a device

| Check                                       | Result (this session)                   |
| ------------------------------------------- | --------------------------------------- |
| Mobile typecheck (`tsc --noEmit`)           | clean                                   |
| Mobile unit tests (`vitest run`)            | 88/88                                   |
| Shared check-in rules (web and mobile)      | covered by web 226/226 and mobile 88/88 |
| APK build in CI (debug variant, before fix) | built; blocked by the permission check  |
| APK build in CI (release variant)           | success, run 45975566796                |
| JS bundle embedded (no Metro needed)        | yes: `assets/index.android.bundle`      |
| Not debuggable; blocked permissions absent  | yes (workflow `aapt` checks)            |

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
