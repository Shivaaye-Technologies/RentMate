# RentMate Android completion plan

Status: device-reviewed staging UI; implementation work remains.
Branch: `feature/android-happn-style-ui`
Canonical repository: `Shivaaye-Technologies/RentMate`

This plan records the next implementation sequence after reviewing the Android preview APK on a physical Android device. It is intentionally scoped to the existing API and Supabase/RLS architecture. Do not invent client endpoints or bypass database policy.

## Current device-reviewed state

- [x] Standalone Android preview APK launches without Metro.
- [x] Five-tab navigation: Discover, Vibes, Likes, Chat, Profile.
- [x] Discover calls the authenticated `GET /api/v1/matches` route.
- [x] Live room list calls the authenticated `GET /api/v1/live/streams` route.
- [x] 18+ declaration gate and non-adult-content messaging remain in place.
- [x] Empty states do not fabricate profiles, likes, messages, rooms or wallet balances.
- [ ] Complete profile creation/editing and private photo upload/display.
- [ ] Persist Like/Pass and surface real incoming likes/mutual matches.
- [ ] Connect the inbox to real matches, messages, read markers and realtime delivery.
- [ ] Add the native LiveKit media client and test viewer/broadcaster permissions.
- [ ] Implement Nearby only with explicit opt-in, coarse location and privacy controls.
- [ ] Complete companion discovery/booking flows against existing server/database rules.
- [ ] Complete wallet read-only display against the server ledger.
- [ ] Revisit token gifts only after a reviewed schema/security/legal decision explicitly changes the current no-transfer rule.

## Implementation sequence

### A. Profile foundation (first)

1. Inspect the current age-attestation/onboarding flow and profile schema on this branch before adding a new editor.
2. Reuse the existing API `PUT /api/v1/profile` and its validation contract. It accepts `displayName`, `age`, `bio`, `interests`, `lookingFor`, `ageMin`, and `ageMax`.
3. Preserve the database age-attestation requirement; never treat a typed age or the UI's 18+ badge as identity verification.
4. Use the private `photos` storage bucket and existing storage policies. Generate short-lived signed URLs; never make private profile photos public or persist signed URLs as photo paths.
5. Add tests for validation, expired sessions, API errors, upload failures, and signed-link refresh.

Acceptance: a signed-in adult can complete/edit their own profile, reload it from the server, upload/remove only their own photos, and see private photos only through authorized short-lived URLs.

### B. Dating interactions

1. Inspect the current `likes`, `passes`, `matches`, and related SQL functions/policies before wiring mutations.
2. Persist Like/Pass using the existing permitted database operations/RPCs; no client-created matches.
3. Build Likes from actual authorized records and only reveal profile details the existing RLS/RPC permits.
4. Build Chat from the existing `matches`, `messages`, and `match_reads` model.
5. Subscribe to the existing Supabase Realtime message channel only after verifying its publication and RLS configuration.
6. Add retry, offline, duplicate-send, block/unmatch and read-marker tests.

Acceptance: Like/Pass survives app restart; a mutual like creates a match only through the database's existing logic; only matched, unblocked members can read/send messages; realtime reconnect and read state are tested.

### C. Live

1. Verify staging API and LiveKit provider configuration before exposing Join/Go Live controls.
2. Add the compatible native LiveKit React Native SDK and required Expo config plugin/prebuild support.
3. Obtain room credentials only from the authenticated server join route. Never ship LiveKit API secrets in the app.
4. Keep viewer tokens subscribe-only; broadcaster permissions require server-side policy approval.
5. Add camera/microphone permission rationale, mute/leave, reconnect, report/block and moderation states.
6. Test on physical Android devices and verify signed webhook/presence behavior before any metering.

Acceptance: a viewer can join an approved room without publish rights; an approved host can publish; revoked/blocked/terminated sessions stop; no client-side timer is used for billing.

### D. Nearby and companionship

1. Ask for foreground location permission only after a clear user action.
2. Offer manual city/area selection and a fully usable no-location experience.
3. Never show exact coordinates or a home address; use coarse distance and safe public meeting points.
4. Reuse the existing approved non-sexual activity categories and booking state machine.
5. Do not add payment, cash-out, escorting, sexual services or residential meeting points.

Acceptance: location is optional, revocable and coarse; bookings are server-authorized and overlapping bookings remain prevented.

### E. Wallet and gifts

1. Display only server-derived ledger balance/history; no local or fabricated balance.
2. Keep purchases, withdrawals, cash redemption, payouts and member-to-member transfers disabled.
3. Do not implement token gifts under the current database constraints. A future gift feature requires a separately reviewed policy, schema migration, immutable ledger reason, idempotency, abuse limits, tests and explicit approval.

Acceptance: read-only ledger values match the server; no client can mint, transfer, withdraw or redeem tokens.

## Release gates

- [ ] Android typecheck and tests pass.
- [ ] API tests and database/RLS suites pass for affected behavior.
- [ ] EAS preview APK builds from this branch and is installed on a physical Android device.
- [ ] Google OAuth and session persistence smoke-tested on device.
- [ ] No secrets, service-role keys or provider credentials are bundled in the APK.
- [ ] CI passes and PR review is complete.
- [ ] No production deployment, database migration, PR merge or store release without explicit approval.
