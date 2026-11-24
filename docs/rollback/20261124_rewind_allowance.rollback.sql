-- Rollback for 20261124173000_rewind_allowance.sql.
-- NOT a migration. Remove only the rewind trigger/function and restore the usage action constraint.

drop trigger if exists enforce_rewind_allowance on public.passes;
drop function if exists private.enforce_rewind_allowance();

alter table public.discovery_action_usage
  drop constraint if exists discovery_action_usage_action_check,
  add constraint discovery_action_usage_action_check
    check (action in ('like', 'dislike'));
