-- Run set_ready_to_meet with the caller's own permissions instead of elevated
-- ones (Supabase security advisor 0029). RLS, column grants and a guard trigger
-- now enforce that each participant changes only their own flag.

revoke update on public.matches from anon, authenticated;
grant update (ready_a, ready_b) on public.matches to authenticated;

create policy "matches update participants" on public.matches for update to authenticated
  using ((select auth.uid()) in (user_a, user_b))
  with check ((select auth.uid()) in (user_a, user_b));

create function public.guard_ready_flags()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid = old.user_a and new.ready_b is distinct from old.ready_b then
    raise exception 'You can only change your own ready flag' using errcode = '42501';
  end if;
  if uid = old.user_b and new.ready_a is distinct from old.ready_a then
    raise exception 'You can only change your own ready flag' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_ready_flags() from public, anon, authenticated;

create trigger matches_guard_ready_flags
  before update on public.matches
  for each row execute function public.guard_ready_flags();

alter function public.set_ready_to_meet(uuid, boolean) security invoker;
