-- RentMate supports no adult, pornographic or sexually explicit content.
-- Checks migration 20261118090000_no_adult_content: nothing is deleted, but adult content can never be
-- enabled in any country or used by a creator, stream or private session.
-- Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();
  cr uuid := gen_random_uuid();
  vw uuid := gen_random_uuid();
  r text := ''; n int; b boolean;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@noadult.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, cr, vw]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, cr, vw]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');

  -- Existing content is kept, not deleted.
  select count(*) into n from public.content_categories where key = 'adult';
  r := r || case when n = 1 then 'ok adult category row kept for history; ' else 'FAIL adult row missing; ' end;
  select available into b from public.content_categories where key = 'adult';
  r := r || case when b = false then 'ok adult category unavailable; ' else 'FAIL adult available; ' end;
  begin
    update public.content_categories set available = true where key = 'adult';
    r := r || 'FAIL adult category re-enabled; ';
  exception when check_violation then r := r || 'ok explicit categories can never be made available; ';
  end;
  select count(*) into n from public.content_categories where not explicit and available;
  r := r || case when n >= 5 then 'ok ordinary categories still available; ' else 'FAIL ordinary categories ' || n || '; ' end;

  set local role authenticated;

  -- Admins cannot enable adult content in any country, with or without a legal reference.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_set_country_policy('GB', true, true, true, 'Legal opinion LO-1', null);
    r := r || 'FAIL adult enabled in GB; ';
  exception when check_violation then r := r || 'ok adult content cannot be enabled in GB; ';
  end;
  begin
    perform public.admin_set_country_policy('US', true, true, true, 'Legal opinion LO-2', null);
    r := r || 'FAIL adult enabled in US; ';
  exception when check_violation then r := r || 'ok adult content cannot be enabled in US; ';
  end;
  perform public.admin_set_country_policy('US', true, true, false, null, 'live without adult content');
  r := r || 'ok normal country policy still saves; ';
  perform public.admin_set_agreement('2026.1', 'Creator agreement', 'https://example.com/creator-agreement', true);
  perform public.admin_upsert_provider('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', 'LIVEKIT',
    '{}', '{talk,music}', true, true, 'signed', 'Contract C-1 (2026-10-30)', true, true, 'enabled', null);

  -- Creators cannot apply with an adult or unknown category; ordinary categories work.
  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  begin
    insert into public.creators (user_id, stage_name, country_code, categories) values (cr, 'Riya', 'US', '{talk,adult}');
    r := r || 'FAIL creator applied with adult category; ';
  exception when check_violation then r := r || 'ok creators cannot apply with adult content; ';
  end;
  begin
    insert into public.creators (user_id, stage_name, country_code, categories) values (cr, 'Riya', 'US', '{made_up}');
    r := r || 'FAIL unknown category accepted; ';
  exception when check_violation then r := r || 'ok unknown categories rejected; ';
  end;
  insert into public.creators (user_id, stage_name, country_code, categories) values (cr, 'Riya', 'US', '{talk,music}');
  r := r || 'ok creators apply with ordinary categories; ';
  begin
    update public.creators set categories = '{talk,adult}' where user_id = cr;
    r := r || 'FAIL adult added later; ';
  exception when check_violation then r := r || 'ok adult cannot be added later; ';
  end;
  perform public.live_accept_agreement('2026.1');

  -- Approve the creator (verified), then try adult streams and sessions.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_record_verification(cr, 'identity', 'VerifyCo', 'case-na1', 'passed', 'US', null, null);
  perform public.admin_record_verification(cr, 'age', 'VerifyCo', 'case-na2', 'passed', 'US', true, null);
  perform public.admin_review_creator(cr, 'approved', null);

  perform set_config('request.jwt.claims', json_build_object('sub', cr, 'role', 'authenticated')::text, true);
  begin
    insert into public.live_streams (creator_id, provider_key, title, category) values (cr, 'livekit', 'x', 'adult');
    r := r || 'FAIL adult stream scheduled; ';
  exception when check_violation then r := r || 'ok adult streams cannot be scheduled; ';
  end;
  insert into public.live_streams (creator_id, provider_key, title, category) values (cr, 'livekit', 'Sunday chat', 'talk');
  r := r || 'ok ordinary streams still schedule; ';
  begin
    update public.live_streams set category = 'adult' where creator_id = cr;
    r := r || 'FAIL stream switched to adult; ';
  exception when check_violation or insufficient_privilege then r := r || 'ok streams cannot switch to adult; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  begin
    insert into public.private_sessions (creator_id, viewer_id, mode, category, provider_key)
      values (cr, vw, 'video', 'adult', 'livekit');
    r := r || 'FAIL adult private session requested; ';
  exception when check_violation then r := r || 'ok adult private sessions cannot be requested; ';
  end;

  select count(*) into n from public.live_list_streams('US') where explicit;
  r := r || case when n = 0 then 'ok no adult streams listed; ' else 'FAIL adult listed; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
