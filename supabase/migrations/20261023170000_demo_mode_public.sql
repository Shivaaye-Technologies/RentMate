-- Demo Mode: anyone (signed in or not) can browse the fictional demo profiles.
--
-- * demo_mode_profiles() returns ONLY rows marked is_demo, and only the fields a
--   profile card needs. It never returns a real member, coordinates or last-seen
--   times. Real profiles stay unreadable to visitors (no anon grant on profiles).
-- * profiles.demo_visible_from staggers new demo profiles over time: a profile
--   appears from that moment (null = always). Users cannot set it (not in the
--   column grants).
-- * Demo Mode likes, matches and chats are simulated in the visitor's browser and
--   never written to likes / matches / messages, so they cannot reach real members.

alter table public.profiles add column demo_visible_from timestamptz;

-- Released demo profiles for Demo Mode, newest first. Distance is from the centre
-- of the demo profiles (visitors share no location); online rotates like discovery.
create function private.demo_mode_profiles(p_limit int)
returns table (
  id uuid,
  display_name text,
  age int,
  bio text,
  interests text[],
  looking_for text,
  photo_path text,
  verified boolean,
  created_at timestamptz,
  distance_km int,
  online boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with released as (
    select p.* from public.profiles p
    where p.is_demo and (p.demo_visible_from is null or p.demo_visible_from <= now())
  ),
  centre as (
    select avg(r.lat)::float8 as lat, avg(r.lng)::float8 as lng from released r
  )
  select
    r.id, r.display_name, r.age, r.bio, r.interests, r.looking_for, r.photo_path, r.verified,
    coalesce(r.demo_visible_from, r.created_at),
    private.distance_bucket(c.lat, c.lng, r.lat::float8, r.lng::float8),
    abs(hashtext(r.id::text || floor(extract(epoch from now()) / 600)::text)) % 4 = 0
  from released r
  cross join centre c
  order by coalesce(r.demo_visible_from, r.created_at) desc, r.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

grant usage on schema private to anon;
revoke execute on function private.demo_mode_profiles(int) from public;
grant execute on function private.demo_mode_profiles(int) to anon, authenticated;

create function public.demo_mode_profiles(p_limit int default 200)
returns table (
  id uuid, display_name text, age int, bio text, interests text[], looking_for text,
  photo_path text, verified boolean, created_at timestamptz, distance_km int, online boolean
)
language sql stable security invoker set search_path = ''
as $$ select * from private.demo_mode_profiles(p_limit); $$;
revoke execute on function public.demo_mode_profiles(int) from public;
grant execute on function public.demo_mode_profiles(int) to anon, authenticated;

-- Testers' discovery also waits for a demo profile's release time.
create or replace function private.people(p_ids uuid[], p_limit int)
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
  online boolean
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
    end
  from public.profiles p
  cross join me
  where me.uid is not null
    and p.id <> me.uid
    and (not p.is_demo or (me.tester and (p.demo_visible_from is null or p.demo_visible_from <= now())))
    and not private.blocked_either(p.id)
    and (
      (
        p_ids is null
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
