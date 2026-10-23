-- Trigger functions should not be callable through the REST API (/rest/v1/rpc).
-- Flagged by Supabase security advisors 0028 and 0029. Triggers keep working:
-- EXECUTE is checked when the trigger is created, not when it fires.
revoke execute on function public.create_match_on_mutual_like() from public, anon, authenticated;
