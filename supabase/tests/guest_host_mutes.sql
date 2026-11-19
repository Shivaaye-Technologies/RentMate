-- Host mutes of live guests (migration 20261123090000_guest_host_mutes.sql). Always rolls back. Every result must
-- start with "ok".
do $$
declare
  cr uuid := gen_random_uuid();   -- approved creator (host)
  g uuid := gen_random_uuid();    -- approved creator (guest)
  v uuid := gen_random_uuid();    -- viewer / outsider
  modr uuid := gen_random_uuid();
  r text := ''; n int; arr text[]; st uuid; cat text; inv uuid;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@mutes.test', 'authenticated', 'authenticated' from unnest(array[cr, g, v, modr]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[cr, g, v, modr]) u;
  insert into private.user_roles (user_id, role) values (modr, 'moderator');
  insert into public.live_providers (key, name, api_endpoint, credential_env, integration_status, permitted_categories,
                                     contract_status, terms_reviewed_at)
  select 'livekit', 'LiveKit', 'wss://example.livekit.cloud', 'LIVEKIT', 'testing', array_agg(key), 'negotiating', now()
  from public.content_categories where available
  on conflict (key) do update set integration_status = 'testing';
  select key into cat from public.content_categories where available limit 1;
  insert into public.creators (user_id, stage_name, country_code, categories, status)
  values (cr, 'Host Name', 'IN', array[cat], 'approved'), (g, 'Guest Name', 'IN', array[cat], 'approved');
  insert into public.live_streams (creator_id, provider_key, title, category, status, started_at)
  values (cr, 'livekit', 'Evening music', cat, 'live', now()) returning id into st;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  inv := public.live_invite_guest(st, g);
  -- An invited (not yet accepted) guest cannot be muted and may publish nothing.
  begin
    perform public.live_set_guest_mute(st, g, 'video', true);
    r := r || 'FAIL muted an unaccepted guest; ';
  exception when raise_exception then r := r || 'ok only accepted guests can be muted; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  arr := public.live_my_publish_sources(st);
  r := r || case when arr = '{}' then 'ok an invited guest may publish nothing yet; ' else 'FAIL invited ' || arr::text || '; ' end;
  perform public.live_answer_guest_invite(inv, true);

  -- ===== Who may publish what =====
  arr := public.live_my_publish_sources(st);
  r := r || case when arr = array['camera', 'microphone'] then 'ok an accepted guest may publish camera and microphone; '
                 else 'FAIL guest ' || arr::text || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  arr := public.live_my_publish_sources(st);
  r := r || case when arr = array['camera', 'microphone'] then 'ok the creator may publish both; ' else 'FAIL creator; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  arr := public.live_my_publish_sources(st);
  r := r || case when arr = '{}' then 'ok viewers may publish nothing; ' else 'FAIL viewer ' || arr::text || '; ' end;

  -- ===== Who may mute =====
  begin
    perform public.live_set_guest_mute(st, g, 'video', true);
    r := r || 'FAIL viewer muted a guest; ';
  exception when insufficient_privilege then r := r || 'ok viewers cannot mute guests; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  begin
    perform public.live_set_guest_mute(st, g, 'audio', false);
    r := r || 'FAIL guest changed own mute; ';
  exception when insufficient_privilege then r := r || 'ok guests cannot lift or change host mutes; ';
  end;
  begin
    update public.live_guest_invites set host_muted_video = false where id = inv;
    r := r || 'FAIL client wrote mute column; ';
  exception when insufficient_privilege then r := r || 'ok clients cannot write the mute columns directly; ';
  end;

  -- ===== Host mutes camera, then microphone =====
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  arr := public.live_set_guest_mute(st, g, 'video', true);
  r := r || case when arr = array['microphone'] then 'ok a camera mute leaves the microphone; ' else 'FAIL video mute ' || arr::text || '; ' end;
  arr := public.live_set_guest_mute(st, g, 'audio', true);
  r := r || case when arr = '{}' then 'ok muting both leaves nothing to publish; ' else 'FAIL both ' || arr::text || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  arr := public.live_my_publish_sources(st);
  r := r || case when arr = '{}' then 'ok the mutes apply to every later token (reconnects included); '
                 else 'FAIL persisted ' || arr::text || '; ' end;
  select count(*) into n from public.live_guest_invites where id = inv and host_muted_audio and host_muted_video;
  r := r || case when n = 1 then 'ok the guest can see they are muted; ' else 'FAIL visibility; ' end;

  -- ===== Moderator unmutes the camera; host unmutes the microphone =====
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  arr := public.live_set_guest_mute(st, g, 'video', false);
  r := r || case when arr = array['camera'] then 'ok moderators can allow the camera again; ' else 'FAIL mod ' || arr::text || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  arr := public.live_set_guest_mute(st, g, 'audio', false);
  r := r || case when arr = array['camera', 'microphone'] then 'ok unmuting restores both; ' else 'FAIL restore ' || arr::text || '; ' end;
  begin
    perform public.live_set_guest_mute(st, g, 'screen', true);
    r := r || 'FAIL invalid kind; ';
  exception when invalid_parameter_value then r := r || 'ok only camera and microphone can be muted; ';
  end;
  begin
    perform public.live_set_guest_mute(st, v, 'video', true);
    r := r || 'FAIL muted a non-guest; ';
  exception when raise_exception then r := r || 'ok people who are not guests cannot be muted; ';
  end;
  reset role;
  select count(*) into n from public.moderation_actions
  where action in ('live_guest_muted', 'live_guest_unmuted') and target_id = g::text;
  r := r || case when n = 4 then 'ok every mute and unmute is logged; ' else 'FAIL log ' || n || '; ' end;

  -- A removed guest loses everything, mutes or not.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  perform public.live_remove_guest(st, g);
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  arr := public.live_my_publish_sources(st);
  r := r || case when arr = '{}' then 'ok a removed guest may publish nothing; ' else 'FAIL removed ' || arr::text || '; ' end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
