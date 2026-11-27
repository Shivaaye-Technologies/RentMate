-- Explicit privileges for the signed-in role on the core social tables.
--
-- Why: these tables were created by early migrations that relied on Supabase's old default privileges ("grant all
-- on new tables to anon, authenticated"). Current Supabase projects no longer apply that default to objects created
-- by migrations: RentMate-staging (created 2026-11-20) gives anon and authenticated no table privileges, so the app
-- got "permission denied for table likes" (and matches, messages, passes, blocks, reports) before RLS was evaluated.
--
-- What: grant ONLY the commands for which an RLS policy already exists for `authenticated`. RLS still decides which
-- rows each person can see or write; nothing here widens row access, and anon gets nothing.
--   likes     select (own or received), insert (own; hidden-demo and suspension restrictions still apply)
--   passes    select, insert, delete (own)
--   matches   select, delete (participants); update stays limited to (ready_a, ready_b); inserts come from the
--             mutual-like trigger, not from clients
--   messages  select, insert (participants; suspension restriction still applies)
--   blocks    select, insert, delete (own)
--   reports   select (own); insert of the reporter's own columns only
--   booking_completion_confirmations, creator_booking_earnings: select (participants / own), as their policies say
-- Idempotent: on projects that still grant by default these statements change nothing.

grant select, insert on public.likes to authenticated;
grant select, insert, delete on public.passes to authenticated;
grant select, delete on public.matches to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select on public.reports to authenticated;
grant insert (reporter_id, reported_id, reason, details, booking_id, review_id) on public.reports to authenticated;
grant select on public.booking_completion_confirmations to authenticated;
grant select on public.creator_booking_earnings to authenticated;
