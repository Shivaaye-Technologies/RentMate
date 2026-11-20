# RentMate — Security Remediation (P1/P2 findings) and Verification Providers

Date: 2026-11-20 · Follows `RENTMATE_SECURITY_FINDINGS.md`. For each finding: reproduction, root cause, fix,
regression test and residual risk. Evidence labels: **Verified** (run in this session) · **Inspected** (read) ·
**Unverified** (needs production or a legal opinion).

## Summary

| ID          | Finding                                                                 | Status                                    |
| ----------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| AUTH-01     | No MFA for admins and moderators                                        | **Fixed** (off until F-25 switch)         |
| SEC-04/F-20 | Account deletion erased suspension history                              | **Fixed** (founder sets retention period) |
| LIVE-03     | People already in rooms were not removed on block or suspension         | **Fixed**                                 |
| BKG-02      | Booking acceptance did not re-check blocks                              | **Fixed**                                 |
| OPS-01      | No browser security headers on the web app                              | **Fixed**                                 |
| CQ-03       | CodeQL `js/clear-text-logging` (new): config holding secrets was logged | **Fixed**                                 |
| MFA-02      | Recovery codes had 48 bits                                              | **Fixed** (80 bits)                       |
| MFA-03      | Recovery field cut pasted codes                                         | **Fixed**                                 |
| CQ-02       | CodeQL `js/insufficient-password-hash` at `providers.ts`                | False positive: dismiss manually          |
| RTC-01      | Host mute of a live guest did not hold (CI run 44601328482)             | **Fixed**                                 |
| SEC-05      | Integration secret stored as a fast hash accepted guessable values      | **Fixed**                                 |
| AUTH-02     | Age is self-declared                                                    | **Open**: provider choice (F-05)          |

## AUTH-01 · Admin MFA (P1)

See `RENTMATE_ADMIN_MFA.md`.

- **Reproduced (Inspected):** at `2d12120`, `private.has_role` checked only the role table.
- **Fix:** `has_role` additionally requires an `aal2` session (or a recovery grant) once MFA is switched on. The
  switch is refused until every privileged account has a factor.
- **Tests:** `admin_mfa.sql` 28; `recovery_codes_and_retention.sql`; `test:e2e:mfa` 17.
- **Residual risk:** not enforced until the founder completes the enrolment plan (F-25). Session revocation on hosted
  Supabase is unverified (see the MFA document).

## SEC-04 / F-20 · Suspension history after deletion (P2)

- **Reproduced (Verified 2026-11-19):** a suspended member who deletes the account removes its `account_suspensions`
  and `account_appeals` rows by cascade, and can sign up again with the same email unseen.
- **Root cause:** suspension rows are keyed to the profile and deleted with it. Keeping them in full would retain
  personal data after deletion.
- **Fix (`20261122090000_recovery_codes_and_retention.sql`):**
  - only an **active** suspension at deletion is kept, as a keyed SHA-256 of the normalised email plus dates (no email,
    id, name or reason). The key is random per database;
  - a new sign-up with a matching email is **flagged for moderator review**, never suspended automatically;
  - records expire after `retention_days` (default 730). Purging erases the hash;
  - moderators get a "Returning accounts" panel to list, mark reviewed and purge.
- **Tests:** `recovery_codes_and_retention.sql`:
  - only active suspensions are kept;
  - the hash is keyed and no personal columns are kept;
  - a case- and space-insensitive match is flagged; other emails are not; nobody is auto-suspended;
  - members cannot read flags or records; review works once;
  - expired records do not match, and purge erases hashes.
- **Residual risk and decision (F-20):**
  - this is still pseudonymous personal data under the DPDP Act;
  - the retention period (730 days by default) and the lawful basis need a legal opinion. The DPDP Rules 2025
    (notified 13 November 2025, phased over 18 months) include retention limits that a lawyer should map to this use;
  - someone using a different email is not caught. Phone or ID matching would need verified phone/identity (F-04/F-05);
  - a database leak plus the key would allow matching known emails.

## LIVE-03 · Removal from rooms already joined (P2)

- **Reproduced (Verified):** at `2d12120` no code removed a participant from a LiveKit room (`RemoveParticipant`
  appears nowhere in `apps/api/src`). A blocked or suspended person who had joined stayed until the room closed.
- **Fix (`20261121090000_calls_and_live_rooms.sql` + `apps/api/src/live/webhook.ts`):**
  - blocking, suspension, unmatching and guest removal enqueue `private.room_kicks`. The API drains the queue every 3
    seconds and calls `RemoveParticipant`;
  - every verified `participant_joined` webhook is re-checked, so a refused person is removed at once.
- **Tests:**
  - e2e-rtc: "a viewer suspended mid-stream is removed from the room" and "guest removal disconnects at once";
  - SQL: suspension and blocking enqueue removals; rejoining is removed; claims are exclusive.
- **Residual risk:**
  - removal is near real time (≤ 3 s plus API latency), not instant;
  - it needs the webhook and the integration secret configured (otherwise the API cannot drain the queue);
  - if the API is down, removals wait in the queue and are retried.

## BKG-02 · Accepting a booking re-checks blocks (P2)

- **Reproduced (Verified 2026-11-20):** on a database without the fix, a member requested a booking and then blocked
  the companion; the companion still accepted it (`status = accepted`).
- **Fix:** acceptance refuses blocked pairs and suspended members, and blocking cancels open bookings between the two.
  On the same scenario with the fix: "This booking can no longer be answered."
- **Tests:** `calls_and_live_rooms.sql` ("blocking cancels open bookings between the two", "a booking with a blocked
  person cannot be accepted").

## OPS-01 · Browser security headers (P2)

- **Reproduced (Inspected):** `render.yaml`'s static site set no headers.
- **Fix:** CSP (self, Supabase, `*.onrender.com`, LiveKit Cloud, Google Fonts; inline theme script by SHA-256;
  `frame-ancestors 'none'`; `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (camera and microphone for this origin only) and HSTS.
- **Tests:** both browser suites serve the app with exactly these headers (adding only local test origins) and fail on
  any CSP violation:
  - smoke 13/13;
  - real-media 59/59 (calls, broadcasting and guests all work under the policy);
  - MFA 17/17 (the QR image decodes);
  - all three also check that the CSP hash matches the built inline script.
- **Residual risk:**
  - Render must actually apply `headers` from the Blueprint. Check once with `curl -I` after the first deploy;
  - moving the API, Supabase or LiveKit to a custom domain requires adding it to `connect-src`;
  - `style-src 'unsafe-inline'` remains (React style attributes).

## CQ-03 · CodeQL `js/clear-text-logging` (new alert, fixed)

- **Reproduced (Verified):** CodeQL 2.27.5 flagged `server.ts:64`. The startup log printed values from the config
  object, which holds the anon key, the LiveKit secret and the webhook DB secret. Only port and environment were
  printed, but one careless log would leak them.
- **Fix:** printing the config (`JSON.stringify`, `console.log`, `util.inspect`) shows `[redacted]` for secret
  settings, and the startup line logs the socket's bound port.
- **Test:** `app.test.ts` "never prints secret settings when the config is logged or serialised".

## MFA-02 / MFA-03 · Recovery codes

- **MFA-02 (Verified):** codes were the first 12 hex digits of a UUID (48 bits). The stored unsalted SHA-256 could be
  reversed offline in hours. Now 20 digits (80 bits); old codes still accepted.
- **MFA-03 (Verified):** the recovery input had `maxLength={20}`, so a new-format code pasted with dashes (24
  characters) was cut and always rejected. It is now 40. `test:e2e:mfa` fails with the old limit.

## RTC-01 · Host mute of a live guest did not hold (CI run 44601328482)

- **Reproduced:** CI job `rtc` failed "host controls: muting a guest's camera mutes it on the media server" with
  `{"muted":0}`. Locally it passed 3/3 (the same LiveKit, Playwright and Node versions as CI), so the cause was timing.
- **Root cause:**
  1. The viewer draws a guest tile once _any_ guest track exists, and the studio publishes the microphone before the
     camera. On a slower runner the mute arrived before the camera, and `GetParticipant` listed no video track.
  2. The race exposed a product flaw: the mute touched only tracks that existed at that instant. A camera published
     a moment later, a reconnect or the guest's own unmute escaped it.
- **Fix:** the mute is stored in the database and enforced by the media server (permission and tokens). Unmuting
  restores permission only. See `RENTMATE_LIVEKIT_IMPLEMENTATION.md` §5.
- **Tests (assertion kept):**
  - the test now waits until LiveKit has the guest's live camera, keeps `muted === 1`, and adds 12 checks of
    LiveKit's own state (camera and mic, mute and allow, refused re-enable, reconnect while muted): 59/59;
  - with `UpdateParticipant` and token sources disabled, the new checks fail;
  - SQL `guest_host_mutes.sql` 18; API +2; web +2.

## SEC-05 · Integration secret strength

- **Reproduced:** `private.set_integration_secret` stored an unsalted SHA-256 and checked only length ≥ 32.
  `passwordpasswordpasswordpassword`, a spaced phrase and `aaaa…` were all accepted (test run without the fix). A
  guessable value could be recovered offline from its hash.
- **Fix:** `20261123100000_integration_secret_strength.sql` requires a generated token (base64/hex/url-safe
  alphabet, no spaces, ≥ 12 distinct characters), and `.env.example` says how to generate one
  (`openssl rand -base64 48`).
- **Test:** `integration_secret_strength.sql` 7/7. Rollback rehearsed.

## CQ-02 · CodeQL `js/insufficient-password-hash` (false positive)

- **Evidence:** CodeQL (2.27.4 and 2.27.5, `javascript-code-scanning`) reports "Password from an access to apiKey is
  hashed insecurely" at `providers.ts:70` (the `createHmac` line; 2.27.5 on 2026-11-20). The flow shows CodeQL classifying the LiveKit
  **API key id** as a password because of its name. That id is the public `iss` claim LiveKit requires in every HS256
  token. No password is hashed, and HS256 is the format LiveKit verifies.
- **Action:** dismiss manually in GitHub as "False positive" with the text in `docs/SECURITY_NOTES_LIVEKIT_JWT.md`.
  Nothing is suppressed in code. The line number moved from 57 to 61 to 70 because new LiveKit functions were added above it,
  so GitHub may show the alert as new.

## AUTH-02 · Age and identity verification (open, F-05)

**Today:** 18+ is enforced on the declared age (API and database). Moderators can record a verification for companions
and creators; no provider is integrated, and the app does not claim otherwise.

### Phase D: provider evaluation (no provider selected, nothing activated)

Prices are indicative, from public sources dated 2026, and must be confirmed with vendors.

| Need                   | Options                                                                                       | Indicative cost                                                                           | API / integration                                                                                                 | Privacy and retention notes                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Indian phone OTP       | MSG91, Gupshup, Kaleyra (direct, DLT); Twilio Verify; Firebase Phone Auth                     | ₹0.10–0.45 per OTP; Twilio ≈₹0.45; Firebase ≈$0.07                                        | Supabase supports Twilio, MessageBird, Vonage, Textlocal natively, and any provider through the **Send SMS Hook** | DLT registration of the sender and templates is mandatory in India; CAPTCHA and rate limits against SMS pumping |
| Adult age verification | DigiLocker (direct as a Requester Entity, or through an aggregator such as Digio or Decentro) | Aggregator ₹2–5 per document fetch; direct near zero after onboarding                     | OAuth consent flow; returns name, DOB, masked Aadhaar                                                             | Store only "18+ verified, method, date", never the document or Aadhaar number; user can revoke consent          |
| Identity / liveness    | HyperVerge, IDfy, Signzy (India); international vendors (Persona, Veriff, Onfido)             | Quote-based; a full onboarding was cited at about ₹30–50 with DigiLocker, ₹80–120 without | REST + webhooks; face match and liveness                                                                          | Biometric data is sensitive: avoid storing; contract for deletion; DPDP processor terms                         |
| Optional creator KYC   | Same as identity; PAN verification for future payouts                                         | Per check                                                                                 | Only when payouts are approved (F-10)                                                                             | Not needed while payouts are off                                                                                |
| Duplicate accounts     | Verified phone (one account per number) + DigiLocker identity hash + F-20 email hash          | Included in the above                                                                     | Database uniqueness on a keyed hash                                                                               | Keep keyed hashes, not identifiers                                                                              |

**Recommendation for the founder (decision F-04/F-05):**

1. Phone OTP through Supabase Phone Auth with an Indian DLT-registered provider, using the Send SMS Hook if the
   provider is not native.
2. DigiLocker through an aggregator for 18+ verification of companions and creators first, members later. Store only
   the verified flag, method and date.
3. Liveness and face match only for companions, if fraud requires it.

**Integration readiness:**

- The verification result already has a home: moderators record verifications, and badges show only verified facts.
- A provider integration would add an API webhook receiver (the same signed-webhook pattern as LiveKit) and a
  `private.integration_secrets` entry. No code was written for a specific vendor, so nothing implies verification is
  live.

**DPDP context (Unverified, needs legal advice):**

- The DPDP Rules 2025 were notified on 13 November 2025 with an 18-month phased rollout.
- Rule 10 (verifiable parental consent for children) is a reason to keep RentMate strictly 18+ and to verify age
  rather than rely on self-declaration.

### Sources

- [What does an SMS OTP cost in India? (productgrowth.in)](https://productgrowth.in/numbers/sms-otp-cost-india/)
- [Supabase: Phone sign-in](https://supabase.com/docs/guides/auth/phone-login) and
  [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
- [DigiLocker integration notes (javajack.github.io)](https://javajack.github.io/broking-kyc/vendors/identity/digilocker)
- [MeitY notifies DPDP Rules 2025 (Takshashila)](https://takshashila.org.in/content/blogs/20251114-meity-notifies-dpdp-rules-2025.html)
- [DPDP age-gating roadmap (Bureau)](https://bureau.id/blog/navigating-dpdp-age-gating-rules-a-compliance-roadmap-for-2025)
- [Digital identity verification in India (HyperVerge)](https://hyperverge.co/blog/what-is-digital-identity-verification/)
