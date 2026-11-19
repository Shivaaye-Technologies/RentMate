# Security note — LiveKit JWT signing (CodeQL alerts in `apps/api/src/live/providers.ts`)

Date: 2026-11-19 · Branch: `feature/rentmate-conversion`

## What was flagged

GitHub code scanning (CodeQL) raised two alerts in `apps/api/src/live/providers.ts`: line 49 (the HMAC computed in
`signJwt`) and line 57 (the HMAC recomputed in `verifyJwt`). The alert text could not be read from the development
session (no GitHub API access to the repository), so this note covers both readings that fit hashing code on those lines.

## What the code does

LiveKit access tokens are JSON Web Tokens signed with **HS256**, which is HMAC-SHA256 keyed with the project's
**API secret**. The LiveKit server verifies tokens only in that format, so the algorithm and token layout cannot change
without breaking every join. These functions:

- sign room-join tokens (`issueToken`) and short-lived RoomService admin tokens (`adminToken`);
- receive only claims (identity, room, grants, expiry) and the server-side API secret, which comes from the
  environment and is never sent to clients;
- never receive a user password. Login is handled by Supabase Auth.

## Assessment

| Possible finding                                                             | Applies? | Reason                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weak or insufficient hash used on a password (password-hashing rules)        | No       | HMAC-SHA256 here is a message authentication code, not password storage. Slow password hashes (bcrypt, scrypt, Argon2) produce no MAC that LiveKit can verify and would break compatibility. The key is a high-entropy random API secret, not a human-chosen password. |
| Broken or risky algorithm                                                    | No       | SHA-256 in HMAC is the algorithm required by RFC 7518 for HS256 and by LiveKit.                                                                                                                                                                                        |
| Non-constant-time signature comparison in `verifyJwt`                        | **Yes**  | The old code compared signatures with `!==`. Fixed (see below).                                                                                                                                                                                                        |
| `alg` header not checked in `verifyJwt` (`alg: none` or algorithm confusion) | **Yes**  | The old code ignored the header. Fixed (see below).                                                                                                                                                                                                                    |

Conclusion: the hashing itself is a **false positive** for password-hashing rules. The surrounding verifier still
had two genuine weaknesses, and those have been fixed. `verifyJwt` is used by tests and for defence in depth; production
tokens are verified by the LiveKit server.

## Changes made

- `verifyJwt` now requires exactly three parts and a header declaring `alg: "HS256"`, compares the signature with
  `crypto.timingSafeEqual`, returns `null` for malformed input instead of throwing, and only returns object payloads.
- The HMAC is computed in one documented helper (`hs256Mac`). Token output is byte-for-byte unchanged.
- New tests in `apps/api/test/live.test.ts`:
  - a known-answer test using the published jwt.io HS256 example, which proves the format is standard and unchanged;
  - rejection of tampered payloads, flipped and truncated signatures, `alg: none` tokens (with and without a
    signature), extra segments and malformed base64.

## Dismissal guidance

If CodeQL still reports the HMAC lines after re-scanning this branch, dismiss them as **"False positive"** with this
comment: _"HS256 HMAC keyed with the server-side LiveKit API secret (required token format, RFC 7518); no password is
hashed. Verifier uses constant-time comparison and enforces alg=HS256. See docs/SECURITY_NOTES_LIVEKIT_JWT.md."_
No inline suppression comment has been added to the code. Dismissal is a reviewer decision in the GitHub UI.
