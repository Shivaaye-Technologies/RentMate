# Testing Guide

## Commands

```bash
npm test                  # all unit and API tests (vitest)
npm test -w apps/api      # API only
npm test -w apps/web      # web only
npm run test:hooks        # Claude Code guard hooks: 21 allow/block cases
npm run check             # format, lint, typecheck, test, build (what CI runs)
```

Run one test: `cd apps/api && npx vitest run test/matching.test.ts -t "scores 100"`.

## What is covered

- `apps/api/test/matching.test.ts`: age-fit rules, scoring, case-insensitive interests, ranking order and limits.
- `apps/api/test/app.test.ts`: health, 401 without or with bad tokens, 503 when auth is unconfigured, 18+ rejection, profile → matches flow, 404, config validation.
- `apps/web/src/api.test.ts`: API URL handling and health-check states.
- `scripts/test-hooks.mjs`: every guard rule, both allowed and blocked.

API tests inject a fake token verifier and the in-memory store, so they need no network or Supabase account.

## Not yet covered

- RLS policies against a real Postgres. Recommended: `supabase start` locally and pgTAP tests in `supabase/tests/`.
- Signed-in browser flows (profile, likes, chat). `npm run test:e2e` covers the signed-out app only; signed-in flows need a disposable Supabase project.

## Self-repair loop

When a test fails, Claude follows `/test`: reproduce alone, read the diff, fix the root cause, rerun, at most 3 attempts, then report. Tests are only changed when the test itself is wrong.
