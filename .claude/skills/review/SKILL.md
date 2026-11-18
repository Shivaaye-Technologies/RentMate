---
name: review
description: Review the current branch's changes for correctness, tests, and conventions before a PR.
---

# /review

1. `git diff main...HEAD` (or `git diff` for uncommitted work).
2. Check: logic correctness, missing tests, zod validation on new inputs, RLS for new tables, no secrets, no weakened security, conventions in CLAUDE.md.
3. Run `npm run check`.
4. Output a review: blocking issues, suggestions, and a ready/not-ready verdict.
