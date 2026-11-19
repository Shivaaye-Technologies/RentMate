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

## Re-check on 2026-11-20 (alert now at line 70)

Lines moved as LiveKit functions were added (57 → 61 → 70); the alert is the same. CodeQL CLI 2.27.5,
`javascript-code-scanning` suite (GitHub's default setup) on the current branch, reports **one** result:

- Rule `js/insufficient-password-hash`, `apps/api/src/live/providers.ts:70`:
  `createHmac("sha256", apiSecret).update(signingInput).digest()` (the HS256 signer, `hs256Mac`).
- Source in all four flows: `this.opts.apiKey` (line 139, `requireCreds()`).
- Path: `apiKey` → `iss` claim of the token payload (`issueToken` line 148, `adminToken` line 178) →
  `JSON.stringify(payload)` → base64url → `` `${header}.${body}` `` → `signingInput` → `.update(signingInput)`.

**What CodeQL calls a password is the LiveKit API key ID**, and the "hash" is the HMAC-SHA256 over the token body
that contains it. The API **secret** never appears in a flow: it is only the HMAC key. That is the token format LiveKit
defines:

- LiveKit's token reference describes `iss` as the "API key used to issue this token" and says tokens are "signed
  with your API secret to prevent forgery";
- LiveKit's official Rust SDK sets `iss: api_key` and signs with `Algorithm::HS256` and
  `EncodingKey::from_secret(api_secret)`.

The key ID is readable (base64) in every token LiveKit clients receive, by design. Nothing stores it, and nothing
compares it as a credential.

Sources:

- [LiveKit: Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants.md)
- [livekit-api `access_token.rs`](https://docs.rs/livekit-api/0.4.9/src/livekit_api/access_token.rs.html)

**Is any real password or secret hashed insecurely?** Every hashing operation in the code base was checked:

| Where                                | What is hashed                                       | Verdict                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providers.ts:70` HMAC-SHA256        | Token header and claims (incl. the public key ID)    | Message authentication, required by LiveKit; not a password                                                                                                                                                                                                                                                                                                                  |
| `providers.ts` webhook SHA-256       | Webhook request body                                 | Integrity check against LiveKit's `sha256` claim; not secret                                                                                                                                                                                                                                                                                                                 |
| Member passwords                     | Never seen by RentMate code                          | Supabase Auth stores them (bcrypt)                                                                                                                                                                                                                                                                                                                                           |
| `private.integration_secrets` (SQL)  | LiveKit webhook integration secret, unsalted SHA-256 | Correct for a **generated** high-entropy token, not for a chosen phrase. Until now only length ≥ 32 was enforced, so a guessable value would have been accepted. **Fixed** in `20261123100000_integration_secret_strength.sql`: token alphabet only, no spaces, ≥ 12 distinct characters; test refuses phrases and repeats (3 guessable values were accepted before the fix) |
| `private.mfa_recovery_codes` (SQL)   | Recovery codes, SHA-256                              | 80 random bits per code: offline brute force out of reach                                                                                                                                                                                                                                                                                                                    |
| `private.retained_suspensions` (SQL) | Email with a random per-database key                 | Pseudonymous identifier, not a credential                                                                                                                                                                                                                                                                                                                                    |

## Dismissal guidance

**Disposition: false positive.** No code was suppressed and no variable renamed to avoid the heuristic.

How to dismiss (this session has no GitHub access, so the founder or a maintainer does it):

1. GitHub → **Security** → **Code scanning** → the `js/insufficient-password-hash` alert on `providers.ts`.
2. **Dismiss alert** → reason **False positive**.
3. Comment (paste):

> CodeQL's name heuristic classifies the LiveKit API key ID as a password. Flow (CodeQL 2.27.5): opts.apiKey →
> JWT `iss` claim → token body → HMAC-SHA256 signing input. LiveKit defines `iss` as the API key ID and requires
> HS256 signed with the API secret (LiveKit token docs; official Rust SDK). The key ID is public in every token; it is
> not stored or hashed as a credential. The API secret is only the HMAC key. Verifier: constant-time comparison,
> alg=HS256, exp/nbf. Evidence: docs/SECURITY_NOTES_LIVEKIT_JWT.md.

Or with the GitHub CLI (`<n>` = the alert number in the URL):

```bash
gh api -X PATCH repos/Shivaaye-Technologies/RentMate/code-scanning/alerts/<n> \
  -f state=dismissed -f dismissed_reason="false positive" \
  -f dismissed_comment="LiveKit API key ID in the HS256 JWT iss claim, not a password; see docs/SECURITY_NOTES_LIVEKIT_JWT.md"
```

If CodeQL later reports this rule anywhere else, or a different rule on these lines, treat it as new and investigate.
