# RentMate — Staging environment plan (`rentmate-staging`)

Date: 2026-11-20 · Branch `feature/rentmate-conversion` · Status: **blocked before creation — founder decisions needed.**
Nothing was created, charged, deployed or changed. Soulmate production (`soulmate-ai`, `soulmate-api`) was only read.

## Blockers

| #   | Blocker                                                                                                                                                                                                                                                                                                                               | Options (founder decision)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Supabase refused to create `rentmate-staging`: the owner account `souravsingh80000-design` has reached the free plan's limit of **2 active projects** (`soulmate-ai`, `TestPilot-AI`; `Shivaaye` and `Hunterexch` are already paused).                                                                                                | **(a)** Pause `TestPilot-AI` (free; its live app stops working until restored). **(b)** Upgrade the "Shivaaye" organization to Pro: $25/month including $10 compute credit; each active project needs compute (Micro $10/month), so with three active projects expect about $45/month plus usage. **(c)** Create the staging project in an organization owned by a different person who has a free slot. I will not pause, upgrade or create accounts without approval. |
| S2  | Render deploys from GitHub. GitHub `feature/rentmate-conversion` is at `1cea99b`; 23 newer commits exist only in the review bundles. At `1cea99b` the API has **no `DELETE /api/v1/account`** and the repo lacks migrations `20261123110000`–`20261123140000` (photo privacy, account-deletion photos, age attestation, enforcement). | Founder pushes the reviewed branch (or a `staging` branch) from Termux. Only then can `rentmate-staging-api` deploy the right code.                                                                                                                                                                                                                                                                                                                                     |
| S3  | No staging LiveKit credentials.                                                                                                                                                                                                                                                                                                       | Without them the API answers 503 for calls and live streams (fails closed). Provide a separate LiveKit project's URL/key/secret to enable calls in staging.                                                                                                                                                                                                                                                                                                             |

## Phase 1 — Backend audit (dependency map)

**Database (28 migrations, apply in this order; all are needed — later ones depend on earlier functions and tables):**

1.  20261022210236_init.sql
2.  20261022210317_revoke_trigger_function_execute.sql
3.  20261022210959_discovery_and_realtime.sql
4.  20261022211449_photos_location_superlikes_meet.sql
5.  20261022211514_ready_to_meet_invoker.sql
6.  20261023095502_safety_private_helpers.sql
7.  20261023101049_safety_policies_reports_limits.sql
8.  20261023101225_safety_profile_functions_delete_account.sql
9.  20261023101930_safety_hide_location_private_photos.sql
10. 20261023103442_fix_write_limits_per_table.sql
11. 20261023121400_demo_profiles_testers.sql
12. 20261023165729_demo_mode_public.sql
13. 20261024090000_profile_details.sql
14. 20261101090000_live_foundation.sql
15. 20261118090000_no_adult_content.sql
16. 20261118100000_policy_hardening.sql
17. 20261119090000_marketplace.sql
18. 20261120090000_audit_hardening.sql
19. 20261120100000_token_wallet.sql
20. 20261121090000_calls_and_live_rooms.sql
21. 20261121100000_admin_mfa.sql
22. 20261122090000_recovery_codes_and_retention.sql
23. 20261123090000_guest_host_mutes.sql
24. 20261123100000_integration_secret_strength.sql
25. 20261123110000_photo_privacy.sql
26. 20261123120000_account_deletion_photos.sql
27. 20261123130000_age_attestation.sql
28. 20261123140000_age_attestation_enforcement.sql

- Extension: `btree_gist` (schema `extensions`), used for booking-overlap exclusion constraints.
- Storage: private bucket `photos` (created and locked down by the migrations; read rule `private.can_view_photo`).
- Realtime publication: `messages`, `call_sessions`, `live_chat_messages`, `live_guest_invites`, `live_reactions`.
- 112 public function definitions (RPCs) across profiles/discovery, likes/matches, chat, safety (block/report), bookings
  and marketplace, wallet (internal tokens only), calls, live streaming, admin (MFA-gated), age attestation.
- Key triggers: mutual-like → match; age attestation on profiles; refuse self-deletion while photos remain;
  prohibited-content checks; payments/payouts disabled by constraints.
- Demo data: `supabase/seed/demo_profiles.sql` (reserved demo accounts only). Optional for staging.

**API (`apps/api`, Express 4):** helmet, CORS allowlist, rate limiting, JSON body limit, `requireAuth` (Supabase JWT,
fails closed with 503 when Supabase is not configured).

| Route                                                                     | Purpose                                                                                 | Needs              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------ |
| `GET /health`, `GET /`                                                    | Health / root                                                                           | —                  |
| `PUT /api/v1/profile`, `GET /api/v1/matches`                              | Profile save (422 `age_attestation_required` when the database refuses), ranked matches | Supabase           |
| `DELETE /api/v1/account`                                                  | Server-side photo removal, then account deletion (member's own session)                 | Supabase           |
| `POST /api/v1/calls/:id/join`, `/end`                                     | LiveKit call token / end                                                                | Supabase + LiveKit |
| `/api/v1/live/...` (streams, sessions, moderation, admin, emergency stop) | Live streaming                                                                          | Supabase + LiveKit |

**API environment:** `NODE_ENV`, `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `CORS_ORIGINS` (web
origins only; the Android app sends no Origin), `TRUST_PROXY` (1 behind Render), optional `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVE_WEBHOOK_DB_SECRET`, `LIVE_COUNTRY_HEADER`.
**The API never uses a Supabase service-role key** — it acts with each member's own token under RLS. Recommendation:
do not give the staging API a service-role secret (unused privileged credentials are pure risk).

**Not implemented yet (known gaps):** push notifications (no backend; proposal only), expanded content filter (P2-01)
and venue categories (P2-02) awaiting approval, Android screens beyond sign-in/declaration/settings, real age
verification provider (self-declaration only).

## Runbook once unblocked (nothing here touches Soulmate production)

1. **Supabase** (after S1): create `rentmate-staging` in `ap-south-1` (Mumbai) on the approved plan.
2. Apply the 28 migrations in order. Preferred: Supabase CLI `supabase link --project-ref <staging ref>` then
   `supabase db push` (keeps the file versions). Applying through the MCP tool works but records new version
   timestamps; then rename nothing — just note it.
3. Verify on staging: `supabase/tests/*.sql` suites (they all roll back), migration list = 28, `photos` bucket private,
   `attest_adult` / `my_age_attestation` present, `require_age_attestation` = false; then run
   `docs/ops/require_age_attestation.enable.sql` on **staging only** (founder already approved enforcement for beta).
4. Staging Auth (dashboard, staging project only): Site URL and Redirect URLs `rentmate://auth/callback`,
   `rentmate://auth/reset`; confirm email on; minimum password length 8 with letters and digits; leaked-password
   protection if the plan allows.
5. **Render** (after S2): new web service `rentmate-staging-api`, **free instance**, region Singapore, repo
   `Shivaaye-Technologies/RentMate`, branch `feature/rentmate-conversion` (or `staging`), build
   `npm ci --include=dev && npm run build -w apps/api`, start `npm start -w apps/api`, health check `/health`, env:
   `NODE_ENV=production`, `NODE_VERSION=22`, `TRUST_PROXY=1`, `SUPABASE_URL` + `SUPABASE_ANON_KEY` (staging,
   publishable), `CORS_ORIGINS` (staging web origin if any). LiveKit vars only after S3.
6. **Android:** `apps/mobile/.env` and EAS `development` variables switched to the staging URL, staging publishable key
   and `rentmate-staging-api` URL (public values only; `.env` stays out of git).
7. **Tests:** database suites on staging, API health and an authenticated smoke test (sign-up → declaration → profile
   → account deletion), refusal cases (no declaration → 422; unauthenticated deletion → 401; under-18 → refused),
   mobile typecheck/tests/native/bundle checks, and a check that the app's configured hosts are the staging ones.
