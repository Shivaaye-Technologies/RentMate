# Development Guide

## Requirements

- Node.js 20 or newer (CI uses 22)
- npm 10+
- Git
- Optional: Supabase CLI, Claude Code

## Setup

```bash
git clone <your-repo-url> soulmate-ai
cd soulmate-ai
npm ci
cp .env.example .env
```

Fill `.env` with your Supabase project URL and anon (publishable) key. Without them the API still starts, but `/api/v1/*` returns 503 by design.

## Running

```bash
npm run dev:api   # API on :4000 with reload
npm run dev:web   # web on :5173
```

## Layout

```text
apps/api/src
  app.ts         Express app factory (routes, middleware)
  auth.ts        Supabase JWT verification, requireAuth middleware
  config.ts      zod-validated environment config
  matching.ts    pure compatibility scoring and ranking
  store.ts       in-memory ProfileStore (tests only)
  supabaseStore.ts  Supabase ProfileStore (production; calls get_my_profile / discover_profiles
                    with the caller's JWT)
  validation.ts  zod request schemas
apps/web/src     React app and API client
supabase/migrations  SQL schema with RLS
```

## API

| Method | Path              | Auth | Description                    |
| ------ | ----------------- | ---- | ------------------------------ |
| GET    | `/`               | No   | API information and route list |
| GET    | `/health`         | No   | Liveness check (200 while up)  |
| PUT    | `/api/v1/profile` | Yes  | Create or update your profile  |
| GET    | `/api/v1/matches` | Yes  | Ranked matches for you         |

## Adding a feature

1. Branch: `git checkout -b feat/<name>`.
2. Schema change? Add a new migration file; never edit an old one.
3. Add zod validation, logic, route, and tests.
4. `npm run check`.
5. Open a PR. CI must pass before merge.

## Features

Crush cards (pass / like / Super Like / rewind), Discover hub with Likes, New, Verified and Online
filters and mood chips, Likes received, It's a Match, chats with realtime messages and "Ready to meet".
The web app talks to Supabase directly for likes, passes, matches, chat and photos (all protected by
RLS) and to the API for ranked discovery.

Safety: report (6 reasons), block (both people disappear for each other everywhere, chats included),
unmatch, and account deletion from the Profile tab. Static pages `apps/web/public/privacy.html`,
`terms.html`, `safety.html` and `delete-account.html` are served at the site root.

Privacy: other people's coordinates and last-seen times are never sent to the browser. The database
functions `discover_profiles` and `profiles_by_ids` return a coarse distance bucket (1 km, whole km
under 10, then 5 km and 10 km steps) and an online flag. Photos are in a private bucket and load
through one-hour signed links.

Not built on purpose: a live map of other users' positions (stalking risk). Only distances are shown,
from locations rounded to about 1 km on the device and stored at that precision.

## Next steps for the app

- Photo moderation and an in-app admin flow to review reports and grant `verified`.
- Multiple photos per profile.
- Android build (wrap the web app or React Native).
