-- Host mutes of live guests become persistent and server-enforced (CI run 44601328482, rtc job).
--
-- Before: the API muted only the guest tracks that existed at that moment (LiveKit MutePublishedTrack). A camera
-- published a moment later, a reconnect or the guest's own unmute escaped it, and a mute sent while the guest's camera
-- was still being published found nothing ({"muted": 0}).
-- Now: the mute is stored per guest and kind. The API removes the source from the guest's LiveKit publish permission
-- (UpdateParticipant) as well as muting current tracks, and every later broadcaster token for that guest leaves the
-- source out. Unmuting gives the permission back; the guest turns the device on themselves (never remotely).
-- Append-only.

alter table public.live_guest_invites
  add column host_muted_audio boolean not null default false,
  add column host_muted_video boolean not null default false;

-- Sources the caller may publish in this stream's room: creators both; accepted guests minus host mutes; else none.
create function public.live_my_publish_sources(p_stream uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.live_streams s where s.id = p_stream and s.creator_id = (select auth.uid()))
      then array['camera', 'microphone']
    else coalesce((
      select array_remove(array[case when not i.host_muted_video then 'camera' end,
                                case when not i.host_muted_audio then 'microphone' end], null)
      from public.live_guest_invites i
      where i.stream_id = p_stream and i.guest_id = (select auth.uid()) and i.status = 'accepted'), '{}'::text[])
  end;
$$;

-- Host (stream creator) or moderator mutes or unmutes an accepted guest's camera ('video') or microphone ('audio').
-- Returns the sources the guest may publish afterwards, for the API to apply in LiveKit.
create function public.live_set_guest_mute(p_stream uuid, p_guest uuid, p_kind text, p_muted boolean)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.live_guest_invites;
begin
  if not public.live_host_check(p_stream) then
    raise exception 'Only the host or a moderator can do that.' using errcode = '42501';
  end if;
  if p_kind not in ('audio', 'video') or p_muted is null then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;
  update public.live_guest_invites
     set host_muted_audio = case when p_kind = 'audio' then p_muted else host_muted_audio end,
         host_muted_video = case when p_kind = 'video' then p_muted else host_muted_video end
   where stream_id = p_stream and guest_id = p_guest and status = 'accepted'
  returning * into i;
  if not found then
    raise exception 'That person is not a guest on this stream.' using errcode = 'P0001';
  end if;
  perform private.log_action(case when p_muted then 'live_guest_muted' else 'live_guest_unmuted' end, 'profile',
    p_guest::text, null, jsonb_build_object('stream', p_stream, 'kind', p_kind));
  return array_remove(array[case when not i.host_muted_video then 'camera' end,
                            case when not i.host_muted_audio then 'microphone' end], null);
end;
$$;

revoke execute on function public.live_my_publish_sources(uuid) from public, anon;
revoke execute on function public.live_set_guest_mute(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.live_my_publish_sources(uuid) to authenticated;
grant execute on function public.live_set_guest_mute(uuid, uuid, text, boolean) to authenticated;
