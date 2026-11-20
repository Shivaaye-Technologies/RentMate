# RentMate — Deployment Readiness (inspection only)

Date: 2026-11-19 · Branch: `feature/rentmate-conversion`. Nothing was deployed. No production environment variable,
database or Render service was read or changed. Labels: **Verified** (executed here) · **Inspected** (read) ·
**Unverified** (production state this session cannot see).

**Verdict: deployment-preparable, not deployment-ready.** The code, migrations, rollback and checks are in place and
tested locally and in CI. Approvals and production settings below must be completed first.

## 1. Blockers (must be resolved before any production deploy)

| #   | Blocker                                                                                                          | Owner   | Ref        |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| B1  | PR #1 reviewed and merged by a human; CI green on the merge commit                                               | Founder | F-02, F-16 |
| B2  | GitHub default branch changed to `main` (Render and other tools follow it)                                       | Founder | F-26       |
| B3  | Render services connected to `Shivaaye-Technologies/RentMate` on branch `main` (`render.yaml` now pins it)       | Founder | F-23       |
| B4  | Production database backup, then migrations `20261024090000` … `20261120100000` applied in order, after approval | Founder | F-03       |
| B5  | MFA for admins before admin powers are used in production                                                        | Founder | F-25       |
| B6  | Supabase Auth settings: Site URL, redirect URLs, custom SMTP, leaked-password protection                         | Founder | F-17       |

Not blockers for a dating-plus-booking-requests launch, but blockers for those features: LiveKit terms and plan (F-06)
for live; payments, KYC, legal and GST (F-10, F-24) for paid bookings; a verification vendor (F-05) for verified badges.

## 2. Build and runtime (Inspected; build Verified locally)

| Service        | Type        | Build                                               | Start / publish                               | Health                                      |
| -------------- | ----------- | --------------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| `soulmate-api` | Node 22 web | `npm ci --include=dev && npm run build -w apps/api` | `npm start -w apps/api`                       | `GET /health` → 200 while the process is up |
| `soulmate-web` | Static      | `npm ci --include=dev && npm run build -w apps/web` | `apps/web/dist`, SPA rewrite to `/index.html` | —                                           |

- Both services: `branch: main`, `autoDeploy: true`, region Singapore. The API is on the **free** plan, so it sleeps
  when idle and has cold starts. Service names still use the old `soulmate-*` prefix (cosmetic; renaming creates new
  services and URLs).
- `/health` is **liveness only**. It deliberately does not call Supabase. There is no readiness endpoint, so a broken
  Supabase configuration shows up as request errors, not a failed health check. The API refuses to start in production
  without `SUPABASE_URL` and `SUPABASE_ANON_KEY` (config validation, Verified in unit tests).
- `/` lists routes and never includes configuration values.

## 3. Environment variable inventory (values omitted)

| Variable                 | Service | Secret?     | Required              | Validation / notes                                                                                                            |
| ------------------------ | ------- | ----------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | API     | No          | Yes (`production`)    | Enum                                                                                                                          |
| `NODE_VERSION`           | API     | No          | Yes (`22`)            | Render runtime                                                                                                                |
| `PORT`                   | API     | No          | Set by Render         | Positive integer, default 4000                                                                                                |
| `CORS_ORIGINS`           | API     | No          | **Yes**               | Comma-separated exact origins (the production web URL). The default `http://localhost:5173` must not be used in production    |
| `SUPABASE_URL`           | API     | No          | Yes in production     | URL                                                                                                                           |
| `SUPABASE_ANON_KEY`      | API     | Publishable | Yes in production     | Used only to verify user tokens; RLS protects data                                                                            |
| `TRUST_PROXY`            | API     | No          | Optional              | 0–5; defaults to 1 in production (Render's proxy), so rate limits see real client IPs                                         |
| `LIVEKIT_URL`            | API     | No          | Only with live (F-06) | Must start with `wss://` or `https://`                                                                                        |
| `LIVEKIT_API_KEY`        | API     | Key ID      | Only with live        | Public identifier (token issuer)                                                                                              |
| `LIVEKIT_API_SECRET`     | API     | **Secret**  | Only with live        | The LiveKit-generated secret (32+ characters, 12+ distinct); never sent to clients or logs                                    |
| `LIVE_COUNTRY_HEADER`    | API     | No          | Optional              | Lower-case header from a trusted CDN (e.g. `cf-ipcountry`). Unset = country unknown, and country-limited content stays hidden |
| `VITE_API_URL`           | Web     | No          | Yes                   | API base URL, baked into the build                                                                                            |
| `VITE_SUPABASE_URL`      | Web     | No          | Yes                   | Baked into the build                                                                                                          |
| `VITE_SUPABASE_ANON_KEY` | Web     | Publishable | Yes                   | Safe in the browser. **Never** put a service-role key in any `VITE_*` variable                                                |

No service-role key is used anywhere in the code (Inspected; policy guard scans for key patterns).

## 4. Database migrations (Verified on a fresh PostgreSQL 16 and PGlite)

Apply in filename order after a backup (B4). The two added in this round:

| Migration                            | What it changes                                                                                | Data effect                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `20261120090000_audit_hardening.sql` | Server timestamps, suspension policies and live wrappers, booking fixes, privilege revocations | None on existing rows                                                  |
| `20261120100000_token_wallet.sql`    | Wallet, ledger, rates, locked financial flags, registration bonus                              | **Creates a 100-token bonus entry for every existing non-demo member** |

- Every earlier migration is unchanged (append-only).
- Rollback: `docs/rollback/20261120_audit_hardening_and_wallet.rollback.sql`, rehearsed by `npm run test:rollback`.
  Export `public.token_ledger` before using it. Apply it as a new forward migration with approval.
- Unverified: which migrations production already has. Per F-03, nothing after `20261024090000` is applied. Check
  `supabase_migrations.schema_migrations` before applying.

## 5. Security configuration (Inspected)

- **CORS:** exact-origin allowlist from `CORS_ORIGINS`; no wildcard.
- **API headers:** `helmet` defaults. JSON bodies are capped at 100 kb, and `x-powered-by` is off.
- **Rate limits:** 120 requests/minute per IP on `/api/v1`, and 20 live joins/minute. Database write limits cover likes,
  messages, reports, bookings and chat.
- **Static site:** no security headers configured (OPS-01). Add CSP, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff` and `Referrer-Policy` in `render.yaml` after testing in a preview deploy.
- **Storage:** private `photos` bucket, images only, 5 MB; owner-folder writes; signed-in, not-blocked reads.
- **Logging:** the API logs only unhandled error messages (`[api] unhandled error: …`), never request bodies or tokens.
  There is no structured logging or error tracking (Sentry or similar), and no request IDs.
- **Supabase (Unverified):** the exposed schemas must be `public` (+ `graphql_public`) only, and RLS stays on (it is
  enforced by migrations, but dashboard SQL access should be restricted, F-21).

## 6. LiveKit configuration (Inspected)

The provider row is `disabled` until F-06. While it is disabled, the database refuses joins with
`provider_not_enabled` (403, "The streaming service for this stream isn't enabled."). Once enabled, joins return 503
("isn't set up on the server yet") while the API has no credentials. To enable after approval:

1. Set the three `LIVEKIT_*` variables.
2. Enable the provider in the admin console.
3. Verify a join from a preview deploy.

The web app has no media client yet (LIVE-01), so enabling LiveKit alone does not give users live video.

## 7. Deployment checklist

1. [ ] B1–B6 done; decisions recorded in `docs/FOUNDER_APPROVALS.md`.
2. [ ] CI green on `main`: check (policy, format, lint, typecheck, unit + SQL suites, rollback rehearsal, hooks,
       aihub, build, secret scan, audit), browser (Chromium smoke), db-concurrency (PostgreSQL 16).
3. [ ] CodeQL: CQ-02 dismissed as a false positive with the documented comment; no other open alerts.
4. [ ] Production database backup taken and restorable.
5. [ ] `select version from supabase_migrations.schema_migrations order by 1;` compared with `supabase/migrations/`.
6. [ ] Migrations applied in order. Then check that `select count(*) from public.token_ledger where reason =
'registration_bonus'` equals the non-demo member count, and that the Supabase security advisors show no new issues.
7. [ ] Render environment variables set per §3 (`CORS_ORIGINS` = the production web origin).
8. [ ] Deploy from `main`; `GET /health` returns `{"status":"ok","authConfigured":true}`.
9. [ ] Smoke test in production: sign up, confirm email, onboarding, discovery, like/match/chat, block/report, booking
       request/accept/cancel, admin login.
10. [ ] Rollback ready: Render "Rollback" to the previous deploy for code; database rollback SQL only with approval.
