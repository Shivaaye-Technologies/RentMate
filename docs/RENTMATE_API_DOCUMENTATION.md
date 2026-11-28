# RentMate — API Documentation

Base URL (production, unchanged): `https://soulmate-api-zhyl.onrender.com`. All `/api/v1/*` routes need
`Authorization: Bearer <Supabase access token>`. Bodies are validated with zod; errors return `{ "error": "..." }`.
`GET /` returns this route list live. Status date: 2026-11-18.

## Implemented

| Method | Path                                  | Auth        | Purpose                                                                                                                                                                                                                                             | Status                |
| ------ | ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| GET    | `/`                                   | none        | Service info (`name: "RentMate API"`) and routes                                                                                                                                                                                                    | TESTED                |
| GET    | `/health`                             | none        | Liveness, 200 while running                                                                                                                                                                                                                         | TESTED, in production |
| PUT    | `/api/v1/profile`                     | member      | Create/update own profile (18+ enforced)                                                                                                                                                                                                            | TESTED, in production |
| GET    | `/api/v1/matches`                     | member      | Ranked discovery list                                                                                                                                                                                                                               | TESTED, in production |
| DELETE | `/api/v1/account`                     | member      | Body `{ "confirm": "DELETE" }`. Removes the caller's photos, then the account (P2-05); safe to repeat. 200 `{ deleted, photosRemoved }`; 400 no confirmation; 502 `{ error, stage }` with nothing deleted beyond removed photos; 503 not configured | TESTED (not deployed) |
| GET    | `/api/v1/live/streams`                | member      | Live and upcoming streams the caller may watch                                                                                                                                                                                                      | TESTED (not deployed) |
| POST   | `/api/v1/live/streams/:id/join`       | member      | 10-minute LiveKit token after policy checks; `{ "as": "viewer"                                                                                                                                                                                      | "broadcaster" }`      | TESTED (not deployed) |
| GET    | `/api/v1/live/streams/:id/stats`      | member      | Viewer count from the provider                                                                                                                                                                                                                      | TESTED (not deployed) |
| POST   | `/api/v1/live/sessions/:id/join`      | participant | Token for an accepted private video/audio session                                                                                                                                                                                                   | TESTED (not deployed) |
| POST   | `/api/v1/live/streams/:id/terminate`  | moderator   | End stream in DB, then close provider room                                                                                                                                                                                                          | TESTED (not deployed) |
| POST   | `/api/v1/live/sessions/:id/terminate` | moderator   | End private session                                                                                                                                                                                                                                 | TESTED (not deployed) |
| POST   | `/api/v1/live/emergency-stop`         | moderator   | Stop all live activity / lift stop                                                                                                                                                                                                                  | TESTED (not deployed) |
| GET    | `/api/v1/live/admin/health`           | moderator   | Per-stream health (broadcaster present, provider reachable, policy)                                                                                                                                                                                 | TESTED (not deployed) |
| GET    | `/api/v1/live/admin/providers`        | admin       | Which providers have server credentials (never the credentials)                                                                                                                                                                                     | TESTED (not deployed) |

Refusals: 401 no/invalid token · 403 not allowed · 404 not found or blocked · 503 provider not configured or
emergency stop. Join responses carry `Cache-Control: no-store`. Join is rate limited to 20/min per user.

Most member data (profiles, likes, messages, creators, consents, tickets) is read and written directly through
Supabase with the member's JWT under RLS; see `RENTMATE_DATABASE_DESIGN.md`.

## Planned

| Method | Path                                | Purpose                                                                                             |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/calls`                     | Start a call invitation (balance pre-check)                                                         |
| POST   | `/api/v1/calls/:id/join`            | Call token (audio-only grant for voice)                                                             |
| POST   | `/api/v1/webhooks/livekit`          | Signed LiveKit events → call segments, metering, stream status (no auth header; signature required) |
| GET    | `/api/v1/wallet`                    | Balance and recent ledger (read model; writes only via server functions)                            |
| POST   | `/api/v1/bookings/:id/hold`         | Idempotent hold (`Idempotency-Key` header)                                                          |
| POST   | `/api/v1/bookings/:id/confirm`      | Confirm (payment step disabled until F-10)                                                          |
| GET    | `/api/v1/bookings/:id/calendar.ics` | Calendar export                                                                                     |
