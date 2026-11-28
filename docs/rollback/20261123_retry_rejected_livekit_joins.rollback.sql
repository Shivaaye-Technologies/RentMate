-- Rollback for 20261123170000_retry_rejected_livekit_joins.sql.
-- Restores the original webhook handler from 20261121090000_calls_and_live_rooms.sql.
create or replace function public.live_webhook_ingest(p_secret text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev text := p_event ->> 'event';
  ev_id text := p_event ->> 'id';
  room text := p_event #>> '{room,name}';
  ident text := p_event #>> '{participant,identity}';
  uid uuid;
  at timestamptz := coalesce(to_timestamp(nullif(p_event ->> 'createdAt', '')::bigint), now());
  c public.call_sessions;
begin
  if not private.integration_secret_ok('livekit_webhook', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if ev_id is null or ev is null then raise exception 'Invalid event.' using errcode = '22023'; end if;
  insert into private.webhook_events (id, event, room_name, identity, occurred_at)
  values (ev_id, ev, room, ident, at) on conflict (id) do nothing;
  if not found then return jsonb_build_object('duplicate', true, 'kick', false); end if;
  if ident ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then uid := ident::uuid; end if;

  if ev = 'participant_joined' then
    if uid is null or not private.room_allowed(room, uid) then
      return jsonb_build_object('duplicate', false, 'kick', true);
    end if;
    insert into private.room_presence (room_name, identity, joined_at) values (room, uid, at);
  elsif ev = 'participant_left' and uid is not null then
    update private.room_presence set left_at = greatest(at, joined_at)
    where id = (select id from private.room_presence where room_name = room and identity = uid and left_at is null
                order by joined_at desc limit 1);
  elsif ev = 'room_finished' then
    update private.room_presence set left_at = greatest(at, joined_at) where room_name = room and left_at is null;
    select * into c from public.call_sessions where room_name = room;
    if found then perform private.call_settle(c.id, at); end if;
  end if;
  return jsonb_build_object('duplicate', false, 'kick', false);
end;
$$;
