-- Rollback for 20261126160000_booking_settlement_reversal.sql and 20261126170000_reconciliation_keeps_release_rules.sql
-- (undo both together). NOT a migration. Refuses to run once any settlement has been reversed: those refunds are in
-- the ledger and removing the reversal records would make creators' pending earnings and reconciliation wrong.
do $$
begin
  if exists (select 1 from public.booking_settlement_reversals)
     or exists (select 1 from public.booking_token_hold_events where event = 'reversed') then
    raise exception 'Settlement reversals exist; this rollback would lose them. Keep the migration.';
  end if;
end $$;
drop function if exists public.admin_decide_settled_dispute(uuid, text, text);
create or replace function public.my_creator_booking_earnings()
returns table (pending_tokens bigint, settled_bookings bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.tokens), 0)::bigint, count(*) from public.creator_booking_earnings e
  where e.creator_id = (select auth.uid());
$$;
create or replace function public.admin_booking_token_reconciliation()
returns table (booking_id uuid, hold_status text, held bigint, released bigint, creator bigint, commission bigint,
               balanced boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query
  select h.booking_id, h.status, h.tokens,
         coalesce((select sum(l.delta) from public.token_ledger l where l.idempotency_key = 'booking_refund:' || h.booking_id), 0)::bigint,
         coalesce((select e.tokens from public.creator_booking_earnings e where e.booking_id = h.booking_id), 0)::bigint,
         coalesce((select c.commission_tokens from public.platform_commission_entries c where c.booking_id = h.booking_id), 0)::bigint,
         case h.status
           when 'released' then not exists (select 1 from public.creator_booking_earnings e where e.booking_id = h.booking_id)
           when 'settled' then coalesce((select e.tokens from public.creator_booking_earnings e where e.booking_id = h.booking_id), 0)
                               + coalesce((select c.commission_tokens from public.platform_commission_entries c where c.booking_id = h.booking_id), 0)
                               = h.tokens
           else not exists (select 1 from public.creator_booking_earnings e where e.booking_id = h.booking_id)
         end
  from public.booking_token_holds h order by h.created_at desc limit 1000;
end;
$$;
drop table if exists public.booking_settlement_reversals;
alter table public.booking_token_hold_events drop constraint booking_token_hold_events_event_check;
alter table public.booking_token_hold_events add constraint booking_token_hold_events_event_check
  check (event in ('held', 'frozen', 'unfrozen', 'released', 'settled'));
