# RentMate — Feature Matrix and Gap Analysis

Status date: 2026-11-18 · Branch `rentmate-migration` · Statuses: NOT STARTED · IN PROGRESS · BLOCKED · IMPLEMENTED ·
TESTED · READY FOR REVIEW · APPROVED · DEPLOYED.

"TESTED" means automated tests ran and passed in this session. Nothing on this branch is DEPLOYED.
Features already on production `main` are marked "(in production)".

## Summary

| Module                      | Status                         | What exists                                                                                                                  | Main gaps                                                                              |
| --------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Brand & design system       | TESTED                         | RentMate name, tagline, RM monogram, light + dark monochrome themes with switch, landing pillars                             | Marketing pages (About, How it works, Contact), app icons for stores                   |
| A Auth & onboarding         | IN PROGRESS                    | Email signup + confirmation, sign-in, password reset, 18+ check, onboarding wizard, account deletion                         | Phone OTP, member ID verification, device/session list, suspicious-login alerts        |
| B Profiles                  | TESTED (PR #9 not merged)      | Photos, bio, interests, prompts, details, city, visibility, approximate distance only                                        | Languages, verification badges flow, companion listing status                          |
| C Dating & matching         | TESTED (core in production)    | Ranked discovery, likes, Super Likes, passes, mutual-match trigger, unmatch, block/report, filters                           | Like limit is 300/day — spec says 50 free/24h; token-paid likes                        |
| D Social networking         | IN PROGRESS                    | 1:1 chat after match (realtime), read state, in-app notifications                                                            | Typing, media with moderation, follows, communities, groups, feeds, events, reactions  |
| E Physical marketplace      | NOT STARTED                    | —                                                                                                                            | Listings, categories, pricing, service areas, approval, reviews, disputes              |
| F Unified experience engine | NOT STARTED                    | Building blocks: live_streams, private_sessions, creator_availability                                                        | `experiences` model, hybrid stages, shared discovery                                   |
| G Booking & calendar        | NOT STARTED                    | —                                                                                                                            | States, holds, exclusion constraint, reminders, ICS export, disputes                   |
| H Live streaming            | TESTED (migration not applied) | Policy engine, roles, provider adapter (LiveKit), creator portal, admin console, terminate, emergency stop; no adult content | Viewer/broadcaster room UI, live chat, reactions, follows, analytics, gifts, recording |
| I Voice & video calls       | IN PROGRESS (foundation only)  | `private_sessions` (video/audio), server-issued join tokens, termination                                                     | Call UI, invitations, webhook metering, billing, reconnection UX, disputes             |
| J Token wallet              | NOT STARTED                    | —                                                                                                                            | Wallet, ledger, bonus, metering, daily limits, admin controls                          |
| K Live discovery & creators | IN PROGRESS                    | `GET /live/streams`, creator verification and status                                                                         | Live-now feed UI, follows, recommendations, creator channels, analytics                |
| L Admin & moderation        | IN PROGRESS                    | admin/moderator roles, audit log, live admin console, reports, emergency stop                                                | 5 roles (Super/Master/Sub Admin, Agent, User), MFA, user mgmt, ledger, disputes, fraud |

## Gap detail by spec item

### Module A — Authentication

| Item                       | Status      | Note                                                                    |
| -------------------------- | ----------- | ----------------------------------------------------------------------- |
| Phone registration + OTP   | NOT STARTED | Needs SMS provider account (cost) — founder approval F-04               |
| Secure login/logout        | TESTED      | Supabase Auth                                                           |
| Password recovery          | TESTED      | PR #9                                                                   |
| 18+ age gate               | TESTED      | `ProfileInput` + `profiles.age` check constraint                        |
| Identity verification      | IN PROGRESS | Creator verification recorded via provider; member verification planned |
| Terms & privacy consent    | IMPLEMENTED | Text on signup; consent record table planned                            |
| Account deletion           | TESTED      | `delete_my_account` function, public page                               |
| Device/session management  | NOT STARTED |                                                                         |
| Suspicious login detection | NOT STARTED | Needs auth hook or log review                                           |

### Module J — Token rules (from spec)

| Rule                                | Status      | Planned enforcement                                     |
| ----------------------------------- | ----------- | ------------------------------------------------------- |
| 100-token registration bonus        | NOT STARTED | Ledger row on profile creation, idempotent per user     |
| Voice 10 tokens/min                 | NOT STARTED | Webhook-measured seconds, rounded up per started minute |
| Video 1 token/sec                   | NOT STARTED | Webhook-measured seconds                                |
| 50 free likes / rolling 24h         | NOT STARTED | Replace 300/day trigger limit (founder confirms)        |
| 10 free messages / rolling 24h      | NOT STARTED | Trigger on `messages` (founder confirms — strict)       |
| No cash value, transfer, withdrawal | By design   | No code path; flags off                                 |

## Roadmap (dependencies)

```
Phase 0 audit ─► Phase 1 brand (done)
                     │
                     ├─► Phase 2 dating & social: limits, typing, media, follows, communities
                     │        │
                     ├─► Phase 6a wallet ledger + RBAC (5 roles, MFA) ──┐  (needed before any metering or admin money view)
                     │                                                   │
                     ├─► Phase 4 live: rooms UI (PR 4) ─► calls UI ─► webhook metering ◄┘
                     │
                     └─► Phase 3 physical: listings ─► availability ─► bookings (holds, exclusion) ─► check-in/out, reviews, disputes
                                                                              │
                                                     Phase 5 experience engine (ONLINE/PHYSICAL/HYBRID) ◄┘
                                                                              │
                                                              Phase 7 QA, mobile devices, deployment prep
```

Recommended next order: (1) wallet ledger + RBAC schema, (2) live/call room UI with webhook metering,
(3) marketplace + bookings, (4) experience engine, (5) social expansion. Each lands as its own PR into
`rentmate-migration`.
