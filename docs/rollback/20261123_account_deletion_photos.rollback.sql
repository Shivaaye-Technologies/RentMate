-- Rollback for 20261123120000_account_deletion_photos.sql. Founder approval and a backup first. Members can again
-- delete their account while photos remain, re-opening P2-05.

drop function public.admin_orphaned_photos();
drop trigger auth_users_refuse_self_delete_with_photos on auth.users;
drop function private.refuse_self_delete_with_photos();
