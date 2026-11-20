-- Complete account deletion (P2-05). Append-only; changes no existing rows.
--
-- Before: photos were removed only by the browser, so closing it (or calling delete_my_account directly) could leave
-- a deleted member's photos in Storage. Now the database refuses to delete an account while files remain in its photo
-- folder; the API endpoint DELETE /api/v1/account removes them first, on the server. Admins can list photos left by
-- accounts deleted before this change.

create or replace function private.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  remaining int;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select count(*) into remaining
  from storage.objects o
  where o.bucket_id = 'photos' and (storage.foldername(o.name))[1] = uid::text;
  if remaining > 0 then
    raise exception 'Your photos must be deleted before your account (% left). Please try again.', remaining
      using errcode = 'P0001';
  end if;
  delete from auth.users where id = uid; -- no row after a completed deletion: repeating it is harmless
end;
$$;

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
