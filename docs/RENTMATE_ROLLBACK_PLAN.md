# RentMate — Rollback Plan

## Application (web/API)

- Render → service → Deploys → "Rollback" to the previous successful deploy (both `soulmate-web` and `soulmate-api`).
- Or revert the release merge commit on `main` with a PR (founder approves); Render redeploys.
- Branding is purely front-end; rolling back the web service restores SOULMATE.AI branding with no data impact.

## Database

Migrations are additive. Rollback = a new forward migration, never editing applied files.

| Migration                                | Rollback                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `20261024090000_profile_details` (PR #9) | Drop added columns/tables listed in `docs/MIGRATION_20261024_PROFILE_DETAILS.md` (data in them is lost — back up first) |
| `20261101090000_live_foundation`         | `docs/LIVE_ARCHITECTURE.md` → Rollback section (drop live tables/functions; core dating unaffected)                     |
| Future wallet/booking migrations         | Each ships with its own rollback SQL in its PR; ledgers are exported before any drop                                    |

Restore from backup only if data was damaged: Supabase dashboard → Backups → restore (founder action; restores the
whole database to that point).

## Feature-level kill switches

- Live: `admin_set_emergency_stop(true)` ends all live activity immediately.
- Providers: set `integration_status = 'disabled'`.
- Financial flags stay `false` (no rollback needed).
