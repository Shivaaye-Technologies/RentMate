# Changelog

All notable changes to SOULMATE.AI are recorded here. The `/release` skill updates this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semver.

## [Unreleased]

### Added

- Dating experience: sign-up/sign-in, profile creation and editing, photo upload (EXIF location stripped, resized), approximate location with distance, Crush card stack (pass, like, Super Like with message, rewind), Discover hub (Likes, New, Verified, Online, mood filters, grid), Likes received, It's a Match screen, chats list, realtime chat with "Your story began on…" and "Ready to meet" flags.
- API: Supabase-backed profile store using the caller's own token (RLS enforced); excludes people already liked or passed; returns photo, verified, online and distance.
- Database: passes, Super Likes (3 per day), likes received visibility, ready-to-meet flags guarded per participant, column grants (users cannot self-verify), coarse (~1 km) location columns, photos storage bucket with per-user folders, realtime for chat.
- `supabase/tests/rls_flow.sql`: 22 permission checks that always roll back.

### Fixed

- Restored the project's directory structure and hidden configuration files (`.claude/`, `.github/`, `.gitignore`, `.mcp.json`, Prettier config, workspace `package.json` files) after a flattened upload.

## [0.1.0] - 2026-10-23

### Added

- Express/TypeScript API with Supabase JWT auth, zod validation, and interest-based matching.
- React/Vite web app with an API health check.
- Supabase schema: profiles, likes, matches, messages, blocks, with RLS on every table.
- Claude Code automation: CLAUDE.md, 8 skills, 7 subagents, guard and formatting hooks, MCP config.
- GitHub Actions CI and a Render blueprint.
