# Changelog

All notable changes to SOULMATE.AI are recorded here. The `/release` skill updates this file.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semver.

## [Unreleased]

### Fixed

- Restored the project's directory structure and hidden configuration files (`.claude/`, `.github/`, `.gitignore`, `.mcp.json`, Prettier config, workspace `package.json` files) after a flattened upload.

## [0.1.0] - 2026-10-23

### Added

- Express/TypeScript API with Supabase JWT auth, zod validation, and interest-based matching.
- React/Vite web app with an API health check.
- Supabase schema: profiles, likes, matches, messages, blocks, with RLS on every table.
- Claude Code automation: CLAUDE.md, 8 skills, 7 subagents, guard and formatting hooks, MCP config.
- GitHub Actions CI and a Render blueprint.
