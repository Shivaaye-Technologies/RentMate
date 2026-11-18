-- Removes every demo profile and everything attached to it (likes, matches,
-- messages, passes, blocks, reports cascade from auth.users / profiles).
-- Real accounts are not touched: only rows marked is_demo or using the
-- reserved demo email domain are deleted.
-- Run in the Supabase SQL Editor as the database owner. Requires approval
-- (it deletes data).
begin;

delete from auth.users
where id in (select id from public.profiles where is_demo)
   or email like 'demo-%@demo.soulmate.invalid';

commit;

select count(*) as demo_profiles_left from public.profiles where is_demo;
