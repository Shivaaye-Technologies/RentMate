# RentMate — Master Architecture

Status date: 2026-11-18 · Branch: `rentmate-migration` · Owner approval required before anything reaches `main` or production.

RentMate is the evolution of SOULMATE.AI, not a rewrite. Every working feature is preserved; new modules are added
alongside them on the same accounts, database and hosting.

## 1. What exists today (audited)

| Layer    | Technology                                                                                       | Notes                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Web      | React 18 + Vite + TypeScript (`apps/web`)                                                        | Single-page app. Hash routes: `#demo`, `#creator`, `#admin`. Static legal pages in `public/`.                        |
| API      | Node 20 / Express / TypeScript (`apps/api`)                                                      | helmet, rate limiting, zod validation, Supabase JWT auth that fails closed (503). App factory with injected stores.  |
| Database | Supabase Postgres 17, project `soulmate-ai` (ap-south-1)                                         | RLS on every table, column grants, `private` schema for SECURITY DEFINER helpers, append-only migrations.            |
| Auth     | Supabase Auth, email + password with email confirmation and password reset                       | No phone OTP yet.                                                                                                    |
| Realtime | Supabase Realtime (messages, likes)                                                              |                                                                                                                      |
| Live     | LiveKit adapter (`apps/api/src/live`), provider-independent `StreamingProvider` interface        | Server signs 10-minute room tokens; secrets only in server env. Policy decided in the database (`live_*` functions). |
| Hosting  | Render: `soulmate-web` (static) and `soulmate-api` (Node). Vercel preview project for PR builds. | HostyCare/cPanel: no access from this session, not audited.                                                          |
| CI       | GitHub Actions: format, lint, typecheck, unit tests, build, hook guards, DB tests (PGlite), e2e. | GitHub account currently **suspended** (see Blockers).                                                               |

Production database on 2026-11-18: 12 migrations applied, public tables report 0 rows, RLS enabled on all.
Not applied yet (waiting for owner approval): `20261024090000_profile_details` (PR #9) and `20261101090000_live_foundation`.

## 2. Target architecture

```
                         ┌─────────────────────── RentMate web (React, Render static) ───────────────────────┐
                         │ Landing · Auth · Dating · Social · Live · Calls · Marketplace · Bookings · Wallet · Admin │
                         └───────────────┬───────────────────────────────────────────────┬───────────────────┘
                                         │ supabase-js (RLS, user JWT)                     │ HTTPS (user JWT)
                                         ▼                                                 ▼
┌───────────── Supabase Postgres ─────────────┐                     ┌──────────── RentMate API (Express, Render) ────────────┐
│ profiles · likes · matches · messages       │◄── caller's JWT ────│ /live/*   room tokens, terminate, health                 │
│ live_* (policy, creators, streams, consent) │                     │ /calls/*  call tokens, metering (planned)                │
│ experiences · listings · bookings (planned) │                     │ /webhooks/livekit (signed, planned)                      │
│ token_ledger · booking_ledger (planned)     │◄── service fn ──────│ /bookings/* holds, confirm (planned)                     │
│ admin roles · audit log                     │   (SECURITY DEFINER) │ Secrets: LIVEKIT_*, SUPABASE service key (server only)   │
└─────────────────────────────────────────────┘                     └───────────────────────────┬───────────────────────────┘
                                                                                                 │ server SDK / Twirp
                                                                                                 ▼
                                                                                       LiveKit Cloud (SFU, TURN)
```

### Principles

1. **One identity.** Supabase Auth user = one member for dating, social, live, calls, marketplace and admin.
2. **Database decides, API executes.** Eligibility (age, verification, country policy, roles, limits, balances) lives in
   Postgres functions and RLS so no client can skip it. The API only adds what needs a secret (LiveKit tokens, webhooks).
3. **Money-shaped data is a ledger.** Tokens and bookings are append-only ledger rows written only by
   `SECURITY DEFINER` functions, with idempotency keys and `CHECK (balance >= 0)`. Clients never write balances.
4. **Online and physical safety stay separate.** A shared `experiences` model holds type, time and price, but online
   room authorisation (live policy, tokens) and physical safety (public venues, check-in/out, no home addresses) are
   separate code paths and tables.
5. **Financial conversion is off by construction.** No deposit, withdrawal, transfer, redemption or payout code path
   exists until `FOUNDER_APPROVALS.md` records the approvals; the configuration flags default to disabled.
6. **Fail closed.** Unknown country, missing provider, missing verification or missing config → refuse.

## 3. Module map

| Module                 | Where it lives                                                                  | Builds on                          |
| ---------------------- | ------------------------------------------------------------------------------- | ---------------------------------- |
| A Auth & onboarding    | Supabase Auth, `AuthScreen`, `Onboarding`                                       | existing                           |
| B Profiles             | `profiles` (+ PR #9 details), `ProfileDashboard`                                | existing                           |
| C Dating & matching    | `likes`, `matches`, `passes`, `matching.ts`, Crush/Discover/Likes               | existing                           |
| D Social               | `messages`, `match_reads`; planned `follows`, `communities`, `posts`, `events`  | existing chat                      |
| E Physical marketplace | planned `companion_listings`, `listing_categories`, `availability_slots`        | creator verification pattern       |
| F Experience engine    | planned `experiences` (ONLINE / PHYSICAL / HYBRID) + `experience_stages`        | live_streams, private_sessions     |
| G Booking & calendar   | planned `bookings`, `booking_events`, exclusion constraint on time ranges       | creator_availability               |
| H Live streaming       | `live_*` tables and functions, `apps/api/src/live`, CreatorStudio, AdminConsole | done (1–3 of 4); viewer UI pending |
| I Voice & video calls  | `private_sessions` + planned `call_sessions`, `call_segments`; LiveKit webhooks | live adapter                       |
| J Token wallet         | planned `token_wallets`, `token_ledger`, `metering_rates`                       | new                                |
| K Live discovery       | `live_list_streams`, planned follows/recommendations                            | live                               |
| L Admin & moderation   | `private.user_roles`, `moderation_actions`, AdminConsole; planned 5-level RBAC  | live admin                         |

## 4. Key decisions

| #   | Decision                                                                                    | Reason                                                                                                      |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D1  | Base RentMate on the Soulmate-AI monorepo; the RentMate starter repo is empty (README only) | Nothing in the starter repo to reuse; Soulmate has auth, dating, chat, safety, live and tests.              |
| D2  | `rentmate-migration` = `main` + PR #9 + SOULMATE LIVE 1–3                                   | Preserves all unmerged, tested work in one branch instead of rebuilding it.                                 |
| D3  | Keep service id `soulmate-api`, Render service names and Supabase project                   | Renaming infrastructure risks downtime; user-facing name is RentMate.                                       |
| D4  | Brand via `brand.ts` + design tokens; legacy token names aliased                            | Rename once; every existing screen adopts the light/dark system without rewrites.                           |
| D5  | Calls bill from LiveKit server webhooks (participant joined/left), never client timers      | Spec: charge only verified connected time.                                                                  |
| D6  | Bookings use `tstzrange` + `EXCLUDE USING gist` on confirmed/held rows                      | Database-level guarantee against double booking, incl. concurrent requests.                                 |
| D7  | Explicit/adult live category stays off everywhere until the founder decides (see approvals) | RentMate rules forbid sexual services; mixing adult streams with paid in-person companionship is high risk. |
| D8  | Phone OTP via Supabase Auth phone provider + an SMS vendor                                  | Reuses the one auth system; needs an SMS account (cost → founder approval).                                 |

## 5. Hosting

- Render stays primary: static web + Node API, auto-deploy from `main` (so `main` stays untouched until approval).
- LiveKit Cloud for SFU/TURN (free tier for development; production plan needs approval).
- HostyCare/cPanel: not audited (no access). cPanel usually suits the static legal/marketing pages; the API needs
  long-running Node and WebSockets are not needed on our side (LiveKit and Supabase Realtime handle them). Confirm the
  Node version and SSL support before using it for anything beyond static files.
