# SOULMATE LIVE — architecture and compliance controls

Status: foundation only (database, policy, provider adapter, API). Nothing is live until the owner applies
the migration, records a provider's approved terms and sets the server credentials.

This document describes technical controls. It is not legal advice: have a lawyer confirm the policy for
every country before enabling it, and keep the written opinion referenced in `country_policies`.

## Components

```
Browser ──(Supabase JWT)──▶ API /api/v1/live/* ──▶ Postgres functions (policy, RLS, audit log)
   │                              │
   │◀── short-lived room token ───┘──▶ Streaming provider adapter ──▶ LiveKit (WebRTC SFU)
   └──────────── WebRTC media (token only, no secrets) ─────────────▶
```

- **Database decides.** `live_broadcast_check`, `live_watch_check` and `live_session_check` return every
  reason someone may not broadcast, watch or join. The API issues a provider token only when the list is
  empty. Status changes (going live, termination, approval, verification) happen only in role-checked
  `SECURITY DEFINER` functions; users cannot write those columns.
- **Provider adapter** (`apps/api/src/live/providers.ts`): `issueToken`, `closeRoom`, `roomStats`.
  `LiveKitProvider` uses LiveKit's documented JWT grants and RoomService API. `MemoryProvider` is for tests.
  New providers implement the same interface and register in `buildRegistry`.
- **Secrets** live only in server environment variables (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).
  `live_providers.credential_env` stores only the variable name. The admin endpoint reports whether
  credentials are present, never their values. Browsers receive a room URL and a token that expires in
  10 minutes.
- **Country** comes from a header set by a trusted CDN (`LIVE_COUNTRY_HEADER`, e.g. Cloudflare's
  `cf-ipcountry`). Without it every viewer's country is unknown, and unknown fails closed.

## Policy rules enforced in the database

| Rule                                                                                               | Where                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| No policy row for a country = nothing allowed there                                                | `country_policies`, `watch_problems`, `broadcast_problems`      |
| Explicit content can never be enabled for India                                                    | `no_explicit_in_india` constraint + creator and viewer checks   |
| Explicit content elsewhere needs a recorded written legal clearance                                | `explicit_needs_clearance` constraint                           |
| A provider is enabled only with signed, reviewed terms that authorise commercial use               | `enabled_needs_signed_terms`                                    |
| Creators need passed identity **and** age checks before approval and before every broadcast        | `admin_review_creator`, `broadcast_problems`                    |
| Creators accept the active creator agreement                                                       | `live_accept_agreement`, `broadcast_problems`                   |
| Every co-performer is an approved, verified creator who recorded their own consent for that stream | `performer_consents`, `live_give_consent`, `broadcast_problems` |
| Explicit viewers need a passed age check, a known country that allows it, and are never in India   | `viewer_age_checks`, `watch_problems`                           |
| Blocks apply to live streams and private sessions                                                  | `watch_problems`, `live_session_check`                          |
| Reports about minors, consent, trafficking, leaked content or violence are urgent                  | `live_report_priority` trigger                                  |
| Emergency stop ends live streams and active sessions and refuses all joins                         | `admin_set_emergency_stop`                                      |
| Suspension ends a creator's streams and sessions immediately                                       | `admin_review_creator`                                          |
| Every admin/moderator action is logged; the log is append-only                                     | `moderation_actions`, `private.log_action`                      |

Verification results come from a verification provider (its case reference is stored); no ID images or
document numbers are stored by SOULMATE.

## Provider onboarding checklist

1. Get the provider's written terms. Confirm they permit your business model, commercial use, the
   countries you need and, if monetised, monetisation. Unofficial, scraped or unauthorised feeds are never
   integrated.
2. In the provider dashboard (admin, coming in the admin-dashboards PR), record the contract reference,
   mark the terms reviewed, choose countries and permitted categories. Status `testing` needs at least a
   contract under negotiation; `enabled` needs `signed` and the authorisation boxes.
3. Set the credentials as Render environment variables on `soulmate-api` (never in the web app):
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Set `LIVE_COUNTRY_HEADER` once a CDN provides it.

## First admin (one-off, owner only)

Run in the Supabase SQL editor after the migration is applied, with your own user id:

```sql
insert into private.user_roles (user_id, role) values ('<your auth user id>', 'admin');
```

Further admins and moderators are granted from the app (`admin_set_role`), which is logged.

## Rolling back the foundation

Before any creator data exists, the foundation can be removed in one transaction: drop the functions
created by `20261101090000_live_foundation.sql`, then the tables `creator_appeals`, `creator_tickets`,
`live_reports`, `private_sessions`, `creator_availability`, `performer_consents`, `live_streams`,
`viewer_age_checks`, `creator_verifications`, `creators`, `creator_agreements`, `live_providers`,
`country_policies`, `content_categories`, `live_settings`, `moderation_actions` and `private.user_roles`.
Once creators, consents or reports exist, export them first: they may be records you must keep.
