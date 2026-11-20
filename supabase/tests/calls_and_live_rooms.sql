-- Calls and live rooms (migration 20261121090000_calls_and_live_rooms.sql). Always rolls back. Every result must
-- start with "ok".
do $$
declare
  a uuid := gen_random_uuid();   -- caller
  b uuid := gen_random_uuid();   -- callee, matched with a
  x uuid := gen_random_uuid();   -- not matched with a
  cr uuid := gen_random_uuid();  -- approved creator
  g uuid := gen_random_uuid();   -- approved creator (guest)
  v uuid := gen_random_uuid();   -- viewer
  modr uuid := gen_random_uuid();
  secret text := 'test-webhook-secret-0123456789abcdefghij';
  r text := ''; n int; t timestamptz; js jsonb; arr text[]; ok boolean;
  c1 uuid; c2 uuid; c3 uuid; room text; sroom text; st uuid; cat text; inv uuid; msg uuid; svc uuid; bk uuid;
  rec record; ids bigint[]; guests uuid[]; i int;
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@calls.test', 'authenticated', 'authenticated' from unnest(array[a, b, x, cr, g, v, modr]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[a, b, x, cr, g, v, modr]) u;
  insert into private.user_roles (user_id, role) values (modr, 'moderator');
  insert into public.likes (liker_id, liked_id) values (a, b), (b, a);
  -- "testing" needs terms under negotiation and reviewed (the provider rules from the live foundation).
  insert into public.live_providers (key, name, api_endpoint, credential_env, integration_status, permitted_categories,
                                     contract_status, terms_reviewed_at)
  select 'livekit', 'LiveKit', 'wss://example.livekit.cloud', 'LIVEKIT', 'testing', array_agg(key), 'negotiating', now()
  from public.content_categories where available
  on conflict (key) do update set integration_status = 'testing';
  perform private.set_integration_secret('livekit_webhook', secret);
  select key into cat from public.content_categories where available limit 1;
  insert into public.creators (user_id, stage_name, country_code, categories, status)
  values (cr, 'Host Name', 'IN', array[cat], 'approved'), (g, 'Guest Name', 'IN', array[cat], 'approved');
  insert into public.live_streams (creator_id, provider_key, title, category, status, started_at)
  values (cr, 'livekit', 'Evening music', cat, 'live', now()) returning id, room_name into st, sroom;

  set local role authenticated;
  -- ===== Call lifecycle =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.call_start(x, 'voice');
    r := r || 'FAIL called someone not matched; ';
  exception when insufficient_privilege then r := r || 'ok only matched members can call each other; ';
  end;
  begin
    perform public.call_start(b, 'fax');
    r := r || 'FAIL unknown mode; ';
  exception when invalid_parameter_value then r := r || 'ok only voice and video calls exist; ';
  end;
  c1 := public.call_start(b, 'voice');
  select status into rec from public.call_sessions where id = c1;
  r := r || case when rec.status = 'ringing' then 'ok a new call rings; ' else 'FAIL status ' || rec.status || '; ' end;
  arr := public.call_join_check(c1);
  r := r || case when cardinality(arr) = 0 then 'ok the caller may connect while it rings; ' else 'FAIL caller ' || arr::text || '; ' end;
  begin
    perform public.call_start(b, 'video');
    r := r || 'FAIL second simultaneous call; ';
  exception when raise_exception then r := r || 'ok one call at a time; ';
  end;
  begin
    perform public.call_answer(c1, true);
    r := r || 'FAIL caller answered own call; ';
  exception when insufficient_privilege then r := r || 'ok only the callee can answer; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  arr := public.call_join_check(c1);
  r := r || case when 'call_not_active' = any (arr) then 'ok the callee cannot connect before accepting; ' else 'FAIL callee early; ' end;
  select count(*) into n from public.call_sessions where id = c1;
  r := r || case when n = 1 then 'ok the callee sees the incoming call; ' else 'FAIL callee cannot see call; ' end;
  r := r || case when public.call_answer(c1, true) = 'accepted' then 'ok answering returns the new status; ' else 'FAIL answer status; ' end;
  arr := public.call_join_check(c1);
  r := r || case when cardinality(arr) = 0 then 'ok after accepting both may connect; ' else 'FAIL after accept ' || arr::text || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  arr := public.call_join_check(c1);
  select count(*) into n from public.call_sessions where id = c1;
  r := r || case when 'call_not_found' = any (arr) and n = 0 then 'ok outsiders cannot see or join a call; ' else 'FAIL outsider; ' end;
  select count(*) into n from public.call_room(c1);
  r := r || case when n = 0 then 'ok outsiders get no room name; ' else 'FAIL outsider room; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select room_name into room from public.call_room(c1);
  r := r || case when room = public.call_hangup(c1) then 'ok hanging up returns the room to close; ' else 'FAIL hangup room; ' end;
  select status into rec from public.call_sessions where id = c1;
  r := r || case when rec.status = 'ended' then 'ok hanging up ends the call; ' else 'FAIL hangup ' || rec.status || '; ' end;
  -- Decline and cancel
  c2 := public.call_start(b, 'video');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.call_answer(c2, false);
  select status into rec from public.call_sessions where id = c2;
  r := r || case when rec.status = 'rejected' then 'ok the callee can decline; ' else 'FAIL decline; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  c3 := public.call_start(b, 'voice');
  perform public.call_hangup(c3);
  select status into rec from public.call_sessions where id = c3;
  r := r || case when rec.status = 'cancelled' then 'ok the caller can cancel while ringing; ' else 'FAIL cancel; ' end;
  reset role;
  -- Missed after 45 seconds
  update public.call_sessions set status = 'ringing', ended_at = null where id = c3;
  update public.call_sessions set created_at = now() - interval '2 minutes' where id = c3;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := r || case when public.call_answer(c3, true) = 'missed' then 'ok unanswered calls become missed after 45 seconds; '
                 else 'FAIL answered an expired call; ' end;
  select status into rec from public.call_sessions where id = c3;
  r := r || case when rec.status = 'missed' then 'ok the missed call is recorded; ' else 'FAIL missed ' || rec.status || '; ' end;
  begin
    update public.call_sessions set status = 'accepted' where id = c3;
    get diagnostics n = row_count;
    r := r || case when n = 0 then 'ok clients cannot change call status; ' else 'FAIL client changed status; ' end;
  exception when insufficient_privilege then r := r || 'ok clients cannot change call status; ';
  end;
  reset role;

  -- ===== Webhooks, presence and billing =====
  set local role anon;
  begin
    perform public.live_webhook_ingest('wrong-secret-wrong-secret-wrong-secret', '{"event":"room_finished","id":"EV_bad"}');
    r := r || 'FAIL wrong webhook secret accepted; ';
  exception when insufficient_privilege then r := r || 'ok webhook ingest needs the integration secret; ';
  end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  c1 := public.call_start(b, 'voice');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.call_answer(c1, true);
  select room_name into room from public.call_room(c1);
  reset role;
  t := date_trunc('second', now()) - interval '10 minutes';
  set local role anon;
  js := public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_1',
          'createdAt', extract(epoch from t)::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', a::text)));
  r := r || case when (js ->> 'kick')::boolean = false then 'ok a call party joining is allowed; ' else 'FAIL party kicked; ' end;
  js := public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_1',
          'createdAt', extract(epoch from t)::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', a::text)));
  r := r || case when (js ->> 'duplicate')::boolean then 'ok repeated webhook deliveries are ignored; ' else 'FAIL duplicate; ' end;
  js := public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_X',
          'createdAt', extract(epoch from t)::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', x::text)));
  r := r || case when (js ->> 'kick')::boolean then 'ok an outsider who reaches a call room is removed at once; ' else 'FAIL outsider stays; ' end;
  js := public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_2',
          'createdAt', extract(epoch from t + interval '5 seconds')::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', b::text)));
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_left', 'id', 'EV_3',
          'createdAt', extract(epoch from t + interval '65 seconds')::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', b::text)));
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_left', 'id', 'EV_4',
          'createdAt', extract(epoch from t + interval '70 seconds')::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', a::text)));
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'room_finished', 'id', 'EV_5',
          'createdAt', extract(epoch from t + interval '71 seconds')::bigint::text, 'room', jsonb_build_object('name', room)));
  reset role;
  select * into rec from public.call_sessions where id = c1;
  r := r || case when rec.billable_seconds = 60 then 'ok billing counts only time both people were connected (60 s); '
                 else 'FAIL billable ' || coalesce(rec.billable_seconds, -1) || '; ' end;
  r := r || case when rec.tokens_due = 10 and rec.billing_status = 'not_charged' and coalesce(rec.tokens_charged, 0) = 0
                 then 'ok voice is priced at 10 tokens a minute and not charged while metering is off; '
                 else 'FAIL due ' || rec.tokens_due || ' ' || rec.billing_status || '; ' end;
  select balance into n from public.token_wallets where user_id = a;
  r := r || case when n = 100 then 'ok no tokens move while metering is off; ' else 'FAIL balance ' || n || '; ' end;

  -- Charging path (switched on only inside this rolled-back test).
  update public.metering_rates set call_metering_enabled = true;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  c2 := public.call_start(b, 'video');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.call_answer(c2, true);
  select room_name into room from public.call_room(c2);
  reset role;
  set local role anon;
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_V1',
          'createdAt', extract(epoch from t)::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', a::text)));
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_V2',
          'createdAt', extract(epoch from t)::bigint::text, 'room', jsonb_build_object('name', room),
          'participant', jsonb_build_object('identity', b::text)));
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'room_finished', 'id', 'EV_V3',
          'createdAt', extract(epoch from t + interval '30 seconds')::bigint::text, 'room', jsonb_build_object('name', room)));
  -- The same room_finished delivered again with a new id (provider retry) must not charge twice.
  perform public.live_webhook_ingest(secret, jsonb_build_object('event', 'room_finished', 'id', 'EV_V4',
          'createdAt', extract(epoch from t + interval '40 seconds')::bigint::text, 'room', jsonb_build_object('name', room)));
  reset role;
  select * into rec from public.call_sessions where id = c2;
  select balance into n from public.token_wallets where user_id = a;
  r := r || case when rec.billing_status = 'charged' and rec.tokens_charged = 30 and n = 70
                 then 'ok video is charged 1 token a second from server events, once; '
                 else 'FAIL video charge ' || rec.billing_status || ' ' || rec.tokens_charged || ' bal ' || n || '; ' end;
  select count(*) into n from public.token_ledger where idempotency_key = 'call:' || c2;
  r := r || case when n = 1 then 'ok one ledger entry per call; ' else 'FAIL ledger entries ' || n || '; ' end;
  update public.token_wallets set balance = 5 where user_id = a; -- test-only shortcut to a low balance
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.call_start(b, 'voice');
    r := r || 'FAIL call started without a minute of tokens; ';
  exception when raise_exception then r := r || 'ok with metering on, a call needs at least one minute of tokens; ';
  end;
  reset role;
  update public.metering_rates set call_metering_enabled = false;

  -- ===== Blocks, suspension and unmatching remove people from rooms =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  c3 := public.call_start(b, 'voice');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.call_answer(c3, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.blocks (blocker_id, blocked_id) values (a, b);
  reset role;
  select * into rec from public.call_sessions where id = c3;
  select count(*) into n from private.room_kicks where room_name = rec.room_name and done_at is null;
  r := r || case when rec.status = 'ended' and rec.end_reason = 'blocked' and n = 2
                 then 'ok blocking ends the call and removes both people from the room; '
                 else 'FAIL block ' || rec.status || ' kicks ' || n || '; ' end;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.call_start(b, 'voice');
    r := r || 'FAIL called a blocked person; ';
  exception when insufficient_privilege then r := r || 'ok blocked people cannot be called; ';
  end;
  delete from public.blocks where blocker_id = a and blocked_id = b;
  reset role;
  -- Viewer in a live stream, then suspended.
  set local role anon;
  js := public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_S1',
          'createdAt', extract(epoch from now())::bigint::text, 'room', jsonb_build_object('name', sroom),
          'participant', jsonb_build_object('identity', v::text)));
  r := r || case when (js ->> 'kick')::boolean = false then 'ok viewers may join a live stream room; ' else 'FAIL viewer kicked; ' end;
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_suspend_account(v, 'Live test');
  reset role;
  select count(*) into n from private.room_kicks k join public.live_streams s on s.room_name = k.room_name
  where s.id = st and k.identity = v and k.reason = 'suspended';
  r := r || case when n = 1 then 'ok suspension removes the person from live rooms they are in; ' else 'FAIL suspension kicks ' || n || '; ' end;
  set local role anon;
  js := public.live_webhook_ingest(secret, jsonb_build_object('event', 'participant_joined', 'id', 'EV_S2',
          'createdAt', extract(epoch from now())::bigint::text, 'room', jsonb_build_object('name', sroom),
          'participant', jsonb_build_object('identity', v::text)));
  r := r || case when (js ->> 'kick')::boolean then 'ok a suspended person rejoining a room is removed at once; ' else 'FAIL suspended rejoined; ' end;
  -- Kick queue claim/done
  select array_agg(k.id) into ids from public.live_kicks_claim(secret, 50) k;
  n := coalesce(cardinality(ids), 0);
  r := r || case when n >= 3 then 'ok the API can claim pending removals; ' else 'FAIL claimed ' || n || '; ' end;
  select count(*) into n from public.live_kicks_claim(secret, 50);
  r := r || case when n = 0 then 'ok claimed removals are not handed out twice at once; ' else 'FAIL reclaimed ' || n || '; ' end;
  perform public.live_kicks_done(secret, ids);
  begin
    perform public.live_kicks_claim('nope-nope-nope-nope-nope-nope-nope-nope', 5);
    r := r || 'FAIL kicks claimed without secret; ';
  exception when insufficient_privilege then r := r || 'ok the removal queue needs the integration secret; ';
  end;
  reset role;
  -- Unmatching ends calls.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  c3 := public.call_start(b, 'video');
  delete from public.matches where user_a = least(a, b) and user_b = greatest(a, b);
  reset role;
  select status into rec from public.call_sessions where id = c3;
  r := r || case when rec.status = 'ended' then 'ok unmatching ends a call; ' else 'FAIL unmatch ' || rec.status || '; ' end;

  -- ===== Live chat and reactions =====
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  insert into public.live_chat_messages (stream_id, sender_id, body) values (st, x, 'Lovely song!') returning id into msg;
  r := r || 'ok viewers can chat in a live stream; ';
  begin
    insert into public.live_chat_messages (stream_id, sender_id, body) values (st, x, 'escort services available'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL prohibited chat accepted; ';
  exception when check_violation then r := r || 'ok live chat is screened for prohibited content; ';
  end;
  begin
    for n in 1..6 loop
      insert into public.live_chat_messages (stream_id, sender_id, body) values (st, x, 'hi ' || n);
    end loop;
    r := r || 'FAIL chat flood; ';
  exception when raise_exception then r := r || 'ok live chat is rate limited; ';
  end;
  perform public.live_react(st, 'heart');
  begin
    perform public.live_react(st, 'kiss');
    r := r || 'FAIL unknown reaction; ';
  exception when check_violation then r := r || 'ok only listed reactions are allowed; ';
  end;
  begin
    perform public.live_chat_hide(msg);
    r := r || 'FAIL viewer hid a message; ';
  exception when insufficient_privilege then r := r || 'ok viewers cannot moderate chat; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  perform public.live_chat_hide(msg);
  perform public.live_chat_mute(st, x, 10);
  perform set_config('request.jwt.claims', json_build_object('sub', x, 'role', 'authenticated')::text, true);
  begin
    insert into public.live_chat_messages (stream_id, sender_id, body) values (st, x, 'muted?');
    r := r || 'FAIL muted user posted; ';
  exception when insufficient_privilege then r := r || 'ok the host can hide messages and mute chatters; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_chat_messages where id = msg;
  r := r || case when n = 0 then 'ok hidden messages disappear for other viewers; ' else 'FAIL hidden visible; ' end;
  insert into public.blocks (blocker_id, blocked_id) values (a, x);
  select count(*) into n from public.live_chat_messages where sender_id = x;
  r := r || case when n = 0 then 'ok you never see chat from people you blocked; ' else 'FAIL blocked chat visible ' || n || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  begin
    insert into public.live_chat_messages (stream_id, sender_id, body) values (st, v, 'still here');
    r := r || 'FAIL suspended chatter; ';
  exception when insufficient_privilege then r := r || 'ok suspended accounts cannot chat; ';
  end;

  -- ===== Multi-guest =====
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.live_invite_guest(st, g);
    r := r || 'FAIL non-creator invited; ';
  exception when insufficient_privilege then r := r || 'ok only the creator invites guests; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  begin
    perform public.live_invite_guest(st, a);
    r := r || 'FAIL invited a non-creator; ';
  exception when invalid_parameter_value then r := r || 'ok guests must be approved creators; ';
  end;
  inv := public.live_invite_guest(st, g);
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  perform public.live_answer_guest_invite(inv, true);
  select count(*) into n from public.live_streams where id = st and g = any (participants);
  r := r || case when n = 1 then 'ok an accepted guest becomes a co-host; ' else 'FAIL guest not added; ' end;
  ok := public.live_host_check(st);
  r := r || case when not ok then 'ok guests cannot control the room; ' else 'FAIL guest controls; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  ok := public.live_host_check(st);
  r := r || case when ok then 'ok the creator controls the room; ' else 'FAIL creator host check; ' end;
  perform public.live_remove_guest(st, g);
  reset role;
  select count(*) into n from public.live_streams where id = st and g = any (participants);
  select (n = 0) and exists (select 1 from private.room_kicks k where k.identity = g and k.reason = 'removed_by_host') into ok;
  r := r || case when ok then 'ok removing a guest takes them off the stream and out of the room; ' else 'FAIL guest removal; ' end;
  -- Limit of 4 guests
  for n in 1..4 loop
    insert into auth.users (id, email) values (gen_random_uuid(), 'guest' || n || '@calls.test');
  end loop;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
    select id, 'Guest', 30, 'friendship', 18, 60 from auth.users where email like 'guest_@calls.test';
  insert into public.creators (user_id, stage_name, country_code, categories, status)
    select id, 'Guest Star', 'IN', array[cat], 'approved' from auth.users where email like 'guest_@calls.test';
  select array_agg(id) into guests from auth.users where email like 'guest_@calls.test';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  for i in 1..cardinality(guests) loop
    perform public.live_invite_guest(st, guests[i]);
  end loop;
  begin
    perform public.live_invite_guest(st, g);
    r := r || 'FAIL fifth guest; ';
  exception when raise_exception then r := r || 'ok a stream has at most 4 guests; ';
  end;
  r := r || case when public.live_viewer_cap() = 300 then 'ok the WebRTC viewer cap is 300 by default; ' else 'FAIL cap; ' end;
  reset role;

  -- ===== BKG-02: bookings and blocks =====
  insert into public.companion_profiles (user_id, headline, city, status, verified) values (b, 'City walks guide', 'Pune', 'approved', true);
  insert into public.companion_services (companion_id, category, title, pricing, price_inr) values (b, 'coffee', 'Coffee chat', 'hourly', 500)
    returning id into svc;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute, timezone)
    select b, d, 0, 1440, 'Asia/Kolkata' from generate_series(0, 6) d;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', g, 'role', 'authenticated')::text, true);
  bk := public.booking_request(svc, (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '4 days 11 hours') at time zone 'Asia/Kolkata',
                               60, 'Cafe on FC Road', '', 'calls-test-bk1');
  reset role;
  insert into public.blocks (blocker_id, blocked_id) values (g, b);
  select status into rec from public.bookings where id = bk;
  r := r || case when rec.status = 'cancelled' then 'ok blocking cancels open bookings between the two; ' else 'FAIL booking after block ' || rec.status || '; ' end;
  update public.bookings set status = 'requested' where id = bk;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_respond(bk, 'accept', null);
    r := r || 'FAIL accepted a blocked booking; ';
  exception when raise_exception then r := r || 'ok a booking with a blocked person cannot be accepted; ';
  end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
