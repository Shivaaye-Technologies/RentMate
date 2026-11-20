-- Safety step B (restrictive; applied after the app stopped reading these):
-- other people's coordinates and last-seen times are no longer readable by
-- users (the app gets distance buckets and an online flag from functions),
-- and the photos bucket becomes private (signed links only).

revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, age, bio, interests, looking_for, age_min, age_max, photo_path, verified, created_at, updated_at)
  on public.profiles to authenticated;

update storage.buckets set public = false where id = 'photos';
