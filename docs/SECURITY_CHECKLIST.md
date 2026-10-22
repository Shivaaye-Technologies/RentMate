# Security Checklist

Run `/security-audit` before each release, then confirm each item.

## Secrets

- [ ] No `.env` files committed (CI checks this)
- [ ] Only the anon/publishable Supabase key is used; the service-role key is never in this repo or the browser
- [ ] Render secrets entered in the dashboard (`sync: false`), not in `render.yaml`
- [ ] MCP tokens live in shell environment variables, not in `.mcp.json`

## Authentication and authorization

- [ ] Every `/api/v1` route uses `requireAuth`
- [ ] Auth fails closed (503) when unconfigured
- [ ] Every table has RLS enabled with policies scoped to `auth.uid()`
- [ ] Security-definer functions set `search_path = ''`

## Input and abuse

- [ ] All request bodies validated with zod
- [ ] 18+ enforced in API validation and the database check constraint
- [ ] Rate limiting on `/api/v1`; JSON body limit 100 kb
- [ ] helmet headers and a CORS allowlist (no `*`)

## Dating-app privacy

- [ ] Blocked users cannot see the blocker's profile (RLS policy)
- [ ] Messages readable only by the two match participants
- [ ] No exact location stored or exposed (add only coarse location if needed)
- [ ] Photo uploads, when added, go through moderation and strip EXIF location data
- [ ] Report and block flows available before public launch
- [ ] Privacy policy and account-deletion flow before Play Store submission

## Dependencies and CI

- [ ] `npm audit --omit=dev --audit-level=high` passes (CI runs it)
- [ ] `main` is branch-protected and requires the CI check
- [ ] Hook guard tests pass (`npm run test:hooks`)
