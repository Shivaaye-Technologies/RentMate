---
name: security-audit
description: Audit the code, schema, and config for security problems. Use before releases or when touching auth, RLS, or user data.
---

# /security-audit

Delegate to the `security-reviewer` subagent, or check directly:

- Secrets: `git grep -nE "(sk_|eyJ|service_role|PRIVATE KEY)"` must return nothing real. `.env*` (except `.env.example`) is gitignored.
- Auth: every `/api/v1` route goes through `requireAuth`; unconfigured auth returns 503.
- Input: every request body is parsed with zod; 18+ age rule intact.
- Database: every table in `supabase/migrations` has RLS enabled and policies scoped to `auth.uid()`. Security-definer functions set `search_path = ''`.
- Dependencies: `npm audit --omit=dev` and report high/critical issues.
- Headers and limits: helmet, CORS allowlist, rate limiting, JSON body limit present.

Report findings by severity with file:line and a concrete fix. Do not apply risky fixes without approval.
