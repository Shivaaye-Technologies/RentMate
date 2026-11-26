-- Defence in depth: signed-out (anon) sessions get no table privilege on private social data. RLS already returns no
-- rows to anon (every policy is scoped to authenticated users and auth.uid()); this removes the leftover default
-- SELECT grants so a future policy mistake cannot expose them. Append-only.
revoke select on public.blocks, public.likes, public.matches, public.messages, public.passes, public.reports from anon;
