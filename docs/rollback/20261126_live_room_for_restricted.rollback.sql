-- Rollback for 20261126150000_live_room_for_restricted.sql. NOT a migration. Restores the earlier, wider
-- live_room_for and the full SELECT grant on live_streams. No data changes either way.
create or replace function public.live_room_for(p_stream uuid)
returns table (room_name text, provider_key text, creator_id uuid, explicit boolean, status text)
language sql stable security definer set search_path = ''
as $$
  select s.room_name, s.provider_key, s.creator_id, private.is_explicit(s.category), s.status
  from public.live_streams s where s.id = p_stream;
$$;
revoke select on public.live_streams from authenticated;
grant select on public.live_streams to authenticated;
