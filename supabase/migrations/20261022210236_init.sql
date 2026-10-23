-- SOULMATE.AI initial schema
-- Every table has Row Level Security enabled. Users can only read and write
-- their own data, plus the limited data needed for matching and chat.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 40),
  age int not null check (age between 18 and 100),
  bio text not null default '' check (char_length(bio) <= 500),
  interests text[] not null default '{}',
  looking_for text not null check (looking_for in ('relationship', 'friendship', 'casual')),
  age_min int not null check (age_min between 18 and 100),
  age_max int not null check (age_max between 18 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint age_range_valid check (age_min <= age_max)
);

create table public.likes (
  liker_id uuid not null references public.profiles (id) on delete cascade,
  liked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker_id, liked_id),
  constraint no_self_like check (liker_id <> liked_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint ordered_pair check (user_a < user_b),
  unique (user_a, user_b)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create index messages_match_created_idx on public.messages (match_id, created_at);
create index likes_liked_idx on public.likes (liked_id);

alter table public.profiles enable row level security;
alter table public.likes enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;

-- Profiles: any signed-in user can view profiles (needed for discovery),
-- except people who blocked them. Only the owner can write.
create policy "profiles readable by signed-in users"
  on public.profiles for select to authenticated
  using (
    not exists (
      select 1 from public.blocks b
      where b.blocker_id = profiles.id and b.blocked_id = (select auth.uid())
    )
  );
create policy "profiles insert own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Likes: you create and see your own likes only.
create policy "likes insert own" on public.likes for insert to authenticated
  with check (liker_id = (select auth.uid()));
create policy "likes select own" on public.likes for select to authenticated
  using (liker_id = (select auth.uid()));

-- Matches: visible to the two participants. Created by the trigger below.
create policy "matches select participants" on public.matches for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- Messages: only match participants can read; sender must be the caller.
create policy "messages select participants" on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.matches m
      where m.id = messages.match_id and (select auth.uid()) in (m.user_a, m.user_b)
    )
  );
create policy "messages insert participants" on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = messages.match_id and (select auth.uid()) in (m.user_a, m.user_b)
    )
  );

-- Blocks: manage your own.
create policy "blocks manage own" on public.blocks for all to authenticated
  using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));

-- Mutual like creates a match.
create function public.create_match_on_mutual_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.likes l
    where l.liker_id = new.liked_id and l.liked_id = new.liker_id
  ) then
    insert into public.matches (user_a, user_b)
    values (least(new.liker_id, new.liked_id), greatest(new.liker_id, new.liked_id))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger likes_create_match
  after insert on public.likes
  for each row execute function public.create_match_on_mutual_like();
