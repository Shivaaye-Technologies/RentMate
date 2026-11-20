-- Rollback for 20261123120000_account_deletion_photos.sql. Founder approval and a backup first. Restores the previous
-- account deletion (no photo check), re-opening P2-05.

drop function public.admin_orphaned_photos();

create or replace function private.delete_my_account()
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
