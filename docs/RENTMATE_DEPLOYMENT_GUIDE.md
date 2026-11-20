# RentMate — Deployment Guide

Nothing in this guide is executed without explicit founder approval (F-02, F-03, F-16).

## Environments

| Environment | Web                                                                                | API                                             | Database                                 |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Local       | `npm run dev:web`                                                                  | `npm run dev:api`                               | PGlite tests (`npm run test:db`)         |
| Preview     | Vercel preview per PR (`apps/web`)                                                 | —                                               | —                                        |
| Staging     | Recommended: Render preview env or a second Render service on `rentmate-migration` | same                                            | Supabase branch or separate free project |
| Production  | Render `soulmate-web`                                                              | Render `soulmate-api` (auto-deploy from `main`) | Supabase `soulmate-ai`                   |

## Repository

The RentMate code now lives in `rentmate970-hue/RentMate` on branch `feature/rentmate-conversion` (full Soulmate-AI
history kept). The existing Render services still build from the old repository. Pointing them — or new RentMate
services — at the new repository is a founder decision (F-23); nothing has been changed on Render.

## Build, start and health

| Service | Build command                                       | Start / publish                                                 | Health              |
| ------- | --------------------------------------------------- | --------------------------------------------------------------- | ------------------- |
| API     | `npm ci --include=dev && npm run build -w apps/api` | `npm start -w apps/api`                                         | `GET /health` → 200 |
| Web     | `npm ci --include=dev && npm run build -w apps/web` | static, publish `apps/web/dist`, SPA rewrite `/* → /index.html` | landing page loads  |

## Environment variables (production)

No new variables are needed for the marketplace: it uses Supabase only (RLS + database functions).

| Where | Variable                                                      | Notes                                                    |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------- |
| API   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`                           | Publishable key; the API never uses the service-role key |
| API   | `CORS_ORIGINS`                                                | The web origin(s)                                        |
| API   | `LIVEKIT_*`, `LIVE_COUNTRY_HEADER`                            | Only after the provider's terms are approved (F-06)      |
| Web   | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser-safe values only; never a secret key             |

## Database migrations (in order, after a backup and approval)

1. `20261024090000_profile_details`
2. `20261101090000_live_foundation`
3. `20261118090000_no_adult_content`
4. `20261118100000_policy_hardening`
5. `20261119090000_marketplace` — installs `btree_gist` in the `extensions` schema (available on Supabase)

All are additive; none deletes data. After applying: run Supabase `get_advisors` (security and performance), then
make yourself admin once in SQL (`insert into private.user_roles (user_id, role) values ('<your user id>', 'admin');`).

## Deployment checklist

- [ ] GitHub access to `rentmate970-hue/RentMate` for Claude (or push from your own machine).
- [ ] PR reviewed; CI green (policy guard, format, lint, typecheck, unit + DB tests, build, e2e).
- [ ] Supabase backup taken; migrations 1–5 applied; advisors checked.
- [ ] Supabase Auth: Site URL and redirect URLs set to the production web address; custom SMTP (F-17).
- [ ] Render services pointed at the approved repository/branch (F-23); environment variables entered by you.
- [ ] Smoke test: `/health`, landing, sign-in, `#companions` search, a test booking between two test accounts.
- [ ] Payments stay off (they cannot be switched on without a new reviewed migration).

## Release steps

1. GitHub access restored (F-01). Push `rentmate-migration`; open PRs per phase into it, then one release PR into `main`.
2. CI green: `npm run check && npm run test:hooks && npm run test:aihub && npm run test:e2e`.
3. Back up production (Supabase dashboard → Database → Backups, or `pg_dump` of `public` and `private`).
4. Apply approved migrations in order with the Supabase migration tool; run `get_advisors` (security + performance).
5. Set new environment variables in Render (names only are in `.env.example`; values are entered by the founder):
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVE_COUNTRY_HEADER`.
6. Founder merges the release PR to `main` → Render deploys.
7. Verify: `GET /health` 200, `GET /` shows `"name": "RentMate API"`, landing shows RentMate, sign-in works,
   `/privacy.html` loads.
8. If any check fails → `RENTMATE_ROLLBACK_PLAN.md`.

## HostyCare/cPanel

Not audited (no access). Suitable for static marketing/legal pages if it serves HTTPS. Not recommended for the API
unless it provides Node 20+, persistent processes and environment variables; Render already does this.
