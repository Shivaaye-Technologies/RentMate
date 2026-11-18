---
name: build
description: Build the API and web app and fix build errors. Use when asked to build or when a build fails.
---

# /build

1. Run `npm run typecheck`, then `npm run build`.
2. On failure, read the first error, open the file and line it names, and fix the root cause.
3. Re-run the failing command. Max 3 repair attempts, then stop and report.
4. Report which packages built and the output sizes Vite printed.
