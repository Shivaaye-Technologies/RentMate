# RentMate — Security Review

Status date: 2026-11-18. Scope: `rentmate-migration` at the Phase 1 commit. This is an engineering self-review,
not a certification. **An independent penetration test and legal review are required before launch.**

## Controls in place (verified by tests this session)

| Area                | Control                                                                                      | Evidence                                      |
| ------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Authentication      | Supabase JWT verified server-side; API fails closed (503) when auth is unconfigured          | API tests (79 passed)                         |
| Authorization / RLS | RLS on every table; column grants; privileged writes only through definer functions          | `rls_flow.sql` 53/53, `live_foundation` 49/49 |
| Age                 | 18+ in `ProfileInput` and `profiles.age` check constraint                                    | API + DB tests                                |
| Rate limiting       | express-rate-limit; live join 20/min; DB write limits (likes, reports)                       | API tests                                     |
| Headers             | helmet                                                                                       | API tests                                     |
| Secrets             | LiveKit/Supabase secrets only in server env; `.env` never read or committed (hook guards)    | 21/21 hook checks                             |
| Live policy         | Fail closed on unknown country, missing provider terms, missing verification; emergency stop | `live_foundation.sql`                         |
| XSS                 | React escaping; prompt text with `<script>` stored and rendered as text                      | browser check (app flow)                      |
| Demo isolation      | Fictional demo profiles never mix with real users                                            | `demo_isolation.sql` 21/21                    |
| Privacy             | Approximate distance only; exact location hidden; private photos                             | DB tests                                      |

## Risks and required work

| Risk                                                     | Severity | Plan                                                                                                                                                                       |
| -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub account suspended                                 | High     | No CI or code review is possible until it's restored (F-01). Work is kept locally and in a git bundle.                                                                     |
| No MFA for admins                                        | High     | M1: require `aal2` in admin functions; enrol admins in Supabase MFA.                                                                                                       |
| Only 2 admin roles                                       | Medium   | M1: 5-level RBAC with rank checks and no self-escalation.                                                                                                                  |
| Token ledger manipulation / replay                       | High     | M2: definer-only writes, row lock, `balance >= 0`, unique idempotency keys, no client grants.                                                                              |
| Call billing from client timers                          | High     | M3: bill only from signed LiveKit webhooks; verify the signature and reject stale timestamps.                                                                              |
| Booking race conditions                                  | High     | M4: exclusion constraint + transactions; concurrency tests.                                                                                                                |
| Physical-safety abuse (escorting, trafficking, stalking) | Critical | Category allow-list, public-venue-only rule, no address fields, keyword moderation, ID verification, check-in/out, SOS, reports with urgent priority, legal review (F-13). |
| OTP abuse (SMS pumping)                                  | High     | When F-04 lands: Supabase captcha, per-number and per-IP limits, country allow-list.                                                                                       |
| Media uploads                                            | Medium   | Storage policies exist for photos; chat media needs type/size checks and moderation before launch.                                                                         |
| Webhook SSRF/forgery                                     | Medium   | Only inbound webhooks; signature required; no user-supplied URLs fetched server-side.                                                                                      |
| CSRF                                                     | Low      | Bearer tokens in headers (no cookies) → not cookie-CSRF exposed.                                                                                                           |
| Logs leaking PII/OTP/tokens                              | Medium   | Keep request logging free of bodies and tokens; audit logging config before launch.                                                                                        |
| Supabase Auth Site URL = localhost                       | Medium   | F-17: set the Site URL and redirect URLs, custom SMTP, leaked-password protection.                                                                                         |

Dependency audit: zod upgraded to 4.6.7 (GHSA-mrhx-c7xc-m3w5). Run `npm audit` in each release PR.
