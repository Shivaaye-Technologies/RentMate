-- Admin decision on disputes raised after a booking settled (finding SEC-1). Sandbox tokens only. Append-only.
--
-- A participant may dispute a completed booking for 7 days. Once the hold has settled, the dispute froze nothing,
-- and there was no way to correct the outcome: the tokens had already become the creator's pending earnings and
-- the platform's commission. Pending earnings cannot be withdrawn, transferred or paid out (that stays locked), so
-- a correction can still be made entirely inside the token ledger.
--
-- public.admin_decide_settled_dispute(booking, action, note), admins only, for a 'disputed' booking whose hold
-- has 'settled':
--   * 'reverse': the member gets the gross tokens back (ledger key booking_reversal:<id>, so at most once), and
--     one append-only reversal row cancels the creator's pending earnings and the commission for that booking.
--     The booking is cancelled. Nothing is edited or deleted: the earnings and commission rows stay as written.
--   * 'uphold': the booking returns to completed; tokens stay where they are.
-- Every decision is recorded in the admin action log and both participants are notified.

create table public.booking_settlement_reversals (
  id bigint generated always as identity primary key,
  booking_id uuid not null unique references public.bookings (id) on delete restrict,
  member_tokens_refunded bigint not null check (member_tokens_refunded > 0),
  creator_tokens_reversed bigint not null check (creator_tokens_reversed >= 0),
  commission_tokens_reversed bigint not null check (commission_tokens_reversed >= 0),
  ledger_entry bigint not null,
  note text not null check (char_length(note) between 5 and 300),
  actor uuid not null,
  created_at timestamptz not null default now(),
  constraint reversal_adds_up check (creator_tokens_reversed + commission_tokens_reversed = member_tokens_refunded)
);
alter table public.booking_settlement_reversals enable row level security;
revoke all on public.booking_settlement_reversals from public, anon, authenticated;
grant select on public.booking_settlement_reversals to authenticated;
create policy "reversals read participants" on public.booking_settlement_reversals for select to authenticated
  using (private.booking_participant(booking_id));
create trigger append_only before update or delete on public.booking_settlement_reversals
  for each row execute function private.accounting_append_only();

alter table public.booking_token_hold_events drop constraint booking_token_hold_events_event_check;
alter table public.booking_token_hold_events add constraint booking_token_hold_events_event_check
  check (event in ('held', 'frozen', 'unfrozen', 'released', 'settled', 'reversed'));

create function public.admin_decide_settled_dispute(p_booking uuid, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bk public.bookings;
  h public.booking_token_holds;
  e public.creator_booking_earnings;
  c public.platform_commission_entries;
  entry bigint;
  msg text;
begin
  perform private.require_role('admin');
  if p_action is null or p_action not in ('reverse', 'uphold') then
    raise exception 'Action must be reverse or uphold.' using errcode = '22023';
  end if;
  if char_length(coalesce(btrim(p_note), '')) < 5 then
    raise exception 'Record a reason (at least 5 characters).' using errcode = '22023';
  end if;
  select * into bk from public.bookings where id = p_booking for update;
  select * into h from public.booking_token_holds where booking_id = p_booking for update;
  if bk.id is null or h.booking_id is null or bk.status <> 'disputed' or h.status <> 'settled' then
    raise exception 'Only disputed bookings whose tokens already settled can be decided here.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.booking_settlement_reversals r where r.booking_id = p_booking) then
    raise exception 'This settlement was already reversed.' using errcode = 'P0001';
  end if;

  if p_action = 'uphold' then
    update public.bookings set status = 'completed', updated_at = now() where id = p_booking;
    perform private.booking_log(p_booking, 'disputed', 'completed', 'Dispute reviewed: outcome upheld');
    msg := 'The dispute was reviewed and the booking stays completed.';
  else
    select * into e from public.creator_booking_earnings where booking_id = p_booking;
    select * into c from public.platform_commission_entries where booking_id = p_booking;
    if e.booking_id is null or c.booking_id is null or bk.member_id is null then
      raise exception 'This booking cannot be reversed (its records are incomplete). Escalate it.' using errcode = 'P0001';
    end if;
    entry := private.ledger_post(bk.member_id, e.tokens + c.commission_tokens, 'booking_refund', 'booking',
                                 p_booking::text, 'booking_reversal:' || p_booking, (select auth.uid()));
    insert into public.booking_settlement_reversals (booking_id, member_tokens_refunded, creator_tokens_reversed,
                                                     commission_tokens_reversed, ledger_entry, note, actor)
    values (p_booking, e.tokens + c.commission_tokens, e.tokens, c.commission_tokens, entry, left(btrim(p_note), 300),
            (select auth.uid()));
    insert into public.booking_token_hold_events (booking_id, event, tokens, ledger_entry, note, actor)
    values (p_booking, 'reversed', e.tokens + c.commission_tokens, entry, left(p_note, 300), (select auth.uid()));
    -- The lifecycle trigger finds the hold already settled, so it refunds nothing more.
    update public.bookings set status = 'cancelled', cancelled_by = (select auth.uid()),
      cancel_reason = left('Settlement reversed after review: ' || p_note, 500), updated_at = now()
    where id = p_booking;
    perform private.booking_log(p_booking, 'disputed', 'cancelled', 'Dispute reviewed: settlement reversed');
    msg := 'The dispute was reviewed and the member''s tokens were returned.';
  end if;
  perform private.booking_system_message(p_booking, msg);
  perform private.notify(bk.member_id, 'dispute_resolved', 'Dispute resolved',
    format('%s · %s', bk.service_title, bk.reference), p_booking);
  perform private.notify(bk.companion_id, 'dispute_resolved', 'Dispute resolved',
    format('%s · %s', bk.service_title, bk.reference), p_booking);
  perform private.log_action('booking_settled_dispute_' || p_action, 'booking', p_booking::text, p_note);
end;
$$;
revoke execute on function public.admin_decide_settled_dispute(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_settled_dispute(uuid, text, text) to authenticated;

-- Creators' pending total now nets out reversed bookings. settled_bookings counts bookings that stayed settled.
create or replace function public.my_creator_booking_earnings()
returns table (pending_tokens bigint, settled_bookings bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(e.tokens - coalesce(r.creator_tokens_reversed, 0)), 0)::bigint,
         count(*) filter (where r.booking_id is null)
  from public.creator_booking_earnings e
  left join public.booking_settlement_reversals r on r.booking_id = e.booking_id
  where e.creator_id = (select auth.uid());
$$;

-- Reconciliation counts reversals: a reversed booking balances when the member got the whole hold back and the
-- reversal cancelled exactly the earnings and commission that were written.
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
                     where l.idempotency_key in ('booking_refund:' || h.booking_id, 'booking_reversal:' || h.booking_id)), 0)::bigint as back,
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
           when x.status = 'settled' then
             x.back = 0 and coalesce(x.earned, 0) + coalesce(x.comm, 0) = x.tokens
           when x.status = 'released' then x.earned is null and x.back = x.tokens
           else x.earned is null and x.back = 0
         end
  from x order by x.created_at desc limit 1000;
end;
$$;
