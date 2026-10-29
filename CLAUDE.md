# SOULMATE.AI — Project Instructions for Claude

Dating app: users create a profile, get ranked matches, like each other, and chat after a mutual like.

## Architecture

- `apps/api` — Node 20+ / Express / TypeScript REST API. Entry `src/server.ts`; app factory `src/app.ts` (dependencies injected, so tests need no network). Auth = Supabase JWT verified in `src/auth.ts`. Matching logic is pure in `src/matching.ts`.
- `apps/web` — React 18 + Vite + TypeScript. API base URL from `VITE_API_URL`.
- `supabase/migrations` — Postgres schema. RLS is enabled on every table; the mutual-like trigger creates matches.
- Hosting target: API and web on Render, database and auth on Supabase.

## Commands

| Task              | Command                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| Install           | `npm ci`                                                                        |
| Dev API / web     | `npm run dev:api` / `npm run dev:web`                                           |
| Lint              | `npm run lint`                                                                  |
| Format check      | `npm run format:check`                                                          |
| Typecheck         | `npm run typecheck`                                                             |
| Unit tests        | `npm test`                                                                      |
| Hook guard tests  | `npm run test:hooks`                                                            |
| DB tests (local)  | `npm run test:db`                                                               |
| aihub tests       | `npm run test:aihub`                                                            |
| Browser smoke     | `npm run test:e2e` (needs Playwright)                                           |
| Build             | `npm run build`                                                                 |
| Everything (= CI) | `npm run check && npm run test:hooks && npm run test:aihub && npm run test:e2e` |

## Conventions

- TypeScript strict. Validate every request body with zod in `src/validation.ts`.
- Keep business logic pure and unit-tested; keep Express handlers thin.
- New behavior ships with tests. Fix the code, never weaken a test to make it pass.
- Small, reviewable commits on a feature branch. Conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

## Workflow (self-repair loop)

INSPECT → PLAN → IMPLEMENT → TEST → ANALYZE FAILURES → FIX → RETEST → REPORT

- Work from real error output. Find the root cause before changing code.
- At most 3 repair attempts per failure, then stop and report what you tried and the exact error.
- Never claim a check passed unless you ran it in this session and saw it pass.

## Security rules (non-negotiable)

- Never read, print, or commit `.env` files or secrets. Use `.env.example` for documentation.
- Users must be 18+. Enforced in `ProfileInput` and the `profiles.age` check constraint; do not relax either.
- Never disable auth, RLS, rate limiting, or helmet to make something work. Auth fails closed (503) when unconfigured.
- Migrations are append-only. Add a new timestamped file in `supabase/migrations/`; never edit an applied one.
- Destructive database operations, production deploys, and pushes to `main` require explicit human approval.
- The project hooks in `.claude/hooks/` enforce several of these. If a hook blocks you, do not work around it; explain and ask.

## Deployment

See `docs/DEPLOYMENT_GUIDE.md`. Summary: PR → CI green → human merges to `main` → Render auto-deploys → check `GET /health`.
