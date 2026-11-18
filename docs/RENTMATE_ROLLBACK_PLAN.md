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
| `20261101090000_live_foundation`         | SQL below (drops live tables and functions; core dating tables are untouched)                                           |
| Future wallet/booking migrations         | Each ships with its own rollback SQL in its PR; ledgers are exported before any drop                                    |

Restore from backup only if data was damaged: Supabase dashboard → Backups → restore (founder action; restores the
whole database to that point).

## Feature-level kill switches

- Live: `admin_set_emergency_stop(true)` ends all live activity immediately.
- Providers: set `integration_status = 'disabled'`.
- Financial flags stay `false` (no rollback needed).

## Live foundation rollback SQL

Run only with founder approval, after a backup. Removes every object created by `20261101090000_live_foundation`.

Tested 2026-11-18 on a local PGlite copy of all migrations: live tables and `live_*`/`admin_*` functions went to 0, the 7
core dating tables remained, and `supabase/tests/rls_flow.sql` still passed 53/53 afterwards.

```sql
begin;
-- functions first (wrappers and private helpers)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'private.broadcast_problems',
      'private.country_codes_ok',
      'private.has_role',
      'private.is_explicit',
      'private.live_report_priority',
      'private.log_action',
      'private.require_role',
      'private.verified',
      'private.verified_country',
      'private.watch_problems',
      'public.admin_decide_appeal',
      'public.admin_list_appeals',
      'public.admin_list_creators',
      'public.admin_list_providers',
      'public.admin_list_reports',
      'public.admin_list_streams',
      'public.admin_list_tickets',
      'public.admin_moderation_log',
      'public.admin_record_verification',
      'public.admin_record_viewer_age',
      'public.admin_reply_ticket',
      'public.admin_resolve_report',
      'public.admin_review_creator',
      'public.admin_set_agreement',
      'public.admin_set_country_policy',
      'public.admin_set_emergency_stop',
      'public.admin_set_revenue_share',
      'public.admin_set_role',
      'public.admin_upsert_provider',
      'public.live_accept_agreement',
      'public.live_answer_session',
      'public.live_broadcast_check',
      'public.live_end_session',
      'public.live_end_stream',
      'public.live_give_consent',
      'public.live_list_streams',
      'public.live_revoke_consent',
      'public.live_room_for',
      'public.live_session_check',
      'public.live_session_room',
      'public.live_start_stream',
      'public.live_terminate_session',
      'public.live_terminate_stream',
      'public.live_watch_check',
      'public.my_live_roles'
    )
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;
-- tables (reverse creation order)
drop table if exists public.creator_appeals, public.creator_tickets, public.live_reports, public.private_sessions, public.creator_availability, public.performer_consents, public.live_streams, public.viewer_age_checks, public.creator_verifications, public.creators, public.creator_agreements, public.live_providers, public.country_policies, public.content_categories, public.live_settings, public.moderation_actions, private.user_roles cascade;
commit;
```
