# Database security tests

`rls_flow.sql` simulates five users (profiles, likes, Super Likes, matches, chat,
ready-to-meet, rewind, photo storage, anonymous access) and checks every
permission rule. It runs inside one `DO` block that always ends by raising
`ROLLED BACK. RESULTS: ...`, so nothing is saved, even on production.

Run it in the Supabase SQL editor (or the Supabase MCP `execute_sql` tool).
Every line of the result must start with `ok`; any `FAIL` is a security bug.
