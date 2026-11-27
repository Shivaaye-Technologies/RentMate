-- Rollback for 20261127100000_explicit_api_role_grants.sql. NOT a migration.
-- Removes the explicit grants again, which returns a current Supabase project (such as RentMate-staging) to
-- "permission denied for table likes". Only use it to undo a bad apply; RLS policies are untouched either way.
-- On an older project whose default privileges had already granted these, this also removes those grants.
revoke select, insert on public.likes from authenticated;
revoke select, insert, delete on public.passes from authenticated;
revoke select, delete on public.matches from authenticated;
revoke select, insert on public.messages from authenticated;
revoke select, insert, delete on public.blocks from authenticated;
revoke select on public.reports from authenticated;
revoke insert (reporter_id, reported_id, reason, details, booking_id, review_id) on public.reports from authenticated;
revoke select on public.booking_completion_confirmations from authenticated;
revoke select on public.creator_booking_earnings from authenticated;
