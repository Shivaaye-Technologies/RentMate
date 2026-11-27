# RentMate Android: post-install functional debugging (2026-11-27)

The redesigned APK installed and launched on a Samsung Z Flip4 (Android 16). This file records the screen
failures from the phone recording, their confirmed causes, what changed, and what still needs a founder action.
Nothing in this fix was applied to staging or production, and no RLS policy was changed.

## Root causes

| Symptom                                      | Source                                                                                       | Confirmed cause                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home: "Invalid or expired token"             | **RentMate staging API** (`apps/api/src/auth.ts`, 401). Not Supabase Auth, not an app token. | The phone's Supabase tokens are valid: `/auth/v1/user` and token refresh returned 200 on RentMate-staging. The staging Supabase logs contain no requests from the API server, only from the phone. So the Render staging API checks tokens against a **different Supabase project** (its `SUPABASE_URL` / `SUPABASE_ANON_KEY`).                                            |
| Likes: "permission denied for table likes"   | Postgres privileges on RentMate-staging                                                      | RentMate-staging (created 2026-11-20) uses current Supabase defaults: tables created by migrations get **no** privileges for `anon`/`authenticated`. Early migrations relied on the old "grant all by default", so `likes`, `matches`, `messages`, `passes`, `blocks` and `reports` were refused before RLS ran. The test harness emulated the old defaults, which hid it. |
| Chat: no conversations / spinner             | Same as Likes (`matches`, `messages` 403 in the staging logs)                                | Plus: Supabase calls had no timeout, so a stalled request could spin forever.                                                                                                                                                                                                                                                                                              |
| Booking chats load forever                   | App + staging schema                                                                         | The booking list and booking chat loaders had no `try/catch`. Any thrown error kept the spinner. `booking_messages` does not exist on staging, because staging stops at migration `20261123140000`.                                                                                                                                                                        |
| Discovery empty after Refresh                | Real data plus the API error above                                                           | Staging has **1 profile** (2 auth users). Even with the API fixed, there is nobody else to show. The app now says so honestly.                                                                                                                                                                                                                                             |
| Around you empty                             | Same as Discovery                                                                            | No other profiles. The app's own profile has no shared location.                                                                                                                                                                                                                                                                                                           |
| Vibes: "add hobbies and a city"              | App                                                                                          | Vibes read `city` directly from `profiles`, and `city` is a private column, so the read always failed and the error was swallowed. The staging profile also really has no city and 0 interests.                                                                                                                                                                            |
| Profile / Edit profile / Preferences / tasks | App                                                                                          | `select("*")` and private columns (`show_me`, `city`) are refused by the profile column grants.                                                                                                                                                                                                                                                                            |

## Evidence (RentMate-staging logs, last 24 h; read-only queries)

API edge requests:

| Request                       | Status | Caller         | Count |
| ----------------------------- | ------ | -------------- | ----- |
| `/auth/v1/user`               | 200    | phone (okhttp) | 59    |
| `/auth/v1/token` (refresh)    | 200    | phone          | 2     |
| `/rest/v1/profiles`           | 200    | phone          | 46    |
| `/rest/v1/profiles`           | 403    | phone          | 6     |
| `/rest/v1/likes`              | 403    | phone          | 14    |
| `/rest/v1/matches`            | 403    | phone          | 13    |
| `/rest/v1/rpc/get_my_profile` | 200    | phone          | 2     |

- **No request came from the API server.** A server-side `auth.getUser()` would appear as a Node client.
- **There are no `/rest/v1/messages` calls.** Chat stops at the `matches` 403, before it reads messages.

Postgres log:

| Message                                | Count |
| -------------------------------------- | ----- |
| `permission denied for table likes`    | 14    |
| `permission denied for table matches`  | 13    |
| `permission denied for table passes`   | 7     |
| `permission denied for table profiles` | 6     |

These are SQLSTATE 42501 (insufficient_privilege), raised before RLS runs. An RLS denial returns zero rows or
"new row violates row-level security policy" instead.

Grants on staging (`has_table_privilege` / `has_column_privilege` for `authenticated`):

- None on likes, matches, messages, passes, blocks or reports.
- Profiles: 12 public columns readable. City, show_me, lat/lng and the other private columns are not.

RLS on staging is enabled on all seven tables, and its policies match the tested model:

- likes: "insert own", "select own or received", plus restrictive policies for suspended accounts and hidden demo
  profiles.
- matches and messages: participant-only.

Default ACL for migration-created tables on staging: `anon=m, authenticated=m, service_role=Dxtm` (MAINTAIN only).

Staging data:

- 1 profile and 2 auth users.
- The one profile has a photo and is 18+, but has no city, 0 interests and no shared location.
- 0 likes, 0 matches, 0 blocks, 0 active suspensions.

Staging API:

- `GET /health` returns `{"status":"ok","authConfigured":true}`.
- `/api/v1/matches` with any token Supabase-staging did not issue returns `401 {"error":"Invalid or expired token"}`,
  the exact text on the phone.
- The server's Supabase settings are on Render. Reading them needs a Render workspace selection, which wasn't done.

## Changes

Database (new, append-only; **not applied anywhere**):

- `supabase/migrations/20261127100000_explicit_api_role_grants.sql` grants `authenticated` only the commands that
  already have an RLS policy:
  - likes: select, insert
  - passes: select, insert, delete
  - matches: select, delete
  - messages: select, insert
  - blocks: select, insert, delete
  - reports: select, plus insert on the reporter's columns
  - booking confirmations and earnings: select

  `anon` gets nothing. No UPDATE or DELETE on likes or messages, and no INSERT on matches (the mutual-like trigger
  creates matches). Hidden profile columns stay hidden.

- `docs/rollback/20261127_explicit_api_role_grants.rollback.sql` is its rollback, rehearsed by `npm run test:rollback`.
- `supabase/tests/supabase_stubs.sql` now matches current Supabase defaults (no automatic grants), so a missing
  grant fails the tests.
- `supabase/tests/api_role_grants.sql` is a new regression suite. It checks that every signed-in policy has its
  privilege, that anon has no access, that likes and messages are server-controlled, and runs these flows: like,
  "You liked", "Liked you", match creation, chat, cross-user denial, block, report, pass/undo, and a suspended
  account refused.
- `audit_hardening.sql` and `age_attestation_abuse.sql` accept either refusal mechanism (no privilege, or no rows).

App (`apps/mobile`):

- `src/lib/authedApi.ts`: API calls with the Supabase session.
  - An expired token is refreshed once and the request retried.
  - A revoked refresh token signs the member out, and the app returns to sign-in.
  - If the server rejects a fresh token, the app shows a server error (`AUTH-401`) and keeps the member signed in.
  - A 503 from the server is reported as `AUTH-503`.
  - Errors are never turned into empty lists.
- `src/lib/me.ts`: the member's own row comes from `get_my_profile()`. Used by Profile, Edit profile, the profile
  tasks, Preferences, Vibes and the self view.
- `src/lib/fetchWithTimeout.ts` `boundedFetch`: every Supabase request ends within 30 s (photo uploads 120 s).
- Booking list and booking chat show an error instead of spinning forever. Likes and Chat show friendly errors
  with the database error code.
- Honest empty states:
  - Around you and Vibes no longer show "nobody" when loading failed.
  - Vibes explains whether the feed is empty, which profile details are missing, or that there's no overlap.
- `src/lib/diagnostics.ts` and **Profile → Diagnostics (testing)**: a redacted event log covering session restore,
  auth events, refresh outcomes, API status codes, database permission failures, and feed and chat counts.
  It holds no tokens, keys, emails, messages or coordinates.

API (`apps/api`): `GET /health` now includes `authProject`, the public Supabase project ref the API checks
sign-ins against (never a key). The app expects `wgoscvlghavqepaojeao`.

## Needs the founder (not done)

1. **Render staging API environment:** set `SUPABASE_URL=https://wgoscvlghavqepaojeao.supabase.co` and
   `SUPABASE_ANON_KEY` to RentMate-staging's anon (publishable) key, then redeploy the staging API. Afterwards,
   `GET https://rentmate-staging-api.onrender.com/health` should show `"authProject":"wgoscvlghavqepaojeao"` once
   this branch's API is deployed to staging. This fixes "Invalid or expired token".
2. **Staging migrations:** staging stops at `20261123140000`. Applying the later migrations, including
   `20261127100000_explicit_api_role_grants.sql`, needs your approval (checklist S-1). This fixes Likes, Chat and
   booking chats on staging.
3. **Test profiles:** staging has one profile. To test Discovery, Around you and Vibes, sign up a second real test
   account (18+) with a photo, a city and some hobbies. Don't use invented demo data.

## Device test procedure (Samsung, Android 16)

Install as an update. Don't uninstall the app and don't clear its data (see `docs/ANDROID_APK_SIGNING.md`).

1. Check the signer in App Manager. It should be the EAS key, SHA-256 `60:A1:2F:…:DC:44`.
2. Open the app. You should land signed in, with your session restored. Open **Profile → Diagnostics (testing)**.
   It should show `auth session restored` with `expiresInMin`.
3. **Home.** Before items 1–2 above are done, expect the `AUTH-401` server message, not "Invalid or expired token".
   Diagnostics shows `api 401, refreshing session` → `auth refresh ok` → `server rejected a fresh token`.
   After the Render fix, Home loads, and Diagnostics shows `feed loaded {count: N}`.
4. **Likes.** Before staging migrations, expect "We couldn't load your likes (42501)" and Diagnostics
   `db permission denied {table: likes…}`. After them, the lists load (empty when there are none).
5. **Chat.** Same pattern with `matches`. Booking chats should show an error or an empty list within 30 s, never an
   endless spinner.
6. **Vibes and Around you.** With one profile on staging, expect "Nobody is in your Discover feed right now". Add a
   city and hobbies in Edit profile and check that Vibes stops asking for them.
7. **Sign-out path.** Sign out and back in. A revoked session must return to sign-in, not show empty screens.
8. Screenshot the Diagnostics screen and share it. It's safe: tokens, keys, emails, messages and locations are never
   recorded.
