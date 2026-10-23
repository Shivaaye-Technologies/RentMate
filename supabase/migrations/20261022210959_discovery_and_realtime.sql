-- Discovery and chat support.
-- 1. passes: people a user skipped, so they are not shown again.
-- 2. profiles.updated_at stays current on every update.
-- 3. messages and matches publish realtime events (RLS still applies to subscribers).

create table public.passes (
  passer_id uuid not null references public.profiles (id) on delete cascade,
  passed_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (passer_id, passed_id),
  constraint no_self_pass check (passer_id <> passed_id)
);

alter table public.passes enable row level security;

create policy "passes insert own" on public.passes for insert to authenticated
  with check (passer_id = (select auth.uid()));
create policy "passes select own" on public.passes for select to authenticated
  using (passer_id = (select auth.uid()));

create index matches_user_b_idx on public.matches (user_b);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

alter publication supabase_realtime add table public.messages, public.matches;
