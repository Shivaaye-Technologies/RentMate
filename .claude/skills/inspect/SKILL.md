---
name: inspect
description: Inspect the repository and report architecture, health, and risks. Use at the start of any task or when asked to assess the project.
---

# /inspect

Produce a short project assessment before changing anything.

1. `git status` and `git log --oneline -10` to see current state.
2. Read `CLAUDE.md`, root `package.json`, and each `apps/*/package.json`.
3. List `apps/api/src`, `apps/web/src`, and `supabase/migrations`.
4. Check `.env.example` for required variables (never open `.env`).
5. Run `npm run check` and record the real results.
6. Report: architecture summary, what passes, what fails (with the exact error), risks, and a prioritized next-steps list.

Do not edit files during /inspect.
