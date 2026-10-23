# Database security tests

`rls_flow.sql` simulates five users (profiles, location privacy, discovery, likes, Super Likes,
matches, chat, rate limits, ready-to-meet, rewind, photos, reports, blocks, unmatch, account
deletion and anonymous access) and checks every
permission rule. It runs inside one `DO` block that always ends by raising
`ROLLED BACK. RESULTS: ...`, so nothing is saved, even on production.

Run it in the Supabase SQL editor (or the Supabase MCP `execute_sql` tool).
Every line of the result must start with `ok`; any `FAIL` is a security bug.
