-- Rollback for 20261126130000_revoke_anon_social_reads.sql. NOT a migration. Restores the default anon SELECT grants
-- (RLS still returns no rows to anon).
grant select on public.blocks, public.likes, public.matches, public.messages, public.passes, public.reports to anon;
