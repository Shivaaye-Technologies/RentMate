-- Complete account deletion (P2-05). Append-only; changes no existing rows.
--
-- Before: photos were removed only by the browser, so closing it (or calling delete_my_account directly) could leave
-- a deleted member's photos in Storage. Now the database refuses a member's own account deletion while files remain in
-- their photo folder; the API endpoint DELETE /api/v1/account removes them first, on the server. Admins can list photos
-- left by accounts deleted before this change.
--
-- The check is a trigger on auth.users rather than a change to delete_my_account, so it also covers any other way a
-- signed-in member could delete their own user row. Deletions made without a member session (the Supabase dashboard,
-- the service role) are not blocked; an admin removing an account should remove its photos too.

create function private.refuse_self_delete_with_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining int;
begin
  if (select auth.uid()) is distinct from old.id then
    return old; -- not a member deleting their own account
  end if;
  select count(*) into remaining
  from storage.objects o
  where o.bucket_id = 'photos' and (storage.foldername(o.name))[1] = old.id::text;
  if remaining > 0 then
    raise exception 'Your photos must be deleted before your account (% left). Please try again.', remaining
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke execute on function private.refuse_self_delete_with_photos() from public;

create trigger auth_users_refuse_self_delete_with_photos
  before delete on auth.users
  for each row execute function private.refuse_self_delete_with_photos();

-- Photos whose folder belongs to no account (left by deletions before this change). Read-only, admins only; the
-- files themselves are removed in the Supabase dashboard (Storage) or with the Storage API.
create function public.admin_orphaned_photos()
returns table (name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_role('admin') then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return query
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'photos'
      and not exists (select 1 from auth.users u where u.id::text = (storage.foldername(o.name))[1])
    order by o.created_at;
end;
$$;
revoke execute on function public.admin_orphaned_photos() from public, anon;
grant execute on function public.admin_orphaned_photos() to authenticated;
