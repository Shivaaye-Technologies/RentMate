# RentMate — LiveKit Implementation (calls, live viewing, broadcasting, guests)

Date: 2026-11-20 · Branch `feature/rentmate-conversion`. Evidence labels: **Tested** (automated, run in this session) ·
**Inspected** (read in code) · **Not verified** (needs real devices, a hosted LiveKit project or production).

Built on the existing LiveKit backend (`apps/api/src/live/`). The token signer, policy checks, provider registry,
emergency stop and moderation were kept. Nothing was replaced; calls, webhooks, room removal and host controls were
added to it.

## 1. What exists now

| Feature                                                                                                                            | State                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| One-to-one voice calls between matched members                                                                                     | Tested                                              |
| One-to-one video calls (local + remote video, camera on/off, switch camera, mute)                                                  | Tested                                              |
| Incoming-call banner on every screen (realtime with a polling fallback)                                                            | Tested                                              |
| Ringing, connecting, connected (duration), reconnecting, ended (reason)                                                            | Tested                                              |
| Decline, cancel, missed after 45 s, one live call per person, 20 call starts per hour                                              | Tested (SQL)                                        |
| Permission-denied help for microphone/camera                                                                                       | Tested                                              |
| Reconnection after a network drop                                                                                                  | Tested                                              |
| Live discovery (`#live`), viewer (`#live/<id>`): video, audio, viewer count, ended state                                           | Tested                                              |
| Broadcast studio (`#broadcast/<id>`): preview, device pickers, go live, end, viewer count                                          | Tested                                              |
| Live chat (screened, 5 per 10 s), reactions (allow-list, 1 per 2 s), hide and mute by hosts                                        | Tested                                              |
| Report and block from the viewer                                                                                                   | Tested                                              |
| Multi-guest: invite (max 4), accept with consent, publish, host mute/allow (persistent, server-enforced), remove, removal on block | Tested                                              |
| Server-side removal of blocked, suspended, unmatched or removed people from rooms                                                  | Tested                                              |
| Signed LiveKit webhooks (join/leave/room finished) as the only presence source                                                     | Tested                                              |
| Server-authoritative call billing (recorded, **not charged**: metering switched off)                                               | Tested (SQL)                                        |
| Recording                                                                                                                          | Not built (no egress, no recording grant)           |
| Large-audience distribution beyond WebRTC (HLS/CDN)                                                                                | Not built; see `RENTMATE_BROADCAST_ARCHITECTURE.md` |

## 2. Architecture

```
Browser (livekit-client 2.23, lazy-loaded) ──wss──▶ LiveKit SFU ──webhook (signed)──▶ RentMate API ──▶ Supabase
        │                                              ▲                                   │
        └──── REST (Supabase JWT) ──▶ RentMate API ─────┘ token (600 s, one room)          └─ RPC (integration secret)
        └──── Supabase (RLS): call_sessions, live_* tables, realtime
```

- **The database decides; the API signs.** Every join first calls one of the database check functions:
  - `call_join_check`, `live_watch_check`, `live_broadcast_check`, `live_session_check` or `live_host_check`.

  They check matching, blocks, suspension, consent, call state, the provider switch and the viewer cap. Only when the
  answer is empty does the API sign a token. Tokens last 600 seconds and name one room. Voice tokens may publish the
  microphone only, viewers cannot publish, data publishing is off, and no recording or room-admin grant is ever issued.

- **Presence comes only from verified webhooks.** `POST /api/v1/live/webhook` is mounted before the JSON parser. It
  checks the signature (HS256 with the API secret), the issuer (the API key), expiry, and the SHA-256 of the exact
  body. Unsigned, tampered, expired or foreign requests get 401. Events are recorded idempotently by event id through
  `live_webhook_ingest`. A joiner the database no longer allows is removed at once.
- **No privileged database key in the API.** The API calls the integration RPCs (`live_webhook_ingest`,
  `live_kicks_claim`, `live_kicks_done`) with the publishable key plus `LIVE_WEBHOOK_DB_SECRET`. The database stores only
  that secret's SHA-256 (`private.integration_secrets`), requires 32 or more characters, and fails closed when it is
  unset.
- **Room removal queue.** Blocking, suspension, unmatching and guest removal enqueue `private.room_kicks`. The API drains
  the queue every 3 seconds (claims are exclusive, so several API instances are safe) and calls LiveKit
  `RemoveParticipant`.
- **The client clock is display only.** Durations on screen come from the browser. Billing uses webhook presence.

## 3. API changes

| Route                                                   | Auth                | Purpose                                                                                                                                                           |
| ------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/calls/:id/join`                           | Member JWT          | Token for a call the database allows                                                                                                                              |
| `POST /api/v1/calls/:id/end`                            | Member JWT          | Hang up in the database, then close the room                                                                                                                      |
| `POST /api/v1/live/webhook`                             | LiveKit signature   | Presence events; 503 until LiveKit and the DB secret are configured                                                                                               |
| `POST /api/v1/live/streams/:id/end`                     | Creator             | End the stream and close the room                                                                                                                                 |
| `POST /api/v1/live/streams/:id/guests/:user/mute`       | Creator / moderator | Body `{kind, muted}`. Mute: stored, live tracks muted, source removed from the guest's LiveKit permission (`UpdateParticipant`). Unmute: permission restored only |
| `POST /api/v1/live/streams/:id/guests/:user/remove`     | Creator / moderator | Remove a guest (`RemoveParticipant`)                                                                                                                              |
| Existing join, stats, terminate, emergency-stop, health | unchanged           | Stream join now refuses when the WebRTC viewer cap is reached (503)                                                                                               |

## 4. Database changes (append-only)

- `20261121090000_calls_and_live_rooms.sql`:
  - tables: `call_sessions`, `private.webhook_events`, `private.room_presence`, `private.room_kicks`,
    `live_chat_messages`, `live_chat_mutes`, `live_reactions`, `live_guest_invites`;
  - `live_settings.max_webrtc_viewers` (default 300);
  - call state machine RPCs, chat/reaction/guest RPCs, `private.call_settle` (billing);
  - BKG-02: accept re-checks blocks, and blocking cancels open bookings between the two people.
- `20261121100000_admin_mfa.sql` and `20261122090000_recovery_codes_and_retention.sql`: see `RENTMATE_ADMIN_MFA.md`
  and `RENTMATE_SECURITY_REMEDIATION.md`.
- `20261123090000_guest_host_mutes.sql` (host mutes) and `20261123100000_integration_secret_strength.sql`
  (integration secret must be a generated token).
- Rollback SQL for each: `docs/rollback/`, rehearsed newest-first by `npm run test:rollback`.

## 5. Host mutes (persistent, server-enforced)

A host or moderator can mute a guest's camera or microphone. Fixed after CI run 44601328482 (see
`RENTMATE_SECURITY_REMEDIATION.md`, RTC-01).

- **The mute is stored** (`live_guest_invites.host_muted_audio/video`, written only by `live_set_guest_mute`, logged).
- **The media server enforces it:**
  - live tracks of that kind are muted (`MutePublishedTrack`);
  - the source is removed from the guest's publish permission (`UpdateParticipant`), so a later publish is refused;
  - every later broadcaster token carries only the allowed sources (`canPublishSources`), so reconnecting does not
    escape a mute; a guest with nothing allowed gets `canPublish: false`.
- **Unmuting gives the permission back.** Nothing is switched on remotely: the guest turns the camera or microphone
  on themselves. The studio tells the guest about each change and refuses "Camera on" or "Unmute" while muted.

## 6. Billing (recorded, not charged)

`private.call_settle` runs once per call, when `room_finished` arrives or the call is hung up.

- **Billable time** is the overlap of both parties' connected time from webhook presence.
- **Price:**
  - voice: started minutes × `voice_tokens_per_minute` (10);
  - video: seconds × `video_tokens_per_second` (1).
- **Recorded on the call:** `billable_seconds`, `tokens_due`, `billing_status`.
- **Charging:** only when `metering_rates.call_metering_enabled` is true (it is **false**). The ledger key `call:<id>`
  makes a redelivered `room_finished` unable to charge twice.

With metering on, starting a call already requires at least one minute's worth of tokens (SQL-tested). Before
switching metering on (founder decision F-08/F-09 plus independent review), decide and build:

- who pays (today: the caller);
- ending the call when the balance runs out mid-call (today: `least(due, balance)` is charged and the rest recorded as
  `insufficient`);
- refunds for calls that fail for technical reasons.

## 7. Environment variables (values never in the repository)

| Variable                 | Where | Purpose                                                                                                                     |
| ------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `LIVEKIT_URL`            | API   | `wss://<project>.livekit.cloud` (or self-hosted)                                                                            |
| `LIVEKIT_API_KEY`        | API   | Key id (public identifier, token issuer)                                                                                    |
| `LIVEKIT_API_SECRET`     | API   | Signing secret as generated by LiveKit (32+ characters, no spaces, 12+ distinct); redacted if the config is ever printed    |
| `LIVE_WEBHOOK_DB_SECRET` | API   | At least 32 random characters; set the same value once with `select private.set_integration_secret('livekit_webhook', '…')` |
| `LIVE_COUNTRY_HEADER`    | API   | Optional trusted country header                                                                                             |

LiveKit project settings: webhook URL `https://<api-host>/api/v1/live/webhook`, signed with the same key.

## 8. Required external services

- LiveKit Cloud (or self-hosted LiveKit with TURN) under founder approval F-06. Without it every join answers 503 and
  the UI says calls and live are not available.
- The provider row `live_providers.livekit` must be enabled by an admin.

## 9. Known limitations

- Not tested on real Android or iOS devices or on mobile networks (see the test report). The automated tests use
  Chromium with fake camera and microphone.
- No TURN server is configured in the test setup. Real networks behind strict NAT need LiveKit Cloud's TURN or your
  own.
- WebRTC audiences are capped at 300 viewers per stream. Larger audiences need HLS (broadcast architecture document).
- No push notifications. An incoming call reaches only people with RentMate open.
- No recording, replay or clips (F-14).
- Calls are only between matched dating members, not member ↔ companion (marketplace) yet.
