# RentMate

**Meet. Connect. Experience.** RentMate is an 18+ platform for dating, friendship and **non-sexual** paid social
companionship (coffee, dining, events, sightseeing and similar public activities).

RentMate is not an escort or sexual-services marketplace. Pornography, sexually explicit content, sexual services,
escorting and sexual solicitation are not supported anywhere and are blocked in the database.

This repository continues the SOULMATE.AI codebase (full history kept). It is an npm workspace: Express API
(`apps/api`), React web app (`apps/web`), Supabase schema and tests (`supabase/`).

## Quick start

```bash
npm ci
cp .env.example .env      # fill in your Supabase URL and anon key (never commit .env)
npm run dev:api           # http://localhost:4000/health
npm run dev:web           # http://localhost:5173
npm run check             # policy guard, format, lint, typecheck, unit + DB tests, build
```

## Docs

- [Source-to-target migration report](docs/RENTMATE_SOURCE_TARGET_REPORT.md)
- [Master architecture](docs/RENTMATE_MASTER_ARCHITECTURE.md) · [Feature matrix](docs/RENTMATE_FEATURE_MATRIX.md)
- [Database design](docs/RENTMATE_DATABASE_DESIGN.md) · [API](docs/RENTMATE_API_DOCUMENTATION.md)
- [Security review](docs/RENTMATE_SECURITY_REVIEW.md) · [Policy audit](docs/RENTMATE_POLICY_AUDIT.md)
- [Deployment guide](docs/RENTMATE_DEPLOYMENT_GUIDE.md) · [Rollback plan](docs/RENTMATE_ROLLBACK_PLAN.md)
- [Founder approvals](docs/FOUNDER_APPROVALS.md) · [GitHub compliance](docs/GITHUB_COMPLIANCE.md)
- [Development guide](docs/DEVELOPMENT_GUIDE.md) · [Testing guide](docs/TESTING_GUIDE.md)
