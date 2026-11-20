# RentMate — Android app: audit, architecture and plan

Date: 2026-11-20 · Branch `feature/rentmate-conversion` · Audited at `75d3d01` · Markets: Delhi NCR, Bengaluru.

Status: **plan + first scaffold only. Not built for a device, not tested on an emulator or phone, not
production-ready.** Nothing is pushed, merged or deployed; no production setting or migration is changed.

Evidence labels: **Verified** = run in this workspace; **Inspected** = read in code or package metadata;
**Unverified** = needs a native build, a device, or an account this workspace does not have.

## 1. Repository architecture findings

| Area               | Finding                                                                                                                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo           | npm workspaces (`apps/api`, `apps/web`), npm 10, Node 20+ (CI uses 22). One root `package-lock.json`. Inspected.                                                                                                                                                                                                  |
| Web                | React **18.3** + Vite 6. Talks to Supabase directly for almost everything (RLS + RPCs), and to the API only for a few server-only actions. Inspected.                                                                                                                                                             |
| API (Express 4)    | Small surface, all under `/api/v1`, bearer = Supabase access token, fails closed (503) without auth config: `PUT /profile`, `DELETE /account`, `GET /matches`, `POST /calls/:id/join`, `POST /calls/:id/end`, live-stream routes (`/live/streams…`, `/live/sessions…`, admin routes), LiveKit webhook. Inspected. |
| CORS               | Allowlist for browsers. Native apps send no `Origin`, so no API change is needed for mobile. Inspected.                                                                                                                                                                                                           |
| Auth               | Supabase Auth: email + password sign-up and sign-in, email confirmation and password reset links that redirect to the web origin, TOTP MFA for admins only. Inspected.                                                                                                                                            |
| Database           | Postgres with RLS on every table; business rules in RPCs and triggers (matching, likes, chat, bookings, calls, safety, age attestation). 30+ migrations, PGlite and PostgreSQL 16 test suites. Inspected/Verified.                                                                                                |
| Storage            | Private `photos` bucket; signed links valid 10 minutes; read rules in `private.can_view_photo`. Inspected.                                                                                                                                                                                                        |
| Realtime           | Supabase Realtime channels: `calls:{me}`, `chat:{matchId}`, `chats:{me}`, `live-chat:{streamId}`. Inspected.                                                                                                                                                                                                      |
| Voice / video      | `call_start` RPC → callee sees the ring on `calls:{me}` → `call_answer` RPC → `POST /api/v1/calls/:id/join` returns the LiveKit URL + short-lived token → `livekit-client` Room. The LiveKit secret stays on the server. Inspected.                                                                               |
| Push notifications | **None exists.** The web shows browser notifications only while a tab is open (`apps/web/src/notify.ts`). Inspected.                                                                                                                                                                                              |
| Bookings           | RPCs `companions_search`, `booking_request/respond/cancel/complete/dispute`, `review_create`, conversations. Public-place rules are in the database. Payments, withdrawals and payouts are disabled by database checks. Inspected.                                                                                |
| Admin / moderation | Web only, behind admin MFA (`AdminGate`), admin RPCs, LiveKit admin routes. Inspected.                                                                                                                                                                                                                            |
| Environment        | Web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (public). API: server-only secrets (LiveKit key/secret, webhook secret). `scripts/test-bundle-secrets.mjs` proves server secrets never reach the web bundle. Inspected/Verified.                                                               |
| CI                 | GitHub Actions `ci.yml`: check (policy, format, lint, typecheck, tests, build, bundle secrets), browser tests, real-Postgres jobs, LiveKit RTC job, CodeQL. Inspected.                                                                                                                                            |

## 2. What the Android app can reuse

**As-is (pure TypeScript, no browser/Vite/Supabase imports — Inspected):** `age.ts` (date-of-birth rules),
`profile.ts`, `details.ts`, `interests.ts` (profile validation and options), `safety.ts`, `invite.ts`, `brand.ts`,
`accountDeletion.ts` (server-only deletion client), `rtc/callState.ts`, `rtc/publishPermission.ts`,
`market/marketText.ts`, `live/liveText.ts`. About 1,800 lines of rules that must stay identical on web and mobile.
The scaffold imports these files directly from `apps/web/src` (no copies).

**After a small refactor (inject the Supabase client instead of importing the web singleton):** `onboardingSave.ts`,
`profileApi.ts`, `inbox.ts`, `rtc/rtcData.ts`, `market/marketData.ts`, `activity.ts`, `presence.ts`. These are thin
wrappers over RPCs; they should move to a shared package (`packages/core`) in a reviewed, behaviour-preserving step
so web and mobile call the database the same way.

**Backend:** everything — Supabase Auth, RLS, RPCs, Storage, Realtime, the API and LiveKit. No new backend.

**Needs native implementations:** screens and navigation (React Native, not DOM/CSS), session storage (Android
Keystore via `expo-secure-store`), the LiveKit room (`@livekit/react-native` + `@livekit/react-native-webrtc`),
camera/microphone/notification permissions, deep links, push notifications, photo picking/upload.

**Stays web-only:** admin console, moderation tools, creator studio and live broadcasting (not in the requested
screen list; can follow later).

## 3. Proposed mobile structure

```
apps/mobile/                  separate npm project (own package-lock.json), NOT in the root workspaces
  app.config.ts               Expo config: name, package id, scheme, SDK levels, permissions, plugins
  eas.json                    EAS build profiles (development, preview, production) — no secrets
  metro.config.js             lets Metro read the shared rules in apps/web/src
  app/                        Expo Router (file-based routes)
    _layout.tsx               session provider + route guard
    index.tsx                 splash/redirect
    (auth)/sign-in.tsx, sign-up.tsx
    (app)/declare-age.tsx     date of birth + mandatory 18+ declaration (attest_adult, fails closed)
    (app)/home.tsx            signed-in home (feature screens land here, one by one)
    (app)/settings.tsx        sign out, account deletion (server-only)
  src/lib/                    config, Supabase client, secure session storage, API client, shared re-exports
  src/test/                   unit tests (Node test runner)
```

Why a separate npm project: Expo SDK 58 requires **React 19.3 / React Native 0.88**, the web uses **React 18.3**.
Keeping mobile out of the root workspaces leaves the web's dependency tree and lockfile untouched. It can join the
workspaces later if the web moves to React 19.

## 4. Dependency compatibility report

| Package                                      | Version                       | Status                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo` (SDK 58, latest)                      | 58.0.26                       | Inspected (npm). Pins React 19.3.0, React Native 0.88.1.                                                                                                                                                                                                                                                                                       |
| `expo-router`                                | ~58.0.32                      | Inspected. Peers satisfied by SDK 58 modules.                                                                                                                                                                                                                                                                                                  |
| `expo-secure-store`                          | ~58.0.3                       | Inspected. Android Keystore-backed. ~2 KB per value → session is stored in chunks.                                                                                                                                                                                                                                                             |
| `expo-notifications`                         | ~58.1.9                       | Inspected. Android push needs FCM (Firebase project) — founder action.                                                                                                                                                                                                                                                                         |
| `expo-build-properties`                      | ~58.0.12                      | Inspected. Used to pin compile/target SDK 36, min SDK 24.                                                                                                                                                                                                                                                                                      |
| `@supabase/supabase-js`                      | ^2.118 (same major as web)    | Inspected. Works in React Native with a custom storage adapter and `detectSessionInUrl: false`.                                                                                                                                                                                                                                                |
| `livekit-client`                             | 2.24.1                        | Inspected. Same library the web uses.                                                                                                                                                                                                                                                                                                          |
| `@livekit/react-native` / `-webrtc` / plugin | 3.2.0 / 150.2.0 / 1.2.0       | Inspected: released 2026-11-17, peers accept RN 0.88. **Unverified: native compile against RN 0.88.**                                                                                                                                                                                                                                          |
| Expo Go                                      | —                             | Not usable for calls (custom native WebRTC). A development build is required.                                                                                                                                                                                                                                                                  |
| Android SDK levels                           | compile 36, target 36, min 24 | Inspected (SDK 58 defaults) and pinned explicitly. Meets Google Play's API 36 requirement.                                                                                                                                                                                                                                                     |
| Scaffold verification (this workspace)       | —                             | **Verified:** clean `npm ci` (550 packages, no peer conflicts after pinning `react-dom` 19.3.0), strict typecheck incl. typed routes, 29 unit tests, `expo config` resolves (package id, SDK 36/36/24, no permissions), Metro builds the Android Hermes bundle (1,209 modules) including the shared web rules, no server secret in the bundle. |
| `npm audit` (mobile)                         | —                             | 3 moderate, one chain: `minimatch` DoS (GHSA-g3hv-75wg-m249) inside `@expo/fingerprint`, Expo's build-time hashing tool, not in the app bundle. npm's only "fix" is a downgrade to Expo 52, so not applied; recheck on the next SDK 58 patch.                                                                                                  |

## 5. Authentication and LiveKit integration plan

**Authentication (existing Supabase Auth, no changes to the backend):**

- `supabase-js` with `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false`, **PKCE** flow.
- Session stored with `expo-secure-store` (Android Keystore), split into chunks under the 2 KB limit; never in plain
  AsyncStorage. Token refresh pauses when the app is in the background and resumes in the foreground.
- Email confirmation and password reset: links open the app at `rentmate://auth/callback?code=…`, which calls
  `exchangeCodeForSession`. **Founder action:** add `rentmate://auth/callback` to Supabase Auth → Redirect URLs (a
  production setting). Until then, mobile sign-up works when email confirmation is completed on the web.
- API calls send the member's access token as `Authorization: Bearer …` — exactly what the web does.
- Only public values are bundled: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable),
  `EXPO_PUBLIC_API_URL`. The app refuses to start with a key whose JWT role is `service_role`, and CI scans the
  Android bundle for server-only secrets.
- 18+: the app requires the date of birth and declaration through `attest_adult` before creating a profile and fails
  closed on every error (same rules as web `769a5e3`); the database enforces it once `require_age_attestation` is on.
  It is a self-declaration, not verification.

**LiveKit (existing server and token route):**

1. `call_start` / `call_answer` RPCs and the `calls:{me}` channel exactly as the web.
2. `POST /api/v1/calls/:id/join` → `{ url, token }`; `@livekit/react-native` `registerGlobals()` + `livekit-client`
   `Room` with the same options as `apps/web/src/rtc/room.ts`.
3. Camera/microphone permissions requested only when a call starts (video asks for camera; voice does not).
4. Audio routing via LiveKit `AudioSession` (earpiece/speaker), foreground service for ongoing calls.
5. Lifecycle: on background, keep audio, pause video; on network loss, LiveKit reconnects; after 30 s without
   reconnection, end the call through `POST /api/v1/calls/:id/end`.
6. Incoming calls while the app is closed need push (below); until then, rings arrive only while the app is open.

**Push notifications (no backend exists — proposal, not implemented):** `expo-notifications` + FCM. Needs a device
token table (new migration), a server sender holding the FCM/Expo push credentials, and triggers for matches,
messages, calls and booking reminders. That is new backend work and needs founder approval; nothing is built until
then. Booking reminders can use local scheduled notifications in the meantime.

## 6. Android build requirements

| Item                  | Plan                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id            | Proposed `com.shivaayetechnologies.rentmate` — **founder must confirm**; it cannot change after the first Play upload.                                                                      |
| SDK levels            | compileSdk 36, targetSdk 36, minSdk 24 (Google Play: new apps and updates must target API 36 since 2026-08-31).                                                                             |
| Edge-to-edge          | Required behaviour on Android 15+; layouts use safe-area insets.                                                                                                                            |
| Permissions           | Only what a feature needs, asked at the moment of use: camera, microphone (calls), notifications (Android 13+), location (optional city/distance). Unused ones are blocked in the manifest. |
| Deep links            | Custom scheme `rentmate://` now; verified Android App Links for the web domain later.                                                                                                       |
| Builds                | EAS Build (cloud) or a machine with Android Studio. **This workspace cannot build an APK/AAB:** no Android SDK, and Google Maven, Gradle and Expo's servers are not reachable from here.    |
| Development build     | `eas build --profile development --platform android` (APK with dev client).                                                                                                                 |
| Signed App Bundle     | `eas build --profile production --platform android` (AAB). Upload key managed by EAS or the founder; Play App Signing enabled. Never committed.                                             |
| Play internal testing | Play Console app, internal track, data safety form, 18+ content rating, account-deletion URL, privacy policy, test accounts for review.                                                     |
| Testing               | Emulator (API 36 image) and at least two physical phones common in Delhi NCR / Bengaluru (budget Android + one recent), slow-network tests.                                                 |

## 7. Risks and blockers

| #   | Risk / blocker                                                                                                                                                                                                    | Owner         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| B1  | No native build possible here; LiveKit on RN 0.88 is unproven until the first development build.                                                                                                                  | Founder (EAS) |
| B2  | Expo account + EAS project, Google Play Console account, FCM (Firebase) project.                                                                                                                                  | Founder       |
| B3  | Package id must be confirmed before the first upload.                                                                                                                                                             | Founder       |
| B4  | Supabase redirect allowlist needs `rentmate://auth/callback` (production setting).                                                                                                                                | Founder       |
| B5  | Push needs a new table, a sender and credentials — new backend work, needs approval.                                                                                                                              | Founder       |
| B6  | Google Play policy review for a companionship app: listing must state 18+, non-sexual, public meetings; expect closer review. Personal developer accounts need a 12-tester, 14-day closed test before production. | Founder       |
| R1  | Two React majors in one repo (web 18, mobile 19) — mitigated by keeping mobile outside the workspaces.                                                                                                            | Engineering   |
| R2  | Shared data modules need the client-injection refactor before most feature screens.                                                                                                                               | Engineering   |
| R3  | The P2-01/P2-02 content and venue proposals and the P2-03 production steps are still open; mobile inherits the same database rules and gaps.                                                                      | Founder       |

## 8. Implementation sequence

1. **Scaffold** (done, commit after the plan): Expo SDK 58 + Expo Router + TypeScript, secure session storage, config guard, API
   client for existing routes only, sign-in/sign-up, 18+ declaration (fails closed), settings with server-only
   account deletion, EAS profiles, unit tests, Android JS bundle export + secrets scan in CI. Web untouched.
2. **Shared core**: move the RPC wrappers into `packages/core` with client injection; web keeps passing its tests.
3. **First development build** on EAS; run on emulator and a phone; confirm sign-in, session persistence, back
   navigation. Founder actions B2/B3 first.
4. **Profile**: creation/editing, photo picking and upload (private bucket, signed links).
5. **Discovery, likes, matches** (`GET /api/v1/matches`, existing RPCs), **messaging** (Realtime).
6. **Calls**: LiveKit plugin, voice then video, permissions, audio routing, reconnection; test on two devices.
7. **Bookings**: companions search, request/respond/cancel, calendar view, local reminders.
8. **Safety**: block, report, safety settings (existing RPCs and tables).
9. **Push** (after approval of B5).
10. **Deep links** (after B4), accessibility pass (TalkBack, font scaling, contrast), slow-network and offline tests.
11. **Release prep**: signed AAB, Play internal testing, data safety form, store listing; physical-device test
    report. Only then can anything be called production-ready.
