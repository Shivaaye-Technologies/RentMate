---
name: release
description: Prepare a release: version bump, changelog, and PR to main. Requires human approval to merge.
---

# /release

1. Run /deploy-check. Stop if anything fails.
2. Summarize commits since the last tag (`git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD`).
3. Bump `version` in the root package.json (semver: feat → minor, fix → patch).
4. Update `CHANGELOG.md`.
5. Commit on a `release/vX.Y.Z` branch and open a PR to `main` with the changelog in the body.
6. Do not merge, tag, or deploy. The user approves and merges.
