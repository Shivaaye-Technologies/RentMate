-- Safety step A, part 2a: enforce blocks in both directions, reports, unmatch,
-- per-user write rate limits, missing indexes.

alter table public.blocks
  add constraint no_self_block check (blocker_id <> blocked_id);

-- Profiles: the old policy read public.blocks under the caller's RLS, so it could
-- never see blocks made by other people. private.blocked_either checks both ways.
drop policy "profiles readable by signed-in users" on public.profiles;
create policy "profiles readable unless blocked" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or not private.blocked_either(id));

-- Likes: one SELECT policy (own likes, plus likes received from people not blocked).
drop policy "likes select own" on public.likes;
drop policy "likes select received" on public.likes;
create policy "likes select own or received" on public.likes for select to authenticated
  using (
    liker_id = (select auth.uid())
    or (liked_id = (select auth.uid()) and not private.blocked_either(liker_id))
  );
drop policy "likes insert own" on public.likes;
create policy "likes insert own" on public.likes for insert to authenticated
  with check (liker_id = (select auth.uid()) and not private.blocked_either(liked_id));

-- Matches: hidden from both people once either blocks the other (messages follow,
-- because their policies read matches under RLS). Participants can unmatch.
drop policy "matches select participants" on public.matches;
create policy "matches select participants" on public.matches for select to authenticated
  using (
    (select auth.uid()) in (user_a, user_b)
    and not private.blocked_either(case when user_a = (select auth.uid()) then user_b else user_a end)
  );
drop policy "matches update participants" on public.matches;
create policy "matches update participants" on public.matches for update to authenticated
  using (
    (select auth.uid()) in (user_a, user_b)
    and not private.blocked_either(case when user_a = (select auth.uid()) then user_b else user_a end)
  )
  with check ((select auth.uid()) in (user_a, user_b));
grant delete on public.matches to authenticated;
create policy "matches delete participants" on public.matches for delete to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- Reports: users can file and see their own; moderators read them in the dashboard.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  reported_id uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('fake', 'inappropriate', 'harassment', 'underage', 'scam', 'other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  constraint no_self_report check (reporter_id <> reported_id)
);
alter table public.reports enable row level security;
revoke update, delete on public.reports from anon, authenticated;
create policy "reports insert own" on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and reported_id is not null);
create policy "reports select own" on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- Write rate limits (per user) to stop spam.
create function public.enforce_write_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'messages' and (
    select count(*) from public.messages m
    where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception 'You are sending messages too fast. Please wait a moment.' using errcode = 'P0001';
  elsif tg_table_name = 'likes' and (
    select count(*) from public.likes l
    where l.liker_id = new.liker_id and l.created_at > now() - interval '1 day'
  ) >= 300 then
    raise exception 'Daily like limit reached. Try again tomorrow.' using errcode = 'P0001';
  elsif tg_table_name = 'reports' and (
    select count(*) from public.reports r
    where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'Daily report limit reached.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_write_limits() from public, anon, authenticated;
create trigger messages_write_limit before insert on public.messages
  for each row execute function public.enforce_write_limits();
create trigger likes_write_limit before insert on public.likes
  for each row execute function public.enforce_write_limits();
create trigger reports_write_limit before insert on public.reports
  for each row execute function public.enforce_write_limits();

-- Indexes flagged by the performance advisor, plus reports lookups.
create index messages_sender_idx on public.messages (sender_id);
create index passes_passed_idx on public.passes (passed_id);
create index blocks_blocked_idx on public.blocks (blocked_id);
create index reports_reported_idx on public.reports (reported_id);
create index reports_reporter_idx on public.reports (reporter_id);
