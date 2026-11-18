# RentMate — Deployment Guide

Nothing in this guide is executed without explicit founder approval (F-02, F-03, F-16).

## Environments

| Environment | Web                                                                                | API                                             | Database                                 |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Local       | `npm run dev:web`                                                                  | `npm run dev:api`                               | PGlite tests (`npm run test:db`)         |
| Preview     | Vercel preview per PR (`apps/web`)                                                 | —                                               | —                                        |
| Staging     | Recommended: Render preview env or a second Render service on `rentmate-migration` | same                                            | Supabase branch or separate free project |
| Production  | Render `soulmate-web`                                                              | Render `soulmate-api` (auto-deploy from `main`) | Supabase `soulmate-ai`                   |

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
