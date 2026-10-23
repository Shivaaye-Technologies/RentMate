# Deployment Guide

Target: Supabase (database, auth, photo storage) + Render (API and static web), both on free tiers.

## Current production

| Piece    | Where                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| Website  | `soulmate-web` static site → https://soulmate-web.onrender.com                  |
| API      | `soulmate-api` web service (Singapore) → https://soulmate-api-zhyl.onrender.com |
| Database | Supabase project `soulmate-ai` (Mumbai, `ap-south-1`)                           |

Both Render services auto-deploy on every push to `main`. They were created through the Render API,
not the Blueprint flow, so Render does **not** read `render.yaml` for them. Treat `render.yaml` as the
reference configuration and mirror changes in the dashboard:

- `soulmate-api` → Settings → **Health Check Path** = `/health` (not set on the live service yet; without it
  Render only checks that the port is open). `/health` answers 200 whenever the process runs and does
  not call Supabase, so a database hiccup will not trigger restarts.
- `soulmate-web` → Redirects/Rewrites → rewrite `/*` → `/index.html` (only needed once the app uses URL paths; today it has none, and the legal pages are separate static files)

## 1. Supabase

### Migrations

Files in `supabase/migrations/` are named with the **exact version recorded in the database**
(`supabase_migrations.schema_migrations`), so the Supabase CLI and the live project agree.

- Applying through the Supabase MCP tool or dashboard records a new timestamp. After applying, run
  `list_migrations` (or `select version, name from supabase_migrations.schema_migrations`) and name the
  file `<that version>_<name>.sql`.
- Applying with the CLI: `supabase link --project-ref <ref>` then `supabase db push` (review the diff first).
- Never edit a migration that has been applied. Never run `supabase db reset` against production.

### Database permission tests

Run `supabase/tests/rls_flow.sql` in the SQL editor after every schema change. It always rolls back.
Every result line must start with `ok`.

### Auth settings (dashboard → Authentication)

- **URL Configuration:** Site URL `https://soulmate-web.onrender.com`; Redirect URLs `https://soulmate-web.onrender.com/**`
- **Sign In / Providers → Email:** "Confirm email" off for testing; on for launch with custom SMTP configured.
- **Leaked password protection:** enable when your plan allows it.

### Moderation

Reports from users land in the `reports` table (dashboard → Table Editor → `reports`). To act on one:

- Ban a user: Authentication → Users → the user → **Ban user**, or delete them.
- Grant the verified badge after checking someone: `update public.profiles set verified = true where id = '<user id>';`
  (users cannot set this themselves).

## 2. GitHub

Protect `main`: Settings → Branches → add a rule requiring a pull request and the `CI / check` status.

## 3. Render environment variables

- `soulmate-api`: `NODE_ENV=production`, `NODE_VERSION=22`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key), `CORS_ORIGINS` (every website address, comma-separated: currently `https://soulmate-web.onrender.com` and `https://soulmate-ai-eta.vercel.app`); optional `TRUST_PROXY` (proxy hops, defaults to 1 in production so rate limits apply per visitor)
- `soulmate-web`: `NODE_VERSION=22`, `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key)

Build commands use `npm ci --include=dev` because `NODE_ENV=production` would otherwise skip TypeScript and Vite.

## 4. Verify

```bash
curl https://soulmate-api-zhyl.onrender.com/health
# {"status":"ok","service":"soulmate-api","authConfigured":true}
```

Open the website: the sign-in screen should load. Free Render services sleep after about 15 minutes of
inactivity, so the first request can take up to a minute.

## Release flow

feature branch → PR → CI green → `/deploy-check` → merge to `main` → Render deploys → `/health` check.

For schema changes that remove access the running app still uses, split them: ship an additive migration
first, deploy the code that no longer needs the old access, then apply the restricting migration.

## Rollback

- **App:** Render dashboard → service → Deploys → pick the last good deploy → Rollback. Or `git revert <sha>` and merge.
- **Database:** migrations are forward-only. Write a new migration that reverses the change. Take a backup
  (Database → Backups) before any risky migration.

## Production approvals

These need the owner's go-ahead: merging to `main`, applying migrations, changing production env vars, and any deletion of data.
