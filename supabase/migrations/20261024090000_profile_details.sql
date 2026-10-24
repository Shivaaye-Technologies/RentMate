-- Profile details, photos, prompts, places, privacy and read receipts.
--
-- Additive only: new optional columns with safe defaults, one new table, and
-- the discovery functions recreated to return the new public fields. No data
-- is changed or removed. Rollback: docs/MIGRATION_20261024_PROFILE_DETAILS.md.
--
-- Privacy rules kept:
-- * Other people still never read coordinates or last-seen times (column grants
--   unchanged); they get the new fields only through private.people().
-- * show_me, hidden, notify_prefs and the tutorial timestamps are never
--   returned for other people.
-- * Photos must live in the owner's own storage folder (no pointing at
--   someone else's picture).
-- Matching rules are unchanged except that a paused (hidden) profile is left
-- out of other people's Discover. Gender and "show me" are stored only; they
-- do not filter anyone until the owner approves that change.

-- ---------- Validation helpers (immutable, used by check constraints) ----------

-- Every item is a short non-empty string, and there are at most max_items.
create function private.short_texts(items text[], max_items int, max_len int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(items) <= max_items
     and not exists (
       select 1 from unnest(items) t(v)
       where v is null or char_length(btrim(v)) = 0 or char_length(v) > max_len
     );
$$;

-- Up to 3 prompts: [{"q": "...", "a": "..."}], question 1-120 chars, answer 1-200 chars.
create function private.valid_prompts(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 3
     and not exists (
       select 1 from jsonb_array_elements(p) e(v)
       where jsonb_typeof(v) <> 'object'
          or jsonb_typeof(v -> 'q') is distinct from 'string'
          or jsonb_typeof(v -> 'a') is distinct from 'string'
          or char_length(btrim(v ->> 'q')) not between 1 and 120
          or char_length(btrim(v ->> 'a')) not between 1 and 200
          or (select count(*) from jsonb_object_keys(v)) <> 2
     );
$$;

-- Photo paths must be in the owner's folder: "<owner id>/<file>".
create function private.own_photo_paths(owner uuid, paths text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(paths) <= 6
     and not exists (
       select 1 from unnest(paths) t(p)
       where p is null or p not like owner::text || '/%' or char_length(p) > 200 or p like '%..%'
     );
$$;

-- Notification choices: an object of true/false values for known keys only.
create function private.valid_notify_prefs(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e(k, v)
       where k not in ('likes', 'matches', 'messages', 'system') or jsonb_typeof(v) <> 'boolean'
     );
$$;

revoke execute on function private.short_texts(text[], int, int) from public;
revoke execute on function private.valid_prompts(jsonb) from public;
revoke execute on function private.own_photo_paths(uuid, text[]) from public;
revoke execute on function private.valid_notify_prefs(jsonb) from public;
grant execute on function private.short_texts(text[], int, int) to authenticated;
grant execute on function private.valid_prompts(jsonb) to authenticated;
grant execute on function private.own_photo_paths(uuid, text[]) to authenticated;
grant execute on function private.valid_notify_prefs(jsonb) to authenticated;

-- ---------- New profile columns (all optional) ----------

alter table public.profiles
  add column gender text check (gender in ('woman', 'man', 'nonbinary', 'other')),
  add column show_me text check (show_me in ('women', 'men', 'everyone')),
  add column height_cm smallint check (height_cm between 120 and 230),
  add column job text check (char_length(btrim(job)) between 1 and 60),
  add column education text check (
    education in ('secondary', 'diploma', 'undergraduate', 'postgraduate', 'doctorate', 'other')
  ),
  add column exercise text check (exercise in ('often', 'sometimes', 'rarely', 'never')),
  add column smoking text check (smoking in ('never', 'socially', 'regularly', 'quitting')),
  add column children text check (children in ('want', 'dont_want', 'have', 'open', 'not_sure')),
  add column city text check (char_length(btrim(city)) between 2 and 60),
  add column neighbourhoods text[] not null default '{}'
    check (private.short_texts(neighbourhoods, 5, 40)),
  add column favourite_places text[] not null default '{}'
    check (private.short_texts(favourite_places, 10, 60)),
  add column prompts jsonb not null default '[]' check (private.valid_prompts(prompts)),
  add column photos text[] not null default '{}',
  add column hidden boolean not null default false,
  add column notify_prefs jsonb not null default '{"likes": true, "matches": true, "messages": true}'
    check (private.valid_notify_prefs(notify_prefs)),
  add column safety_intro_at timestamptz,
  add column welcome_seen_at timestamptz;

alter table public.profiles
  add constraint photos_own_folder check (private.own_photo_paths(id, photos)),
  -- Existing primary photo: also must be the owner's (demo portraits ship with the site).
  add constraint photo_path_own_folder check (
    photo_path is null or is_demo or photo_path like id::text || '/%'
  ),
  -- Server-side limit matching the app (existing profiles have at most 6).
  add constraint interests_limit check (private.short_texts(interests, 10, 30));

-- Users can write the new columns (still only their own row, by the existing policies).
grant insert (
  gender, show_me, height_cm, job, education, exercise, smoking, children, city,
  neighbourhoods, favourite_places, prompts, photos, hidden, notify_prefs,
  safety_intro_at, welcome_seen_at
) on public.profiles to authenticated;
grant update (
  gender, show_me, height_cm, job, education, exercise, smoking, children, city,
  neighbourhoods, favourite_places, prompts, photos, hidden, notify_prefs,
  safety_intro_at, welcome_seen_at
) on public.profiles to authenticated;

-- ---------- Discovery: new public fields, paused profiles left out ----------

drop function public.discover_profiles(int);
drop function public.profiles_by_ids(uuid[]);
drop function private.people(uuid[], int);

create function private.people(p_ids uuid[], p_limit int)
returns table (
  id uuid,
  display_name text,
  age int,
  bio text,
  interests text[],
  looking_for text,
  age_min int,
  age_max int,
  photo_path text,
  verified boolean,
  created_at timestamptz,
  distance_km int,
  online boolean,
  gender text,
  height_cm smallint,
  job text,
  education text,
  exercise text,
  smoking text,
  children text,
  city text,
  neighbourhoods text[],
  favourite_places text[],
  prompts jsonb,
  photos text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, p.lat::float8 as lat, p.lng::float8 as lng,
           coalesce(p.is_tester, false) as tester
    from (select 1) one
    left join public.profiles p on p.id = (select auth.uid())
  )
  select
    p.id, p.display_name, p.age, p.bio, p.interests, p.looking_for, p.age_min, p.age_max,
    p.photo_path, p.verified, p.created_at,
    private.distance_bucket(me.lat, me.lng, p.lat::float8, p.lng::float8),
    case
      when p.is_demo then abs(hashtext(p.id::text || floor(extract(epoch from now()) / 600)::text)) % 4 = 0
      else p.last_seen_at > now() - interval '10 minutes'
    end,
    p.gender, p.height_cm, p.job, p.education, p.exercise, p.smoking, p.children, p.city,
    p.neighbourhoods, p.favourite_places, p.prompts, p.photos
  from public.profiles p
  cross join me
  where me.uid is not null
    and p.id <> me.uid
    and (not p.is_demo or (me.tester and (p.demo_visible_from is null or p.demo_visible_from <= now())))
    and not private.blocked_either(p.id)
    and (
      (
        p_ids is null
        and not p.hidden
        and not exists (select 1 from public.likes l where l.liker_id = me.uid and l.liked_id = p.id)
        and not exists (select 1 from public.passes s where s.passer_id = me.uid and s.passed_id = p.id)
      )
      or (
        p_ids is not null
        and p.id = any (p_ids)
        and (
          exists (select 1 from public.likes l
                  where (l.liker_id = p.id and l.liked_id = me.uid) or (l.liker_id = me.uid and l.liked_id = p.id))
          or exists (select 1 from public.matches m
                     where (m.user_a = me.uid and m.user_b = p.id) or (m.user_b = me.uid and m.user_a = p.id))
        )
      )
    )
  order by p.last_seen_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;
revoke execute on function private.people(uuid[], int) from public;
grant execute on function private.people(uuid[], int) to authenticated;

create function public.discover_profiles(p_limit int default 500)
returns table (
  id uuid, display_name text, age int, bio text, interests text[], looking_for text,
  age_min int, age_max int, photo_path text, verified boolean, created_at timestamptz,
  distance_km int, online boolean, gender text, height_cm smallint, job text, education text,
  exercise text, smoking text, children text, city text, neighbourhoods text[],
  favourite_places text[], prompts jsonb, photos text[]
)
language sql stable security invoker set search_path = ''
as $$ select * from private.people(null, p_limit); $$;

create function public.profiles_by_ids(p_ids uuid[])
returns table (
  id uuid, display_name text, age int, bio text, interests text[], looking_for text,
  age_min int, age_max int, photo_path text, verified boolean, created_at timestamptz,
  distance_km int, online boolean, gender text, height_cm smallint, job text, education text,
  exercise text, smoking text, children text, city text, neighbourhoods text[],
  favourite_places text[], prompts jsonb, photos text[]
)
language sql stable security invoker set search_path = ''
as $$ select * from private.people(coalesce(p_ids, '{}'), 500); $$;

revoke execute on function public.discover_profiles(int) from public, anon;
revoke execute on function public.profiles_by_ids(uuid[]) from public, anon;
grant execute on function public.discover_profiles(int) to authenticated;
grant execute on function public.profiles_by_ids(uuid[]) to authenticated;

-- ---------- Read receipts (for real unread counts) ----------

create table public.match_reads (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index match_reads_user_idx on public.match_reads (user_id);
alter table public.match_reads enable row level security;

revoke all on public.match_reads from anon, authenticated;
grant select, insert on public.match_reads to authenticated;
grant update (read_at) on public.match_reads to authenticated;

-- You only see and write your own read marker, and only for your own matches.
create policy "match_reads own" on public.match_reads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = match_reads.match_id and (select auth.uid()) in (m.user_a, m.user_b)
    )
  );

-- ---------- Blocked people you can unblock ----------

create function private.my_blocked()
returns table (id uuid, display_name text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, p.display_name, b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where b.blocker_id = (select auth.uid())
  order by b.created_at desc;
$$;
revoke execute on function private.my_blocked() from public;
grant execute on function private.my_blocked() to authenticated;

create function public.my_blocked_users()
returns table (id uuid, display_name text, blocked_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.my_blocked(); $$;
revoke execute on function public.my_blocked_users() from public, anon;
grant execute on function public.my_blocked_users() to authenticated;
