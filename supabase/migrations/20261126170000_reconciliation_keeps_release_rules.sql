-- Follow-up to 20261126160000. Append-only.
--
-- That migration's reconciliation also tightened the rules for bookings that were never reversed: a released hold
-- had to show a refund equal to the hold, and an open hold had to show none. A deleted member's refund is skipped
-- by design (booking_hold_release), so those holds would have shown as unbalanced. Only reversed bookings needed
-- new rules; every other case goes back to exactly what 20261126090000 checked.

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
  with x as (
    select h.booking_id, h.status, h.tokens, h.created_at,
           coalesce((select sum(l.delta) from public.token_ledger l
                     where l.idempotency_key in ('booking_refund:' || h.booking_id,
                                                 'booking_reversal:' || h.booking_id)), 0)::bigint as back,
           (select e.tokens from public.creator_booking_earnings e where e.booking_id = h.booking_id) as earned,
           (select c.commission_tokens from public.platform_commission_entries c where c.booking_id = h.booking_id) as comm,
           (select r from public.booking_settlement_reversals r where r.booking_id = h.booking_id) as rev
    from public.booking_token_holds h
  )
  select x.booking_id, x.status, x.tokens, x.back,
         (coalesce(x.earned, 0) - coalesce((x.rev).creator_tokens_reversed, 0))::bigint,
         (coalesce(x.comm, 0) - coalesce((x.rev).commission_tokens_reversed, 0))::bigint,
         case
           when x.status = 'settled' and x.rev is not null then
             x.back = x.tokens and (x.rev).creator_tokens_reversed = x.earned
             and (x.rev).commission_tokens_reversed = x.comm
           when x.status = 'settled' then coalesce(x.earned, 0) + coalesce(x.comm, 0) = x.tokens
           else x.earned is null
         end
  from x order by x.created_at desc limit 1000;
end;
$$;
