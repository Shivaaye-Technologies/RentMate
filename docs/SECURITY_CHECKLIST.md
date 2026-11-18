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

## Dating-app safety and privacy

- [ ] Blocks hide both people from each other everywhere (profiles, likes, matches, messages, photos)
- [ ] Report, block, unmatch and delete-account work in the app (Google Play requirement)
- [ ] Other people's coordinates and last-seen times are not readable (only distance buckets and online flag)
- [ ] Photos bucket is private; photos load through signed links
- [ ] Per-user write limits on messages (20/min), likes (300/day), reports (20/day)
- [ ] Reports are reviewed regularly (Table Editor → `reports`)

- [ ] Messages readable only by the two match participants
- [ ] Location is rounded to ~1 km on the device before it is saved
- [ ] Photo uploads strip EXIF location data (moderation still to add)
- [ ] Privacy policy, terms and deletion page reviewed and a support email added before Play Store submission

## Dependencies and CI

- [ ] `npm audit --omit=dev --audit-level=high` passes (CI runs it)
- [ ] `main` is branch-protected and requires the CI check
- [ ] Hook guard tests pass (`npm run test:hooks`)
- [ ] `supabase/tests/rls_flow.sql` passes (every line starts with `ok`)
