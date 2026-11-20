# RentMate — Database Design

Supabase Postgres 17, project `soulmate-ai` (ref `hguaridlbtszqeyplhpm`, ap-south-1). Status date: 2026-11-18.

Rules: migrations are append-only and additive; RLS on every table; clients get column-level grants only;
privileged writes go through `SECURITY DEFINER` functions in `private` with `public` wrappers; never reset or
overwrite production; back up before any approved migration.

## Existing schema (reused, not duplicated)

| Spec domain          | Existing object                                                    | Applied to production? |
| -------------------- | ------------------------------------------------------------------ | ---------------------- |
| users                | `auth.users` (Supabase)                                            | yes                    |
| profiles, photos     | `public.profiles` (+ photos, details columns in PR #9)             | base yes / PR #9 no    |
| likes, matches       | `public.likes`, `public.matches` (trigger creates match on mutual) | yes                    |
| passes               | `public.passes`                                                    | yes                    |
| messages, read state | `public.messages`, `public.match_reads`                            | yes / PR #9 no         |
| blocks               | `public.blocks`                                                    | yes                    |
| moderation_reports   | `public.reports`, `public.live_reports`                            | yes / no               |
| admin_roles          | `private.user_roles` (admin, moderator)                            | no (live migration)    |
| admin_audit_logs     | `public.moderation_actions` (append-only, no client grants)        | no                     |
| creator_profiles     | `public.creators`, `creator_verifications`, `creator_agreements`   | no                     |
| live_streams         | `public.live_streams`, `performer_consents`                        | no                     |
| private calls        | `public.private_sessions` (video/audio)                            | no                     |
| availability         | `public.creator_availability`                                      | no                     |
| consent_records      | `performer_consents` (live); general consent table planned         | no                     |
| geography policy     | `public.country_policies`, `live_settings` (emergency stop)        | no                     |

## Planned additions (next migrations, in order)

### M1 — RBAC and audit (`2026112xxxxxxx_rentmate_rbac.sql`)

- Extend `private.user_roles.role` check to `super_admin`, `master_admin`, `sub_admin`, `agent` (keep `admin`,
  `moderator` as aliases mapped to `master_admin`/`agent` during transition).
- `private.role_rank(role)`; `private.has_role(min_role)` compares rank. Only `super_admin` can grant `master_admin`;
  nobody can grant a role at or above their own; last `super_admin` cannot be removed.
- `public.admin_audit_log` view over `moderation_actions` with actor, target, action, details, `created_at`.
- MFA: privileged functions require `auth.jwt() ->> 'aal' = 'aal2'` (Supabase MFA). Fails closed.

### M2 — Token wallet (`..._rentmate_wallet.sql`)

```sql
create table public.token_wallets (
  user_id uuid primary key references auth.users on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table public.token_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null check (reason in ('registration_bonus','like','message','voice_call','video_call','gift_sent','gift_received','admin_adjustment','refund')),
  ref_type text, ref_id text,
  idempotency_key text not null unique,
  actor uuid,                         -- admin for adjustments
  created_at timestamptz not null default now()
);
```

- Clients: `select` own rows only; no insert/update/delete grants. All changes via `private.ledger_post(user, delta,
reason, ref, idempotency_key)` which locks the wallet row (`for update`), rejects negative results, and returns the
  existing row when the idempotency key repeats (replay-safe).
- `public.metering_rates` (singleton config): bonus 100, voice 10/min, video 1/sec, free likes 50, free messages 10.
- Flags table `public.financial_flags`: `deposits`, `withdrawals`, `transfers`, `redemption`, `payouts`,
  `settlement` — all `false`, check constraint forbids `true` until a migration that cites approval F-10 changes it.
- Separate ledgers: `booking_ledger`, `platform_revenue`, `companion_payable`, `payment_records`, `refunds` — created
  empty with RLS deny-all until F-10/F-11.

### M3 — Calls and metering

- `call_sessions` (id, room, mode video|audio, caller, callee, status, created_at, ended_at).
- `call_segments` (session, participant, joined_at, left_at, source = 'livekit_webhook') — written only by the API's
  webhook handler through a definer function after verifying the LiveKit webhook signature.
- Billable seconds = overlap where **both** participants are connected; charged per segment close with idempotency key
  `call:<session>:<segment>`; call refused at join if balance < one minute; disconnect at zero balance.

### M4 — Marketplace and bookings

- `companion_listings` (owner, title, description, category, city, service_area, public_meeting_only = true check,
  price_tokens, status draft|pending|approved|suspended, approved_by).
- `listing_categories` seeded with the permitted list (coffee, dining, movies, public events, sports, gaming,
  sightseeing, social gatherings, friendship, public entertainment); no free-text category.
- `bookings` (listing, member, companion, `slot tstzrange`, tz text, status in REQUESTED, PENDING_PAYMENT, HELD,
  CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, EXPIRED, DISPUTED, REFUNDED; `hold_expires_at`; idempotency_key unique).
- `exclude using gist (companion_id with =, slot with &&) where (status in ('HELD','CONFIRMED','IN_PROGRESS'))` —
  needs `btree_gist`.
- Reschedule = insert new HELD row, then cancel old in one transaction (new slot reserved first).
- `pg_cron` job (or API cron) expires holds; `booking_events` audit trail; `safety_checkins`; `reviews` (only after
  COMPLETED, one per side); `disputes`.
- Venue: public place name + area only; no residential address column exists.

### M5 — Experiences

- `experiences` (type ONLINE|PHYSICAL|HYBRID, category, host, starts_at, duration, price config, capacity,
  cancellation policy, safety requirements) with `experience_stages` linking a live/call stage and a booking stage,
  each with its own consent record.

## Backups and rollback

Before any approved production migration: Supabase dashboard backup (or `pg_dump` of affected schemas) and a written
rollback SQL in `docs/RENTMATE_ROLLBACK_PLAN.md`. Every migration is tested locally with `npm run test:db` (PGlite)
including RLS tests before review.
