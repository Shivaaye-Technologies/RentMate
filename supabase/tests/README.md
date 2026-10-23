# Database security tests

`npm run test:db` runs these automatically (also part of `npm test` and CI): it applies every
migration to a throwaway in-memory Postgres ([PGlite](https://pglite.dev)) with small stand-ins
for Supabase's `auth` and `storage` (`supabase_stubs.sql`), seeds the demo profiles twice, runs
both test files, and checks that `demo_cleanup.sql` removes only demo profiles. No real database
is touched.

- `rls_flow.sql` simulates five users (profiles, location privacy, discovery, likes, Super Likes,
  matches, chat, rate limits, ready-to-meet, rewind, photos, reports, blocks, unmatch, account
  deletion and anonymous access) and checks every permission rule.
- `demo_isolation.sql` checks that ordinary users never see, read, look up or like demo
  profiles, cannot make themselves testers, and that testers see all demo profiles, get liked
  back and receive auto-replies (which stop after 10).

Each runs inside one `DO` block that always ends by raising `ROLLED BACK. RESULTS: ...`, so
nothing is saved. You can also run them in the Supabase SQL editor against the real project
(`demo_isolation.sql` expects the demo seed to be present). Every result must start with `ok`;
any `FAIL` is a security bug.
