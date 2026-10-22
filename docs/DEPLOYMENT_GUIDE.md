# Deployment Guide

Target: Supabase (database and auth) + Render (API and static web), both on free tiers.

## 1. Supabase

1. Create a project at supabase.com. Pick the Mumbai region (`ap-south-1`) for users in India.
2. Apply the schema. Either paste `supabase/migrations/20261023000000_init.sql` into the SQL editor, or:
   ```bash
   supabase link --project-ref <ref>
   supabase db push      # review the diff it shows before confirming
   ```
3. Copy the project URL and anon (publishable) key from Project Settings → API.
4. Run the Security and Performance advisors in the dashboard and fix any findings.

## 2. GitHub

Push the repo, then protect `main`: Settings → Branches → require a pull request and the `CI / check` status.

## 3. Render

1. New → Blueprint → select the repo. Render reads `render.yaml` and creates `soulmate-api` and `soulmate-web`.
2. Enter the secret values when prompted:
   - `soulmate-api`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGINS` (the web URL, for example `https://soulmate-web.onrender.com`)
   - `soulmate-web`: `VITE_API_URL` (the API URL, for example `https://soulmate-api.onrender.com`)
3. Deploy. Both services auto-deploy on every merge to `main` after that.

## 4. Verify

```bash
curl https://<api-url>/health
# {"status":"ok","service":"soulmate-api","authConfigured":true}
```

Open the web URL; it should show "API: online". Free Render services sleep after inactivity, so the first request can take up to a minute.

## Release flow

feature branch → PR → CI green → `/deploy-check` → human merges → Render deploys → `/health` check.

## Rollback

- **App:** Render dashboard → service → Deploys → pick the last good deploy → Rollback. Or `git revert <sha>` and merge.
- **Database:** migrations are forward-only. Write a new migration that reverses the change. Take a backup (Database → Backups) before any risky migration. Never run `supabase db reset` against production.

## Production approvals

These always need a human: merging to `main`, applying migrations, changing production env vars, and any deletion of data.
