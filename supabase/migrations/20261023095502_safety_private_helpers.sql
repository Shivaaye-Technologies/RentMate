-- Safety step A, part 1: helper functions in a schema the Data API does not expose.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- True when the caller blocked `other` or `other` blocked the caller.
-- SECURITY DEFINER because blocks RLS only shows a user their own blocks.
create function private.blocked_either(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = other)
       or (b.blocker_id = other and b.blocked_id = (select auth.uid()))
  );
$$;

revoke execute on function private.blocked_either(uuid) from public;
grant execute on function private.blocked_either(uuid) to authenticated;

-- Distance shown to users, in coarse buckets so it cannot pinpoint anyone:
-- 1 km minimum, whole km under 10, nearest 5 km under 50, nearest 10 km beyond.
create function private.distance_bucket(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else (
      select case
        when km < 1.5 then 1
        when km < 10 then round(km)::int
        when km < 50 then (round(km / 5) * 5)::int
        else (round(km / 10) * 10)::int
      end
      from (
        select 2 * 6371 * asin(sqrt(
          power(sin(radians(lat2 - lat1) / 2), 2)
          + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
        )) as km
      ) d
    )
  end;
$$;

revoke execute on function private.distance_bucket(float8, float8, float8, float8) from public;
