# Changelog

All notable changes to SOULMATE.AI are recorded here. The `/release` skill updates this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semver.

## [Unreleased]

### Added

- Landing page links to Privacy, Terms, Dating safety and Delete your account, and states the terms at sign-up; tests for the public landing and public pages.
- Demo profiles for testing: 100 fictional profiles (50/50, ages 18–45, illustrated portraits, unique bios) visible only to tester accounts, with like-back and auto-reply so matching and chat can be tested; repeatable seed, tester grant and cleanup scripts; "Demo" label in the app (`docs/DEMO_PROFILES.md`).
- `npm run test:db`: applies all migrations to a throwaway local Postgres (PGlite) and runs the SQL permission tests, the demo isolation test and the cleanup check; part of `npm test` and CI.
- API: `GET /` returns service name, version and the documented routes (no configuration values); `GET /health` sends `Cache-Control: no-store`; tests for both, for `HEAD /health`, documented routes and `PORT` handling.
- Safety: report (6 reasons, optional block), block, unmatch and delete account in the app; `reports` table; per-user write limits (messages 20/min, likes 300/day, reports 20/day).
- Privacy: other people's coordinates and last-seen times are no longer readable; `discover_profiles` / `profiles_by_ids` return a coarse distance bucket and an online flag; photos bucket made private with signed links.
- Public pages: Privacy Policy, Terms of Use, Dating safety tips, Delete your account.

- Dating experience: sign-up/sign-in, profile creation and editing, photo upload (EXIF location stripped, resized), approximate location with distance, Crush card stack (pass, like, Super Like with message, rewind), Discover hub (Likes, New, Verified, Online, mood filters, grid), Likes received, It's a Match screen, chats list, realtime chat with "Your story began on…" and "Ready to meet" flags.
- API: Supabase-backed profile store using the caller's own token (RLS enforced); excludes people already liked or passed; returns photo, verified, online and distance.
- Database: passes, Super Likes (3 per day), likes received visibility, ready-to-meet flags guarded per participant, column grants (users cannot self-verify), coarse (~1 km) location columns, photos storage bucket with per-user folders, realtime for chat.
- `supabase/tests/rls_flow.sql`: 22 permission checks that always roll back.

### Fixed

- **Discover was empty for some members.** The ranking hid anyone with a compatibility score of 0 (no shared interests and a different goal), so in a small community people who fit each other's age ranges never appeared. Everyone who fits both age ranges is now shown; the score only orders them. Empty Discover now explains why (nobody new, everyone outside your age range with a shortcut to change it, or all caught up), and errors say what happened with a retry (or "Sign in again" when the session expired).
- **"Online" never worked:** the heartbeat used `void supabase.from(...).update(...)`, which never sends a request; it is now awaited and failures are logged.
- **Rate limiting shared one bucket for everyone** behind Render's proxy (`trust proxy` was off); now per visitor (`TRUST_PROXY`, default 1 in production).
- A failed match lookup in chat and network failures during sign-in are shown instead of ignored.
- `rls_flow.sql` expected 20 chat messages where the rate-limit block's rollback leaves 1; the expectation is corrected (the check itself is unchanged).
- Write-limit trigger made likes and reports fail for about 25 minutes after it was applied; fixed by checking each table in its own branch (`20261023103442_fix_write_limits_per_table`).
- Blocks are now enforced in both directions; the previous profile policy could not see blocks made by other people.
- Migration files renamed to the versions recorded in the database, so the Supabase CLI and production agree.
- Removed the unused `POST /api/v1/messages` placeholder.
- Upgraded vitest 2 → 5, clearing the 6 known vulnerabilities in test tooling.

- Restored the project's directory structure and hidden configuration files (`.claude/`, `.github/`, `.gitignore`, `.mcp.json`, Prettier config, workspace `package.json` files) after a flattened upload.

## [0.1.0] - 2026-10-23

### Added

- Express/TypeScript API with Supabase JWT auth, zod validation, and interest-based matching.
- React/Vite web app with an API health check.
- Supabase schema: profiles, likes, matches, messages, blocks, with RLS on every table.
- Claude Code automation: CLAUDE.md, 8 skills, 7 subagents, guard and formatting hooks, MCP config.
- GitHub Actions CI and a Render blueprint.
