---
name: debug
description: Systematically debug an error, failing request, or crash using real logs and output.
---

# /debug

1. Collect the exact error: stack trace, failing command output, or HTTP status and body.
2. Reproduce it with the smallest command or test you can.
3. Form one hypothesis, check it by reading the code path, and confirm with a targeted test.
4. Fix the root cause. Add a regression test.
5. Run `npm run check` to confirm nothing else broke.
6. Report: cause, fix, test added, verification output.
