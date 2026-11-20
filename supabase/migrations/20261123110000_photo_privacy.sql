-- Photo privacy (P2-04). Append-only; changes no existing rows.
--
-- Before: any signed-in member could read (and list) every member's folder in the private `photos` bucket unless one
-- had blocked the other. Now a member may read a file only when it is
--   * in their own folder, or
--   * one of the owner's published photos (profiles.photo_path or profiles.photos; stray uploads stay private),
--     neither has blocked the other, and the owner is visible to them under the same rules as discovery: not hidden,
--     or a like in either direction, or a match, or an approved companion.
-- Storage's list and signed-URL calls go through this SELECT policy, so enumeration is limited the same way.

create function private.can_view_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  folder text := (storage.foldername(p_name))[1];
  owner uuid;
  p public.profiles;
begin
  if me is null or folder is null
     or folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  owner := folder::uuid;
  if owner = me then
    return true;
  end if;
  select * into p from public.profiles where id = owner;
  if p.id is null then
    return false; -- no profile (for example a deleted account): nobody else may read the files
  end if;
  -- coalesce: with no main photo, `p_name = p.photo_path` is null and `not (null or false)` would not refuse.
  if not (coalesce(p_name = p.photo_path, false) or coalesce(p_name = any (p.photos), false)) then
    return false; -- only published photos
  end if;
  if private.blocked_either(owner) then
    return false;
  end if;
  return not p.hidden
    or exists (select 1 from public.likes l
               where (l.liker_id = owner and l.liked_id = me) or (l.liker_id = me and l.liked_id = owner))
    or exists (select 1 from public.matches m
               where (m.user_a = me and m.user_b = owner) or (m.user_a = owner and m.user_b = me))
    or private.companion_visible(owner);
end;
$$;
revoke execute on function private.can_view_photo(text) from public;
-- Evaluated inside a storage policy, which runs as the signed-in member.
grant execute on function private.can_view_photo(text) to authenticated;

drop policy "photos read signed-in unless blocked" on storage.objects;
create policy "photos read own or visible" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.can_view_photo(name));
