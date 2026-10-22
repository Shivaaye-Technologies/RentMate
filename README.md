# SOULMATE.AI

Dating app with profiles, interest-based matching, mutual likes, and chat.
Built as an npm workspace: Express API (`apps/api`), React web app (`apps/web`), Supabase schema (`supabase/`).

The repo includes a Claude Code automation layer: project instructions, skills, subagents, safety hooks, MCP config, and CI.

## Quick start

```bash
npm ci
cp .env.example .env      # fill in your Supabase URL and anon key
npm run dev:api           # http://localhost:4000/health
npm run dev:web           # http://localhost:5173
npm run check             # format, lint, typecheck, test, build
```

## Docs

- [Automation setup](docs/AUTOMATION_SETUP.md)
- [Development guide](docs/DEVELOPMENT_GUIDE.md)
- [Testing guide](docs/TESTING_GUIDE.md)
- [Deployment guide](docs/DEPLOYMENT_GUIDE.md)
- [Security checklist](docs/SECURITY_CHECKLIST.md)
