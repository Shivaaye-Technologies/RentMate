-- Safety step A, part 2b: safe profile functions (no raw coordinates or
-- last-seen times for other people), account deletion, photo read policy.

-- Own full profile (including your own location and age range).
create function private.my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.profiles where id = (select auth.uid());
$$;
revoke execute on function private.my_profile() from public;
grant execute on function private.my_profile() to authenticated;

-- Other people, with only safe derived fields: coarse distance and online flag.
-- p_ids null  = discovery (excludes people you liked, passed or blocked).
-- p_ids given = those people, only if they liked you, you liked them, or you matched.
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
  online boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, p.lat::float8 as lat, p.lng::float8 as lng
    from (select 1) one
    left join public.profiles p on p.id = (select auth.uid())
  )
  select
    p.id, p.display_name, p.age, p.bio, p.interests, p.looking_for, p.age_min, p.age_max,
    p.photo_path, p.verified, p.created_at,
    private.distance_bucket(me.lat, me.lng, p.lat::float8, p.lng::float8),
    p.last_seen_at > now() - interval '10 minutes'
  from public.profiles p
  cross join me
  where me.uid is not null
    and p.id <> me.uid
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
revoke execute on function private.people(uuid[], int) from public;
grant execute on function private.people(uuid[], int) to authenticated;

-- Deletes the caller's account; everything they own cascades from auth.users.
create function private.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;
revoke execute on function private.delete_my_account() from public;
grant execute on function private.delete_my_account() to authenticated;

-- Public entry points (SECURITY INVOKER; the private functions do the checked work).
create function public.get_my_profile()
returns setof public.profiles
language sql stable security invoker set search_path = ''
as $$ select * from private.my_profile(); $$;

create function public.discover_profiles(p_limit int default 500)
returns table (
  id uuid, display_name text, age int, bio text, interests text[], looking_for text,
  age_min int, age_max int, photo_path text, verified boolean, created_at timestamptz,
  distance_km int, online boolean
)
language sql stable security invoker set search_path = ''
as $$ select * from private.people(null, p_limit); $$;

create function public.profiles_by_ids(p_ids uuid[])
returns table (
  id uuid, display_name text, age int, bio text, interests text[], looking_for text,
  age_min int, age_max int, photo_path text, verified boolean, created_at timestamptz,
  distance_km int, online boolean
)
language sql stable security invoker set search_path = ''
as $$ select * from private.people(coalesce(p_ids, '{}'), 500); $$;

create function public.delete_my_account()
returns void
language sql security invoker set search_path = ''
as $$ select private.delete_my_account(); $$;

revoke execute on function public.get_my_profile() from public, anon;
revoke execute on function public.discover_profiles(int) from public, anon;
revoke execute on function public.profiles_by_ids(uuid[]) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.discover_profiles(int) to authenticated;
grant execute on function public.profiles_by_ids(uuid[]) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Photos: signed-in users can read photos (needed once the bucket is private),
-- except photos of people in a block with them.
create policy "photos read signed-in unless blocked" on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and not private.blocked_either(((storage.foldername(name))[1])::uuid)
  );
