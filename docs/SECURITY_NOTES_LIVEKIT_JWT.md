# Security note — LiveKit JWT signing and the CodeQL alert in `apps/api/src/live/providers.ts`

Last reviewed: 2026-11-20 · Branch `feature/rentmate-conversion` · Reviewed from `5bb6d5d`; line numbers below refer to
the commit that adds this revision.

## 1. The alert

- Rule: `js/insufficient-password-hash` ("Use of password hash with insufficient computational effort").
- Location: `apps/api/src/live/providers.ts:70`, `createHmac("sha256", apiSecret).update(signingInput).digest()` inside
  `hs256Mac`, the HS256 signer.
- CodeQL's message: "Password from an access to apiKey is hashed insecurely."
- Data flow (CodeQL CLI, `javascript-code-scanning` suite, the suite GitHub's default setup runs):
  `this.opts.apiKey` (`requireCreds()`, line 175) → the `iss` claim of a token payload (`issueToken` line 185,
  `adminToken` line 217) → `JSON.stringify(payload)` → base64url → `` `${header}.${body}` `` → `signingInput` →
  `.update(signingInput)` on line 70.

**Root cause.** CodeQL's name heuristic treats a value called `apiKey` as a password. In LiveKit, the API key is the
public key **identifier** (`APIxxxxxxxx`). LiveKit requires it in the token's `iss` claim so its server knows which
secret to verify with, and anyone holding a token can read it. Nothing in RentMate stores it, compares it as a credential
or hashes it for storage. The "hash" CodeQL sees is the JWT signature computed over a token body that contains the key ID.

## 2. HMAC signing is not password hashing

|                             | Password hashing                                                                   | HMAC-SHA256 here (HS256)                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Purpose                     | Store a human-chosen secret so it can be checked later, without keeping the secret | Prove a message (the token) was produced by someone holding the key, and was not changed |
| Input that must stay secret | The password (low entropy, chosen by a person)                                     | The **key**: the LiveKit API secret, a random value LiveKit generates (43 characters)    |
| What is "hashed"            | The password                                                                       | The token header and claims, which are public (base64 in every token)                    |
| Right algorithm             | Deliberately slow, salted (Argon2, scrypt, bcrypt) to make guessing expensive      | A MAC fixed by the protocol: RFC 7518 HS256 = HMAC-SHA256; LiveKit verifies only this    |

**Why a slow hash would be wrong.** LiveKit's server accepts a token only if its signature is HMAC-SHA256 of
`header.body` keyed with the API secret ([LiveKit tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants.md);
the official SDK signs with `Algorithm::HS256` and `EncodingKey::from_secret(api_secret)`,
[livekit-api `access_token.rs`](https://docs.rs/livekit-api/0.4.9/src/livekit_api/access_token.rs.html)). Argon2, scrypt or
bcrypt output is not an HS256 signature, so every join, webhook and RoomService call would fail. A slow hash also
protects nothing here: the security of HS256 depends on the **secret** being unguessable, which is enforced in
configuration (§4).

## 3. Verification (traced in code and tests, not taken from comments)

| #   | Property                                                           | Result                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No user password reaches `signJwt`, `hs256Mac` or the webhook hash | Pass                   | Callers of `signJwt`: `issueToken`, `adminToken` (claims: key ID, user id, room, grants, times) and tests. Webhook hash input: the raw request body. Member passwords never reach the API (Supabase Auth).                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | API secret is held server-side only                                | Pass                   | Read from the environment (`config.ts`, redacted when printed: `SECRET_KEYS`), used only as the HMAC key. Join responses are `{url, token, expiresAt, room, …}` (`calls.ts`, `routes.ts`). Tests: "never puts the API secret in responses or error messages", "shows admins which providers are configured, never their secrets", "never prints secret settings when the config is logged".                                                                                                                                                                                                                                                              |
| 3   | HS256 only; algorithm substitution refused                         | Pass                   | Fixed header `{"alg":"HS256"}`; `verifyJwt` returns null unless `alg === "HS256"` (line 95). Test: `none`, `HS512`, `RS256` headers refused, with and without a signature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4   | Constant-time signature comparison                                 | Pass                   | `timingSafeEqual` after a length check (line 98), and for the webhook body digest (line 297).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5   | `exp` and `nbf` enforced                                           | Pass                   | `verifyJwt` with `nowSeconds` refuses missing or past `exp` and future `nbf` (lines 103–104); the webhook always passes the time. Tests: expired, not-yet-valid, no expiry; webhook expired and not-yet-valid. In production LiveKit's server checks the tokens RentMate issues.                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | Webhook issuer and exact body digest                               | Pass                   | `claims.iss === apiKey` and base64 SHA-256 of the exact raw body (lines 294–297); the route is mounted before the JSON parser. Tests: wrong issuer, wrong secret, changed body, another body's digest, short digest, no digest, malformed payloads (non-JSON, array, string, null, empty): all 401, nothing stored.                                                                                                                                                                                                                                                                                                                                      |
| 7   | Admin tokens short-lived with minimum permissions                  | **Was failing, fixed** | Every RoomService call was signed with `roomAdmin + roomList + roomCreate`. `roomCreate` is not room-scoped, so each 60-second mute or stats token could also create or delete any room in the project. Now each call carries only what LiveKit documents for it ([RoomService API](https://docs.livekit.io/reference/other/roomservice-api.md)): `DeleteRoom` → `roomCreate`; `ListParticipants`, `GetParticipant`, `RemoveParticipant`, `MutePublishedTrack`, `UpdateParticipant` → `roomAdmin` for that one room. No `roomList`, no `roomJoin`, no `sub`; 60 seconds. Verified against a real LiveKit 1.13.11 server (`npm run test:e2e:rtc`, 59/59). |
| 8   | Client responses never contain the key secret                      | Pass                   | See 2. The key **ID** is inside every token by protocol (`iss`); it is not a secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | Only authorised server code issues participant tokens              | Pass                   | `/api/v1/calls` and `/api/v1/live` are mounted after `requireAuth` (`app.ts`); every join first runs a database check (`call_join_check`, `live_watch_check`, `live_broadcast_check`, `live_session_check`) and signs only when it returns no problems. Tests: sign-in required, refusals issue no token, suspended accounts get none, 503 without credentials.                                                                                                                                                                                                                                                                                          |
| 10  | Room, identity and TTL validated                                   | Pass (hardened)        | Callers pass `TOKEN_TTL_SECONDS` (600), database-generated room names (`sm-`/`ps-`/`call-` + random UUID) and the signed-in user's id. The signer now also refuses, as defence in depth, TTLs that are not whole numbers from 1 to 3600 and rooms or identities that are empty, longer than 256 characters or contain control characters.                                                                                                                                                                                                                                                                                                                |

**Secret strength (found during item 2).** `LIVEKIT_API_SECRET` was accepted at 16 characters of anything. Every member
receives a token signed with this secret, so a guessable value could be recovered offline from any token and used to forge
admin tokens. It must now be at least 32 characters, contain no whitespace and have at least 12 distinct characters;
messages never repeat the value. LiveKit-generated secrets (43 characters) pass.

## 4. Other hashing in the code base

| Where                                | What is hashed                       | Verdict                                                                                                 |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `providers.ts` webhook SHA-256       | Webhook request body                 | Integrity check against LiveKit's `sha256` claim; not a secret                                          |
| Member passwords                     | Never seen by RentMate code          | Supabase Auth stores them                                                                               |
| `private.integration_secrets` (SQL)  | Webhook integration secret, SHA-256  | Correct for a generated token; strength enforced since `20261123100000_integration_secret_strength.sql` |
| `private.mfa_recovery_codes` (SQL)   | Recovery codes, SHA-256              | 80 random bits per code                                                                                 |
| `private.retained_suspensions` (SQL) | Email with a random per-database key | Pseudonymous identifier, not a credential                                                               |

## 5. Disposition

**False positive** for `js/insufficient-password-hash`. No code was changed, suppressed or renamed to silence it. The
two defects above (admin-token scope and secret strength) are separate, real findings and are fixed with tests; they do
not change the flagged line.

**CodeQL re-run on this revision (2026-11-20).** CodeQL CLI 2.27.5, `javascript-code-scanning` suite (87 rules), on the
working tree with the changes above: **one result**, `js/insufficient-password-hash` at `providers.ts:70`, with four
flows, all starting from `apiKey` (`requireCreds()` line 175 or the `iss: apiKey` claims at lines 185 and 217) and
ending at the HMAC. No other rule fires anywhere in the repository, and the admin-token, secret-strength and grant-check
changes introduced no new result. This is a local run; GitHub's own analysis of the pushed commit is what the alert
page shows.

**GitHub has not dismissed the alert.** This session cannot read or change code-scanning alerts. A maintainer with
write access dismisses it:

1. Open `https://github.com/Shivaaye-Technologies/RentMate/security/code-scanning`.
2. Filter `is:open rule:js/insufficient-password-hash` (or open the alert linked from PR #1's CodeQL check).
3. Confirm the alert's location is `apps/api/src/live/providers.ts` on the `hs256Mac` line and its source is `apiKey`.
   If it points anywhere else, stop: that is a new finding.
4. Click **Dismiss alert** → choose **False positive**.
5. Paste this comment and confirm:

> CodeQL's name heuristic treats the LiveKit API key ID as a password. Flow: opts.apiKey → JWT `iss` claim → token
> body → HMAC-SHA256 (HS256) signing input. LiveKit defines `iss` as the API key ID and requires HS256 keyed with the
> API secret; a slow password hash would produce tokens LiveKit rejects. The key ID is public in every token and is not
> stored as a credential. Verifier: alg=HS256 only, constant-time comparison, exp/nbf. Admin tokens: per-call minimum
> grants, 60 s. Secret: ≥ 32 chars, ≥ 12 distinct. Evidence: docs/SECURITY_NOTES_LIVEKIT_JWT.md.

6. Re-open PR #1's checks and confirm the CodeQL check no longer reports the alert.

If CodeQL later reports this rule elsewhere, or a different rule on these lines, treat it as new and investigate.
