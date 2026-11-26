-- live_room_for and the live_streams room_name column (migration 20261126150000). Always rolls back.
-- Every result must start with "ok".
do $$
declare
  cr uuid := gen_random_uuid();   -- creator
  v uuid := gen_random_uuid();    -- ordinary viewer
  bl uuid := gen_random_uuid();   -- viewer blocked by the creator
  g uuid := gen_random_uuid();    -- invited guest
  modr uuid := gen_random_uuid(); -- moderator
  r text := ''; n bigint; cat text; live uuid; ended uuid; t text;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@room.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[cr, v, bl, g, modr]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[cr, v, bl, g, modr]) u;
  insert into private.user_roles (user_id, role) values (modr, 'moderator');
  insert into public.live_providers (key, name, api_endpoint, credential_env, integration_status, permitted_categories,
                                     contract_status, terms_reviewed_at)
  select 'livekit', 'LiveKit', 'wss://example.livekit.cloud', 'LIVEKIT', 'testing', array_agg(key), 'negotiating', now()
  from public.content_categories where available
  on conflict (key) do update set integration_status = 'testing';
  select key into cat from public.content_categories where available and not private.is_explicit(key) limit 1;
  insert into public.creators (user_id, stage_name, country_code, categories, status)
  values (cr, 'Host Name', 'GB', array[cat], 'approved');
  insert into public.live_streams (creator_id, provider_key, title, category, status, started_at)
  values (cr, 'livekit', 'Evening music', cat, 'live', now()) returning id into live;
  insert into public.live_streams (creator_id, provider_key, title, category, status, started_at, ended_at)
  values (cr, 'livekit', 'Last week', cat, 'ended', now() - interval '7 days', now() - interval '7 days')
  returning id into ended;
  insert into public.blocks (blocker_id, blocked_id) values (cr, bl);
  insert into public.live_guest_invites (stream_id, guest_id, status) values (ended, g, 'accepted');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_room_for(live);
  r := r || case when n = 1 then 'ok a viewer gets the room of a live stream; ' else 'FAIL viewer live ' || n || '; ' end;
  select count(*) into n from public.live_room_for(ended);
  r := r || case when n = 0 then 'ok but not of an ended stream; ' else 'FAIL viewer ended ' || n || '; ' end;
  begin
    select room_name into t from public.live_streams where id = live;
    r := r || 'FAIL members read room_name from the table; ';
  exception when insufficient_privilege then r := r || 'ok members cannot read room_name from the table; ';
  end;
  select count(*) into n from public.live_streams where id = live and title = 'Evening music';
  r := r || case when n = 1 then 'ok the other stream columns stay readable; ' else 'FAIL stream row ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', bl, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_room_for(live);
  r := r || case when n = 0 then 'ok a blocked viewer gets nothing; ' else 'FAIL blocked ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_room_for(ended);
  r := r || case when n = 1 then 'ok an invited guest gets the room; ' else 'FAIL guest ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_room_for(ended);
  r := r || case when n = 1 then 'ok the creator gets their own room; ' else 'FAIL creator ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_room_for(ended);
  r := r || case when n = 1 then 'ok moderators get any room; ' else 'FAIL moderator ' || n || '; ' end;
  reset role;

  set local role anon;
  begin
    perform public.live_room_for(live);
    r := r || 'FAIL signed-out caller ran it; ';
  exception when insufficient_privilege then r := r || 'ok signed-out callers cannot call it; ';
  end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
