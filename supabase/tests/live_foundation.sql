-- SOULMATE LIVE foundation test: roles, provider terms, country and explicit
-- rules (India locked), creator approval, verification, consent, watching,
-- emergency stop, reports, appeals and the audit log.
-- Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();  -- admin
  cr uuid := gen_random_uuid();   -- creator verified in US
  ind uuid := gen_random_uuid();  -- creator verified in India
  co uuid := gen_random_uuid();   -- co-performer
  vw uuid := gen_random_uuid();   -- viewer
  out_ uuid := gen_random_uuid(); -- unrelated member
  r text := ''; n int; t text; arr text[]; s_safe uuid; s_x uuid; s_in uuid; sess uuid;
  claims text;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@live.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, cr, ind, co, vw, out_]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, cr, ind, co, vw, out_]) u;
  -- Bootstrap the first admin (done once by the owner in SQL).
  insert into private.user_roles (user_id, role) values (adm, 'admin');

  set local role authenticated;

  -- ---- Roles: non-admins can't manage anything ----
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_upsert_provider('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', 'LIVEKIT',
      '{}', '{talk}', true, false, 'signed', 'C-1', true, true, 'enabled', null);
    r := r || 'FAIL member configured a provider; ';
  exception when insufficient_privilege then r := r || 'ok members cannot configure providers; ';
  end;
  begin
    perform 1 from public.live_providers;
    r := r || 'FAIL member read providers table; ';
  exception when insufficient_privilege then r := r || 'ok provider table not readable; ';
  end;
  begin
    perform public.admin_set_role(out_, 'admin', true);
    r := r || 'FAIL member made themselves admin; ';
  exception when insufficient_privilege then r := r || 'ok cannot self-grant admin; ';
  end;
  select coalesce(cardinality(public.my_live_roles()), 0) into n;
  r := r || case when n = 0 then 'ok member has no roles; ' else 'FAIL roles ' || n || '; ' end;

  -- ---- Provider terms gate ----
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_upsert_provider('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', 'LIVEKIT',
      '{}', '{talk,adult}', true, true, 'negotiating', null, false, false, 'enabled', null);
    r := r || 'FAIL enabled provider without signed terms; ';
  exception when check_violation then r := r || 'ok provider needs signed, reviewed terms; ';
  end;
  begin
    perform public.admin_upsert_provider('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', 'LIVEKIT',
      '{}', '{talk,adult}', false, true, 'signed', 'C-1', true, true, 'enabled', null);
    r := r || 'FAIL enabled provider without commercial use; ';
  exception when check_violation then r := r || 'ok provider needs commercial-use permission; ';
  end;
  begin
    perform public.admin_upsert_provider('bad', 'Bad', 'webrtc_sfu', 'http://insecure.example', null,
      '{}', '{}', false, false, 'none', null, false, false, 'disabled', null);
    r := r || 'FAIL insecure endpoint accepted; ';
  exception when check_violation then r := r || 'ok https/wss endpoints only; ';
  end;
  perform public.admin_upsert_provider('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', 'LIVEKIT',
    '{}', '{talk,adult}', true, true, 'signed', 'Contract C-1 (2026-10-30)', true, true, 'enabled', null);
  select count(*) into n from public.admin_list_providers() where integration_status = 'enabled';
  r := r || case when n = 1 then 'ok provider enabled with signed terms; ' else 'FAIL provider not enabled; ' end;

  -- ---- Country policy: India locked, others need clearance ----
  begin
    perform public.admin_set_country_policy('IN', true, true, true, 'Opinion 1', null);
    r := r || 'FAIL explicit enabled in India; ';
  exception when check_violation then r := r || 'ok explicit can never be enabled in India; ';
  end;
  begin
    perform public.admin_set_country_policy('US', true, true, true, null, null);
    r := r || 'FAIL explicit without clearance; ';
  exception when check_violation then r := r || 'ok explicit needs recorded legal clearance; ';
  end;
  perform public.admin_set_country_policy('US', true, true, true, 'Written legal opinion LO-7', 'test');
  perform public.admin_set_agreement('2026.1', 'Creator agreement', 'https://example.com/creator-agreement', true);

  -- ---- Creators apply; cannot approve or pay themselves ----
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  insert into public.creators (user_id, stage_name, country_code, categories) values (cr, 'Riya Live', 'US', '{talk,adult}');
  begin
    update public.creators set status = 'approved' where user_id = cr;
    r := r || 'FAIL creator approved themselves; ';
  exception when insufficient_privilege then r := r || 'ok creators cannot approve themselves; ';
  end;
  begin
    update public.creators set revenue_share_pct = 99 where user_id = cr;
    r := r || 'FAIL creator set revenue share; ';
  exception when insufficient_privilege then r := r || 'ok creators cannot set revenue share; ';
  end;
  begin
    insert into public.live_streams (creator_id, provider_key, title, category) values (cr, 'livekit', 'Too early', 'talk');
    r := r || 'FAIL unapproved creator scheduled; ';
  exception when insufficient_privilege then r := r || 'ok unapproved creators cannot schedule; ';
  end;
  perform public.live_accept_agreement('2026.1');

  perform set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  insert into public.creators (user_id, stage_name, country_code, categories) values (ind, 'Delhi Live', 'IN', '{talk,adult}');
  perform public.live_accept_agreement('2026.1');
  perform set_config('request.jwt.claims', json_build_object('sub', co, 'role', 'authenticated')::text, true);
  insert into public.creators (user_id, stage_name, country_code, categories) values (co, 'Co Star', 'US', '{talk,adult}');
  perform public.live_accept_agreement('2026.1');

  -- ---- Approval needs verification ----
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_review_creator(cr, 'approved', null);
    r := r || 'FAIL approved without verification; ';
  exception when invalid_parameter_value then r := r || 'ok approval needs identity and age checks; ';
  end;
  begin
    perform public.admin_record_verification(cr, 'age', 'VerifyCo', 'case-1', 'passed', 'US', false, null);
    r := r || 'FAIL passed age check without over-18; ';
  exception when check_violation then r := r || 'ok passed age check must be 18+; ';
  end;
  perform public.admin_record_verification(cr, 'identity', 'VerifyCo', 'case-2', 'passed', 'US', null, null);
  perform public.admin_record_verification(cr, 'age', 'VerifyCo', 'case-3', 'passed', 'US', true, null);
  perform public.admin_record_verification(ind, 'identity', 'VerifyCo', 'case-4', 'passed', 'IN', null, null);
  perform public.admin_record_verification(ind, 'age', 'VerifyCo', 'case-5', 'passed', 'IN', true, null);
  perform public.admin_record_verification(co, 'identity', 'VerifyCo', 'case-6', 'passed', 'US', null, null);
  perform public.admin_record_verification(co, 'age', 'VerifyCo', 'case-7', 'passed', 'US', true, null);
  perform public.admin_review_creator(cr, 'approved', null);
  perform public.admin_review_creator(ind, 'approved', null);
  perform public.admin_review_creator(co, 'approved', null);
  r := r || 'ok verified creators approved; ';

  -- ---- Streams: safe stream goes live ----
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  insert into public.live_streams (creator_id, provider_key, title, category) values (cr, 'livekit', 'Sunday chat', 'talk')
    returning id into s_safe;
  arr := public.live_start_stream(s_safe);
  r := r || case when cardinality(arr) = 0 then 'ok verified creator goes live; ' else 'FAIL start ' || array_to_string(arr, ',') || '; ' end;

  -- Explicit stream with a co-performer who hasn't consented.
  insert into public.live_streams (creator_id, provider_key, title, category, participants)
    values (cr, 'livekit', 'Late show', 'adult', array[co]) returning id into s_x;
  arr := public.live_broadcast_check(s_x);
  r := r || case when exists (select 1 from unnest(arr) x where x like 'participant_consent_missing:%')
              then 'ok co-performer consent required; ' else 'FAIL no consent check ' || array_to_string(arr, ',') || '; ' end;
  begin
    perform public.live_give_consent(s_x, 'I agree to appear', 'esign-1');
    r := r || 'FAIL creator gave consent for co-performer; ';
  exception when insufficient_privilege then r := r || 'ok only the participant can consent; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', co, 'role', 'authenticated')::text, true);
  perform public.live_give_consent(s_x, 'I agree to appear in this stream', 'esign-2');
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  arr := public.live_start_stream(s_x);
  r := r || case when cardinality(arr) = 0 then 'ok explicit stream live where cleared; ' else 'FAIL x start ' || array_to_string(arr, ',') || '; ' end;

  -- India creator cannot go live with explicit content.
  perform set_config('request.jwt.claims', json_build_object('sub', ind, 'role', 'authenticated')::text, true);
  insert into public.live_streams (creator_id, provider_key, title, category) values (ind, 'livekit', 'Nope', 'adult')
    returning id into s_in;
  arr := public.live_start_stream(s_in);
  r := r || case when 'explicit_not_allowed_in_country' = any (arr) then 'ok explicit blocked for creators in India; '
              else 'FAIL india ' || array_to_string(arr, ',') || '; ' end;
  begin
    update public.live_streams set status = 'live' where id = s_in;
    r := r || 'FAIL creator set status directly; ';
  exception when insufficient_privilege then r := r || 'ok status only changes through checks; ';
  end;

  -- ---- Watching ----
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  arr := public.live_watch_check(s_safe, 'IN');
  r := r || case when cardinality(arr) = 0 then 'ok safe stream watchable in India; ' else 'FAIL safe ' || array_to_string(arr, ',') || '; ' end;
  arr := public.live_watch_check(s_x, 'US');
  r := r || case when 'viewer_age_not_verified' = any (arr) then 'ok explicit needs viewer age check; ' else 'FAIL viewer age; ' end;
  arr := public.live_watch_check(s_x, 'IN');
  r := r || case when 'explicit_not_allowed_in_country' = any (arr) then 'ok explicit blocked for viewers in India; ' else 'FAIL viewer IN; ' end;
  arr := public.live_watch_check(s_x, null);
  r := r || case when 'country_unknown' = any (arr) then 'ok unknown country fails closed; ' else 'FAIL unknown country; ' end;
  arr := public.live_watch_check(s_safe, 'FR');
  r := r || case when 'country_not_allowed' = any (arr) then 'ok countries without a policy get nothing; ' else 'FAIL FR; ' end;
  select count(*) into n from public.live_streams where id = s_x;
  r := r || case when n = 0 then 'ok explicit stream not readable directly; ' else 'FAIL explicit readable; ' end;
  select count(*) into n from public.live_list_streams('IN') where explicit;
  r := r || case when n = 0 then 'ok India list has no explicit streams; ' else 'FAIL India list explicit ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_record_viewer_age(vw, 'VerifyCo', 'case-v1', 'passed', 'US', true);
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  arr := public.live_watch_check(s_x, 'US');
  r := r || case when cardinality(arr) = 0 then 'ok verified adult in cleared country can watch; ' else 'FAIL vw ' || array_to_string(arr, ',') || '; ' end;
  select count(*) into n from public.live_list_streams('US') where explicit;
  r := r || case when n = 1 then 'ok cleared viewer sees explicit listing; ' else 'FAIL cleared list ' || n || '; ' end;
  arr := public.live_watch_check(s_in, 'US');
  r := r || case when 'explicit_not_allowed_in_creator_country' = any (arr)
              then 'ok explicit from creators in India is never shown; ' else 'FAIL india creator watch; ' end;

  -- Blocks apply to live.
  insert into public.blocks (blocker_id, blocked_id) values (vw, cr);
  arr := public.live_watch_check(s_safe, 'IN');
  r := r || case when 'blocked' = any (arr) then 'ok blocks apply to live; ' else 'FAIL block; ' end;
  delete from public.blocks where blocker_id = vw;

  -- ---- Private sessions ----
  insert into public.private_sessions (creator_id, viewer_id, mode, category, provider_key)
    values (cr, vw, 'video', 'talk', 'livekit') returning id into sess;
  arr := public.live_session_check(sess, 'IN');
  r := r || case when 'session_not_accepted' = any (arr) then 'ok session needs creator acceptance; ' else 'FAIL session ' || array_to_string(arr, ',') || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  perform public.live_answer_session(sess, true);
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  arr := public.live_session_check(sess, 'IN');
  r := r || case when cardinality(arr) = 0 then 'ok accepted session joinable; ' else 'FAIL accepted ' || array_to_string(arr, ',') || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  arr := public.live_session_check(sess, 'IN');
  r := r || case when arr = array['session_not_found'] then 'ok outsiders cannot join sessions; ' else 'FAIL outsider session; ' end;
  select count(*) into n from public.private_sessions;
  r := r || case when n = 0 then 'ok sessions are private; ' else 'FAIL saw sessions; ' end;

  -- ---- Reports ----
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  insert into public.live_reports (reporter_id, stream_id, reason, details) values (vw, s_safe, 'minor', 'Looks under 18');
  select priority into t from public.live_reports where reporter_id = vw;
  r := r || case when t = 'urgent' then 'ok reports about minors are urgent; ' else 'FAIL priority ' || coalesce(t, 'null') || '; ' end;
  begin
    insert into public.live_reports (reporter_id, stream_id, reason, status) values (vw, s_safe, 'spam_or_scam', 'dismissed');
    r := r || 'FAIL reporter set status; ';
  exception when insufficient_privilege then r := r || 'ok reporters cannot set status; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  select count(*) into n from public.live_reports;
  r := r || case when n = 0 then 'ok creators cannot see reports about them; ' else 'FAIL report leak; ' end;
  begin
    perform 1 from public.admin_list_reports();
    r := r || 'FAIL creator listed reports; ';
  exception when insufficient_privilege then r := r || 'ok report queue is moderators only; ';
  end;

  -- ---- Emergency stop ----
  begin
    perform public.admin_set_emergency_stop(true, 'test');
    r := r || 'FAIL creator pressed emergency stop; ';
  exception when insufficient_privilege then r := r || 'ok emergency stop is moderators only; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_set_role(out_, 'moderator', true);
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  perform public.admin_set_emergency_stop(true, 'Drill');
  select count(*) into n from public.live_streams where status = 'live';
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  arr := public.live_watch_check(s_safe, 'IN');
  r := r || case when n = 0 and 'emergency_stop' = any (arr) then 'ok emergency stop ends streams and blocks joins; '
              else 'FAIL emergency ' || n || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  perform public.admin_set_emergency_stop(false, 'Drill over');

  -- ---- Suspension and appeals ----
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  begin
    insert into public.creator_appeals (creator_id, statement) values (cr, 'I was not suspended but appeal anyway');
    r := r || 'FAIL appeal while approved; ';
  exception when insufficient_privilege then r := r || 'ok only suspended creators appeal; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_review_creator(cr, 'suspended', 'Policy review');
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  insert into public.creator_appeals (creator_id, statement) values (cr, 'Please review again, I followed the rules.');
  arr := public.live_broadcast_check(s_x);
  r := r || case when 'stream_not_open' = any (arr) or 'creator_not_approved' = any (arr)
              then 'ok suspension ends streams; ' else 'FAIL suspension; ' end;

  -- ---- Audit log ----
  begin
    perform 1 from public.moderation_actions;
    r := r || 'FAIL log readable directly; ';
  exception when insufficient_privilege then r := r || 'ok log not directly readable; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.admin_moderation_log(1000);
  r := r || case when n >= 15 then 'ok actions are logged; ' else 'FAIL log entries ' || n || '; ' end;
  begin
    perform public.admin_set_role(adm, 'admin', false);
    r := r || 'FAIL admin removed own admin role; ';
  exception when insufficient_privilege then r := r || 'ok admins cannot lock themselves out; ';
  end;

  -- ---- Visitors ----
  reset role;
  set local role anon;
  begin
    perform public.live_list_streams('US');
    r := r || 'FAIL visitors listed streams; ';
  exception when insufficient_privilege then r := r || 'ok visitors cannot list streams; ';
  end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
