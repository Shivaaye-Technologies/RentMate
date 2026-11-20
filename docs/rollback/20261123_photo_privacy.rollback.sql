-- Rollback for 20261123110000_photo_privacy.sql. Founder approval and a backup first. Restores the previous photo
-- read policy (any signed-in member unless blocked), re-opening P2-04. Roll back 20261123120000 first.

drop policy "photos read own or visible" on storage.objects;
create policy "photos read signed-in unless blocked" on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and not private.blocked_either(((storage.foldername(name))[1])::uuid)
  );
drop function private.can_view_photo(text);
