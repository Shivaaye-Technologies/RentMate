# Changelog

All notable changes to SOULMATE.AI are recorded here. The `/release` skill updates this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semver.

## [Unreleased]

### Added

- Safety: report (6 reasons, optional block), block, unmatch and delete account in the app; `reports` table; per-user write limits (messages 20/min, likes 300/day, reports 20/day).
- Privacy: other people's coordinates and last-seen times are no longer readable; `discover_profiles` / `profiles_by_ids` return a coarse distance bucket and an online flag; photos bucket made private with signed links.
- Public pages: Privacy Policy, Terms of Use, Dating safety tips, Delete your account.

- Dating experience: sign-up/sign-in, profile creation and editing, photo upload (EXIF location stripped, resized), approximate location with distance, Crush card stack (pass, like, Super Like with message, rewind), Discover hub (Likes, New, Verified, Online, mood filters, grid), Likes received, It's a Match screen, chats list, realtime chat with "Your story began on…" and "Ready to meet" flags.
- API: Supabase-backed profile store using the caller's own token (RLS enforced); excludes people already liked or passed; returns photo, verified, online and distance.
- Database: passes, Super Likes (3 per day), likes received visibility, ready-to-meet flags guarded per participant, column grants (users cannot self-verify), coarse (~1 km) location columns, photos storage bucket with per-user folders, realtime for chat.
- `supabase/tests/rls_flow.sql`: 22 permission checks that always roll back.

### Fixed

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
