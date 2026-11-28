-- Rollback for 20261127100000_explicit_api_role_grants.sql. NOT a migration.
-- Removes the explicit grants again, which returns a current Supabase project (such as RentMate-staging) to
-- "permission denied for table likes". Only use it to undo a bad apply; RLS policies are untouched either way.
-- On an older project whose default privileges had already granted these, this also removes those grants.
revoke select (liker_id, liked_id, is_super, message, created_at) on public.likes from authenticated;
revoke insert (liker_id, liked_id, is_super, message) on public.likes from authenticated;
revoke select (passer_id, passed_id, created_at) on public.passes from authenticated;
revoke insert (passer_id, passed_id) on public.passes from authenticated;
revoke delete on public.passes from authenticated;
revoke select (id, user_a, user_b, created_at, ready_a, ready_b) on public.matches from authenticated;
revoke delete on public.matches from authenticated;
revoke select (id, match_id, sender_id, body, created_at) on public.messages from authenticated;
revoke insert (match_id, sender_id, body) on public.messages from authenticated;
revoke select (blocker_id, blocked_id, created_at) on public.blocks from authenticated;
revoke insert (blocker_id, blocked_id) on public.blocks from authenticated;
revoke delete on public.blocks from authenticated;
revoke select (id, reporter_id, created_at) on public.reports from authenticated;
revoke insert (reporter_id, reported_id, reason, details, booking_id, review_id) on public.reports from authenticated;
