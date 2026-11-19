# Security note — LiveKit JWT signing (CodeQL alerts in `apps/api/src/live/providers.ts`)

Date: 2026-11-19 · Branch: `feature/rentmate-conversion`

## What was flagged

GitHub code scanning (CodeQL) raised two alerts on the HMAC lines of `apps/api/src/live/providers.ts` (lines 49 and
57). After commit `c58ee51` those became outdated and one alert remains at **line 57**.

On 2026-11-19 the CodeQL CLI **2.27.4** was run locally on this branch with the `javascript-code-scanning` suite (the
suite GitHub's default setup uses) and with `javascript-security-extended`. Both report exactly one result there:

- Rule: `js/insufficient-password-hash` ("Use of password hash with insufficient computational effort").
- Message: "Password from an access to apiKey is hashed insecurely."
- Data flow: `this.opts.apiKey` → `requireCreds()` → the `iss` claim of the token payload (`issueToken` and
  `adminToken`) → `JSON.stringify(payload)` → base64url → `` `${header}.${body}` `` → `hs256Mac(signingInput)` →
  `createHmac("sha256", apiSecret).update(signingInput)` on line 57.

So CodeQL's name heuristic classifies the LiveKit **API key** as a password. The LiveKit API key is the public key
identifier (for example `APIxxxxxxxx`). LiveKit requires it in the `iss` claim so the server knows which secret to verify
with. It is readable by anyone holding a token, by design. It is not a password, nothing stores it, and the "hash" is the
JWT signature over the token body.

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

This alert is a **false positive**. No inline suppression has been added and no variable was renamed to avoid the
heuristic. Dismissal is a reviewer decision in GitHub (Security → Code scanning → the alert → Dismiss alert →
**False positive**), with this comment:

> CodeQL treats the LiveKit API key ID as a password because of its name. It flows into the `iss` claim of an HS256
> JWT, which LiveKit requires (RFC 7518 HS256, keyed with the server-side API secret). The key ID is public by design
> and is not stored or hashed as a credential. The verifier uses constant-time comparison, enforces alg=HS256 and
> checks exp/nbf. Reproduced with CodeQL 2.27.4 (javascript-code-scanning); see docs/SECURITY_NOTES_LIVEKIT_JWT.md.

Other CodeQL results from the same local run: `js/file-system-race` in `scripts/policy-check.mjs` (security-extended
suite only) was fixed by reading each file through one handle. The Actions suite reports nothing for
`.github/workflows/ci.yml`.
