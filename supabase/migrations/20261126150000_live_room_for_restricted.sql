-- Restrict live room details to the people the API's live flows serve (finding SEC-2). Append-only.
--
-- public.live_room_for returned any stream's room name, provider and creator to any signed-in member, including
-- for streams that member could not watch (ended, blocked, emergency stop). A room name cannot join a room without
-- a server-signed LiveKit token, so this was information disclosure only, but nothing needs it.
--
-- It now answers only:
--   * the stream's creator;
--   * moderators (the host controls run as moderators too);
--   * a guest the host invited (invited or accepted);
--   * a viewer who could watch now, ignoring only the country check: the API runs live_watch_check with the
--     viewer's country before it issues any token, and this function never sees the country.
-- Everyone else gets no row, which the API already answers as "stream_not_found".

create or replace function public.live_room_for(p_stream uuid)
returns table (room_name text, provider_key text, creator_id uuid, explicit boolean, status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    return;
  end if;
  return query
    select s.room_name, s.provider_key, s.creator_id, private.is_explicit(s.category), s.status
    from public.live_streams s
    where s.id = p_stream
      and (s.creator_id = me
           or private.has_role('moderator')
           or exists (select 1 from public.live_guest_invites g
                      where g.stream_id = s.id and g.guest_id = me and g.status in ('invited', 'accepted'))
           or private.watch_problems(s.id, me, null) <@ array['country_unknown']::text[]);
end;
$$;
revoke execute on function public.live_room_for(uuid) from public, anon;
grant execute on function public.live_room_for(uuid) to authenticated;

-- Members could also read room_name straight from the table for any visible stream. No client reads it (the web
-- and Android apps select named columns), so members keep every column except room_name. Row access is unchanged.
revoke select on public.live_streams from authenticated;
grant select (id, creator_id, provider_key, title, category, scheduled_at, status, participants, countries_allowed,
              started_at, ended_at, terminated_by, termination_reason, created_at)
  on public.live_streams to authenticated;
