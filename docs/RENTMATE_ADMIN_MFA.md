# RentMate — Admin MFA

Date: 2026-11-20. Migrations `20261121100000_admin_mfa.sql` and `20261122090000_recovery_codes_and_retention.sql`.
Evidence: **Tested** (SQL suites and a browser test, run in this session) · **Not verified** (hosted Supabase
behaviour this session cannot reach).

## 1. Roles covered

RentMate has exactly two privileged roles, enforced by `private.user_roles.role in ('admin', 'moderator')`:

- **admin**: everything;
- **moderator**: reports, verification, suspensions, live moderation.

The brief's names ("Super Admin, Master Admin, Sub Admin, Agent") do not exist in RentMate's code or database. They
belong to a different project's privilege model, which was not used here. Mandatory MFA applies to **both** RentMate
roles. If a founder later wants more tiers (for example a support agent with read-only access), that needs a role
policy decision first; MFA would cover any new role through the same function.

## 2. How it works

| Piece              | Behaviour                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Factor             | Supabase Auth TOTP (authenticator app). Enrolment shows a QR code and a manual key; the first code verifies it                                               |
| Enforcement point  | `private.has_role()`, used by every RLS policy and admin function, also requires `private.mfa_satisfied()`                                                   |
| `mfa_satisfied()`  | True if MFA is not required yet, or the session is `aal2`, or a 15-minute recovery grant is active                                                           |
| Switch             | `admin_set_mfa_required(true)`: admin only, from an `aal2` session, **refused while any admin or moderator lacks a verified factor**                         |
| Readiness          | `admin_mfa_readiness()` lists every privileged person and whether they have a factor (Admin → Security panel)                                                |
| Recovery codes     | 10 single-use codes, 20 hex digits (80 bits), shown once, stored as SHA-256 only; generated only from `aal2`                                                 |
| Recovery           | A code gives a 15-minute grant to set up a new authenticator and **revokes the person's other sessions**                                                     |
| Rate limit         | 5 failed recovery attempts per hour lock recovery for that account (returns `locked`, logged)                                                                |
| Session revocation | `auth.sessions.not_after = now()` (nothing deleted). Also when a role is removed. Access tokens already issued expire within their lifetime (1 hour default) |
| Audit              | Every MFA event (codes generated, recovery used/failed/locked, switch on/off, sessions revoked) goes to `moderation_actions`                                 |
| UI                 | `AdminGate` in front of both admin consoles: enrol → recovery codes (must tick "I have saved these codes") → admin; or 6-digit challenge; or recovery code   |

## 3. No-lockout migration plan (founder actions)

1. Apply the migrations. MFA is **off**, and every admin and moderator keeps access as today.
2. Each admin and moderator opens the admin console, enrols an authenticator and saves their recovery codes.
3. An admin checks Admin → Security → readiness: everyone shows "has factor".
4. An admin (in an `aal2` session) switches mandatory MFA on. The database refuses while anyone is missing a factor,
   so no one can be locked out by the switch.
5. If someone loses their phone: recovery code → new authenticator → new recovery codes. If they also lost their
   codes, another admin removes and re-adds their role (sessions revoked) and they enrol again. If the **last** admin
   loses both, the founder resets the factor in the Supabase dashboard (Authentication → Users → the user → MFA).

## 4. Test evidence (this session)

- `supabase/tests/admin_mfa.sql`, 28 checks:
  - no lockout before the switch;
  - switch only from `aal2` and refused while factors are missing;
  - `aal1` loses privileges once required, `aal2` keeps them;
  - moderators get moderator powers only;
  - recovery codes only after verification;
  - single use, lockout after 5 failures, 15-minute grant;
  - other sessions revoked; role removal revokes sessions;
  - everything logged.
- `supabase/tests/recovery_codes_and_retention.sql`: 80-bit format, distinct codes, hashes only, any case and spacing
  accepted, single use, older 12-digit codes still accepted.
- `npm run test:e2e:mfa`, 17 browser checks in real Chromium under the production CSP:
  - enrolment: QR decodes, key shown, digits only, wrong code refused, verify raises the session to `aal2`;
  - codes shown once, and acknowledgement is required;
  - challenge on a password-only session;
  - recovery with a pasted 28-character code reaches the server complete. This found and fixed a real bug: the field
    used to cut codes to 20 characters;
  - wrong code, and lockout.

## 5. Not verified / residual risks

- **Hosted Supabase rights on `auth.sessions`:** the migration updates `auth.sessions.not_after`. On hosted Supabase
  the `postgres` role normally has this right, but it was not verified here. If it is missing, `revoke_sessions`
  returns false and logs it; then revoke sessions in the dashboard or through the Auth admin API.
- **TOTP only:** no WebAuthn or passkeys yet; no SMS second factor (deliberately, given SIM-swap risk).
- **Recovery code storage:** unsalted SHA-256 of an 80-bit random value; offline brute force is out of reach.
- **Access token lifetime:** a stolen `aal2` access token stays valid until it expires (default 1 hour). Shorten the JWT
  expiry in Supabase Auth settings for admins if needed (F-17).
- **Enforcement not switched on:** MFA is not required until the founder completes the plan above (F-25).
