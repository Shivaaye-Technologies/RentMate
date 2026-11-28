-- Explicit least-privilege grants for authenticated mobile clients.
-- Existing RLS policies remain enabled and continue to restrict row access.
-- No privileges are granted to anon.

-- Likes: clients create likes and read the columns used by the app.
grant select (liker_id, liked_id, is_super, message, created_at)
  on public.likes to authenticated;
grant insert (liker_id, liked_id, is_super, message)
  on public.likes to authenticated;

-- Passes: clients read their own pass records, create passes, and rewind them.
grant select (passer_id, passed_id, created_at)
  on public.passes to authenticated;
grant insert (passer_id, passed_id)
  on public.passes to authenticated;
grant delete on public.passes to authenticated;

-- Matches: created by the mutual-like trigger, never directly by clients.
-- Keep the existing column-restricted UPDATE grant for ready_a / ready_b.
grant select (id, user_a, user_b, created_at, ready_a, ready_b)
  on public.matches to authenticated;
grant delete on public.matches to authenticated;

-- Messages: clients read messages and send messages in permitted matches.
grant select (id, match_id, sender_id, body, created_at)
  on public.messages to authenticated;
grant insert (match_id, sender_id, body)
  on public.messages to authenticated;

-- Blocks: users manage their own block rows under the existing RLS policy.
grant select (blocker_id, blocked_id, created_at)
  on public.blocks to authenticated;
grant insert (blocker_id, blocked_id)
  on public.blocks to authenticated;
grant delete on public.blocks to authenticated;

-- Reports: users can submit reports and read only their own rows under RLS.
-- SELECT(id) also supports INSERT ... RETURNING id.
-- created_at is intentionally not client-writable.
grant select (id, reporter_id, created_at)
  on public.reports to authenticated;
grant insert (reporter_id, reported_id, reason, details, booking_id, review_id)
  on public.reports to authenticated;
