# RentMate — Source-to-Target Migration Report

Date: 2026-11-18 · Branch: `feature/rentmate-conversion` in `rentmate970-hue/RentMate`

## 1. Repository audit

### Target: `rentmate970-hue/RentMate`

| Item                          | Finding                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Branches                      | `main` only                                                                                               |
| Commits                       | 1 — `b34bf5b Initial commit` (2026-11-18 16:00 IST, rentmate970-hue)                                      |
| Files                         | `README.md` only ("RentMate New Concept")                                                                 |
| Source code / database / docs | None                                                                                                      |
| Deployment configuration      | None (no Render blueprint, no CI, no environment files)                                                   |
| Access from this session      | **Read only** (public repo). Claude has no write access: pushing needs the owner to grant it (section 7). |

### Source: `souravsingh80000-design/soulmate-ai`

| Item       | Finding                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access     | **Blocked on GitHub**: the owner account is suspended (API: "Your account was suspended"). Used from the complete local copy and the verified bundle (head `9075f5b`, 53 commits).                            |
| Stack      | Node ≥20 npm workspaces, TypeScript 5.7, ESLint 9, Prettier 3, Vitest, PGlite 0.5.11; API Express 4.21.2, supabase-js, zod 4.6.7, helmet 8, cors, express-rate-limit 7; web React 18.3.1, Vite 6, supabase-js |
| Database   | Supabase Postgres 17 (`soulmate-ai`, ap-south-1). Production: 12 migrations, RLS on every table. Repo: 16 migrations (4 unapplied)                                                                            |
| Auth       | Supabase Auth, email + password with confirmation and reset; API verifies JWT and fails closed                                                                                                                |
| Tests      | API 79, web 146, 8 DB suites (225 checks), hook guards 21, aihub 32, policy guard 52 self-tests, browser smoke — all green (run 2026-11-18 in the target branch before any change)                            |
| Deployment | `render.yaml`: `soulmate-api` (Node, `/health`) and `soulmate-web` (static), auto-deploy from the **source** repo's `main`; Vercel previews; HostyCare not audited (no access)                                |

The source history was brought into the target with `git merge --allow-unrelated-histories`, so every commit and
author is preserved and the original Soulmate-AI repository is untouched.

## 2. Reusable modules (kept as they are)

Authentication (email, confirmation, reset, 18+), onboarding, profile management and photos (private bucket, size/type
limits), blocking, reporting (incl. sexual content and solicitation), safety introduction, account deletion,
notifications (in-app), presence, demo mode (fictional, isolated), the live-streaming foundation (roles, audit log,
moderation), the RentMate brand and light/dark design system, the no-adult-content policy and text screening, the
repository policy guard, CI, hooks and documentation.

## 3. Modules requiring modification

| Module         | Change                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Roles          | Add "companion" as a capability (approved companion profile), alongside member; admin/moderator reused     |
| Messaging      | Dating chat stays tied to mutual matches; marketplace needs member↔companion conversations without a match |
| Reporting      | Reports can reference a booking or review                                                                  |
| Admin console  | Add companion verification, bookings, disputes, reviews, member suspension, commission, analytics          |
| Text screening | Extend to companion profiles, services, conversations and reviews                                          |
| Navigation     | Add marketplace areas (find companions, bookings, companion dashboard) next to the dating tabs             |

Dating tables are **not renamed or repurposed**; the marketplace gets its own normalized tables.

## 4. New modules

Companion profiles, activity categories (allow-list, non-sexual), companion services and pricing, weekly
availability, booking engine (REQUESTED → PENDING → ACCEPTED / REJECTED / CANCELLED → COMPLETED / DISPUTED, overlap
prevention in the database, server-side price), booking events (audit), shortlists, marketplace conversations and
messages, reviews (completed bookings only, one each), notifications for bookings, member suspensions, platform
settings (commission), financial records and plans (recorded only; payments disabled), admin marketplace functions
and analytics.

## 5. Existing security problems (carried over, see `RENTMATE_POLICY_AUDIT.md`)

- GitHub owner account suspended (source unreachable); target not yet writable by Claude.
- Supabase Auth Site URL still `localhost`; built-in email sender rate-limited (F-17).
- No automated image moderation for photos (F-18); no member suspension (F-19, addressed in this conversion).
- Evidence retention after account deletion (F-20); dashboard SQL access governance (F-21).
- Supabase default table grants give `anon`/`authenticated` broad privileges on older tables (RLS still governs rows;
  TRUNCATE is not reachable through the API). Recommend revoking unused privileges in a reviewed migration.

## 6. Database and deployment requirements

- All marketplace changes are new, additive migrations; nothing is dropped or rewritten. They need `btree_gist`
  (available on Supabase, not installed yet) for booking overlap prevention.
- Apply order after backup and approval: `20261024090000`, `20261101090000`, `20261118090000`, `20261118100000`, then
  the marketplace migrations.
- Render: the existing services deploy from the source repository; pointing them (or new services) at
  `rentmate970-hue/RentMate` is a founder decision. No production change is made by this work.

## 7. Publishing

Pushing `feature/rentmate-conversion` needs the owner of `rentmate970-hue` to install the Claude GitHub App on that
repository (github.com/apps/claude/installations/select_target) or reconnect GitHub at
claude.ai/customize/connectors. GitHub allows one free personal account per person; if `rentmate970-hue` and
`souravsingh80000-design` belong to the same person, resolve that with GitHub Support first (an organization under
one account is the compliant set-up).
