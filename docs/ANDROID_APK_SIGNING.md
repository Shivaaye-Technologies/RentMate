# RentMate Android — APK signing and in-place updates

Android installs an APK as an **update** (keeping the app's data) only if it has the same package id **and** the
same signing certificate as the installed app, and a versionCode that is not lower. A different certificate gives
"App not installed as package conflicts with an existing package". Android then refuses the install and leaves the
installed app and its data unchanged, so a failed attempt is harmless.

## The two signing keys in use (2026-11-27)

| Built by                                                                                      | Signer certificate SHA-256                                                                        | Notes                                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EAS** (all 15 EAS Android builds, 2026-11-20/21, profiles development, staging and preview) | `60:A1:2F:D8:CE:E7:60:C3:C4:FA:61:AC:CF:3F:F0:AF:44:A2:F8:C9:CE:B4:91:39:1D:F9:71:11:EA:AB:DC:44` | EAS-managed keystore (default build credentials, created 2026-11-20). SHA-1 `A7:3A:6E:95:E6:31:F9:70:C6:A8:97:3D:79:6B:0B:1D:25:FF:3B:43`. Stays in EAS. |
| **GitHub Actions** `android-device-apk.yml` (`expo prebuild` + Gradle)                        | `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C` | React Native's **public** template debug key (SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`). Anyone can sign with it.             |

All EAS builds and the CI APK are version 0.1.0, versionCode 1 (EAS `appVersionSource: remote`).

A phone that has an EAS-built RentMate cannot install the CI APK as an update, and the reverse is also true. To
update an EAS-installed app, use the **EAS-signed** APK from `android-eas-signed-apk.yml`. That workflow signs with
the same EAS keystore and fails if the result does not match it.

## Current EAS-signed update APK

| Field    | Value                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ |
| Run      | 45988842760 (`android-eas-signed-apk.yml`, commit `f2a25bc`)                                     |
| Artifact | `rentmate-android-eas-signed-2`, ID 15193937202, expires 2026-12-04                              |
| Link     | https://github.com/Shivaaye-Technologies/RentMate/actions/runs/45988842760/artifacts/15193937202 |
| SHA-256  | `72fdcf4b9fa2d68edb8405dd7c10cc0b387a8ba094ba45b42e87af0e438278a4`                               |
| Signer   | EAS keystore `60:A1:2F:…:DC:44` (verified by the workflow and again after download)              |
| Package  | `com.shivaayetechnologies.rentmate` 0.1.0, versionCode 1; minSdk 24, targetSdk 36                |
| Backend  | staging API `rentmate-staging-api.onrender.com` and the staging Supabase project                 |

## Workflow `android-eas-signed-apk.yml`

1. **Inspect (read-only):** lists the EAS Android builds and reads the EAS keystore's public fingerprints (never the
   keystore or its passwords) through `EXPO_TOKEN`. It checks the latest EAS APK's signer, and **stops if no keystore
   exists**, so EAS never generates a new one.
2. **Build:** `eas build --local --profile staging` runs on the GitHub runner. EAS provides the existing keystore for
   that build only. The workflow then checks:
   - The signer certificate equals the EAS keystore.
   - Package id, version and SDK levels.
   - The APK is not debuggable, and the JS bundle is embedded.
   - Permissions, with none of the blocked ones present.
   - The WebRTC classes survived R8.
3. EAS calls are retried only on Expo's transient "Service Unavailable" (`scripts/retry-expo-api.sh`).

## Checking the certificate of the app on your phone (no ADB needed)

Use **App Manager** (open source, by Muntashir Akon; install it from F-Droid or its GitHub releases page):

1. Open App Manager, find **RentMate** (`com.shivaayetechnologies.rentmate`), and open it.
2. Open the **Signatures** tab and read the **SHA-256** of the signing certificate. This shows only public data and
   changes nothing.
3. Compare it with the table above. If it is `60:A1:2F:…:DC:44`, the EAS-signed APK will install as an update.

To check an APK file, or an APK that App Manager exported (App info → ⋮ → Save APK), run this in Termux:

```sh
termux-setup-storage                       # once, to reach the phone's Download folder
node ~/RentMate-Android/scripts/apk-signing-cert.mjs ~/storage/shared/Download/app-release.apk \
  --expect 60:A1:2F:D8:CE:E7:60:C3:C4:FA:61:AC:CF:3F:F0:AF:44:A2:F8:C9:CE:B4:91:39:1D:F9:71:11:EA:AB:DC:44
```

`MATCH` means the APK can update an EAS-installed RentMate. Do the same check for the installed app's exported
APK.

## Installing as an update (keeps app data)

1. Download the EAS-signed artifact and check its SHA-256 (`sha256sum app-release.apk`) against the value in the
   completion report.
2. Open the APK from the Files app and choose **Update**. Do **not** uninstall RentMate first, and do not clear
   its data or storage.
3. If Samsung Auto Blocker blocks the install, allow it for this one install (Settings → Security and privacy →
   Auto Blocker), then turn it back on.
4. If Android still reports a conflict, the installed app was not signed by the EAS key. Check it with App Manager
   (see above) before trying anything else.

## If the installed app was signed by a key we do not have

A different key cannot update it, and no tool can change an installed app's certificate. The options are:

- Find that key: the machine and keystore that built the APK, if one was built outside EAS and CI.
- Keep the app and test the new build on a second phone or in a separate user profile.
- With the founder's approval, uninstall and reinstall. This erases the app's local data on the phone (the
  sign-in session and anything cached or stored only on the device). Data held on the server (account, profile,
  chats, bookings, tokens) is not affected.

## Before Play

Play uploads need an upload key. Keep using the EAS keystore (EAS credentials) for that, and enable Play App
Signing. Never commit a keystore, and never reset the EAS credentials: that would break updates for every
installed tester build.
