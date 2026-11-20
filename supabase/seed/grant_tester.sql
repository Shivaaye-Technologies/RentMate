-- Lets one account see and test the demo profiles.
-- Replace the email, then run in the Supabase SQL Editor as the database owner.
-- The account must already have created its profile in the app.
update public.profiles
set is_tester = true
where id = (select id from auth.users where email = 'replace-with-tester@example.com')
  and not is_demo
returning id, display_name, is_tester;

-- To remove tester access later:
-- update public.profiles set is_tester = false
-- where id = (select id from auth.users where email = 'replace-with-tester@example.com');
