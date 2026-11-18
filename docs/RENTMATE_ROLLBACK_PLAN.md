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
| `20261119090000_marketplace`             | SQL below (tested)                                                                                                      |
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

## Marketplace rollback SQL

Tested 2026-11-18 on a local PGlite copy of all migrations: the 16 marketplace tables, 36 functions and the two report
columns were removed, and `rls_flow.sql` (53/53), `policy_audit.sql` (36/36) and `no_adult_content.sql` (16/16) still
passed afterwards. Booking, review and conversation data is lost — export it first.

```sql
-- Marketplace rollback (founder approval + backup first). Removes everything 20261119090000_marketplace added
-- and restores what it changed. Booking, review and message data is lost: export it before running.
begin;
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'private.booking_log',
      'private.booking_price',
      'private.check_service_category',
      'private.check_timezone',
      'private.companion_visible',
      'private.conversation_message_written',
      'private.conversation_peer',
      'private.is_suspended',
      'private.looks_like_address',
      'private.notify',
      'private.require_member',
      'public.admin_decide_account_appeal',
      'public.admin_lift_suspension',
      'public.admin_list_account_appeals',
      'public.admin_list_bookings',
      'public.admin_list_companions',
      'public.admin_list_reviews',
      'public.admin_marketplace_stats',
      'public.admin_resolve_dispute',
      'public.admin_review_companion',
      'public.admin_set_commission',
      'public.admin_set_review_status',
      'public.admin_suspend_account',
      'public.appeal_suspension',
      'public.booking_cancel',
      'public.booking_complete',
      'public.booking_dispute',
      'public.booking_request',
      'public.booking_respond',
      'public.companion_earnings',
      'public.companion_rating',
      'public.companion_set_paused',
      'public.companions_search',
      'public.conversation_mark_read',
      'public.conversation_open',
      'public.review_create'
    )
  loop
    execute 'drop function ' || r.sig || ' cascade';
  end loop;
end $$;
alter table public.reports drop column if exists booking_id;
alter table public.reports drop column if exists review_id;
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in (
  'fake', 'inappropriate', 'harassment', 'underage', 'scam', 'other', 'sexual_content', 'sexual_solicitation'));
drop table if exists public.transactions, public.subscription_plans, public.reviews, public.conversation_messages, public.conversations, public.notifications, public.booking_events, public.bookings, public.shortlists, public.companion_availability, public.companion_services, public.companion_profiles, public.account_appeals, public.account_suspensions, public.platform_settings, public.activity_categories cascade;
-- private.reject_prohibited_text keeps working for the original tables (the extra table names are unused).
commit;
```
