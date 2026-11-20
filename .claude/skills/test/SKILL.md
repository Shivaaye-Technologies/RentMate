---
name: test
description: Run the test suites, diagnose failures, and fix them. Use when asked to test or after changing code.
---

# /test

1. Run `npm test` and `npm run test:hooks`.
2. For each failure: reproduce it alone (`npx vitest run <file> -t "<name>"` inside the package), read the assertion diff, find the root cause.
3. Fix the code under test. Only change a test if the test itself is wrong, and say why.
4. Re-run the full suite. Max 3 repair attempts per failure.
5. Report the exact pass/fail counts from the final run.
