---
name: deploy-check
description: Verify the project is ready to deploy to Render and Supabase. Use before merging to main or deploying.
---

# /deploy-check

1. `npm run check && npm run test:hooks` must pass.
2. Confirm `render.yaml` matches the build/start commands in package.json.
3. Confirm every variable in `.env.example` is either set in Render (ask the user, or list via the Render MCP if connected) or intentionally optional.
4. List migrations not yet applied (Supabase MCP `list_migrations`, read-only) and flag any destructive statements.
5. After a deploy, call `GET <api-url>/health` and report the real response.
6. Never trigger a deploy or apply a migration yourself; list the exact steps for the user to approve.
