-- Policy audit (2026-11-18): RentMate supports no pornography, sexually explicit content, adult entertainment,
-- sexual services, escorting or sexual solicitation, anywhere. -- policy-guard: allow (refusal test)
--
-- Tries to bypass the restriction as the database owner (service-role / SQL console), an admin, a creator and a
-- member; checks that legacy records stay intact but unusable; covers text screening, reporting, evidence
-- retention, suspension and appeals. Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();   -- admin
  hc uuid := gen_random_uuid();    -- creator with legacy adult records
  vw uuid := gen_random_uuid();    -- viewer / member
  mb uuid := gen_random_uuid();    -- second member (chat partner, reported person)
  r text := ''; n int; t text; arr text[]; hs uuid; hp uuid; rep uuid; lrep uuid; ap uuid; m uuid;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, hc, vw, mb]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, hc, vw, mb]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin');
  insert into public.creator_agreements (version, title, document_url, active)
    values ('audit-1', 'Creator agreement', 'https://example.com/a', true);
  insert into public.live_providers (key, name, kind, api_endpoint, supported_countries, permitted_categories,
    commercial_use, monetisation, contract_status, contract_reference, terms_authorize_model, terms_reviewed_at,
    terms_reviewed_by, integration_status)
  values ('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', '{}', '{talk}', true, true, 'signed',
    'C-1', true, now(), adm, 'enabled');
  insert into public.country_policies (country_code, live_allowed, private_sessions_allowed, explicit_allowed)
    values ('US', true, true, false) on conflict (country_code) do update set live_allowed = true;

  -- ===== A. Database owner (service role / SQL console) cannot switch adult content on =====
  begin
    update public.content_categories set available = true where key = 'adult';
    r := r || 'FAIL owner re-enabled adult category; ';
  exception when check_violation then r := r || 'ok owner cannot re-enable adult category; ';
  end;
  begin
    insert into public.content_categories (key, label, explicit, available) values ('adult2', 'Adult 2', true, true);
    r := r || 'FAIL owner added available adult category; ';
  exception when check_violation then r := r || 'ok owner cannot add an available adult category; ';
  end;
  begin
    update public.country_policies set explicit_allowed = true, legal_clearance_ref = 'x', cleared_by = adm,
      cleared_at = now() where country_code = 'US';
    r := r || 'FAIL owner enabled adult in a country; ';
  exception when check_violation then r := r || 'ok owner cannot enable adult in any country; ';
  end;
  begin
    update public.live_providers set permitted_categories = '{talk,adult}' where key = 'livekit';
    r := r || 'FAIL provider permitted adult; ';
  exception when check_violation then r := r || 'ok providers cannot be permitted adult content; ';
  end;

  -- ===== B. Legacy prohibited records (imported with triggers off, as an old backup would be) =====
  set local session_replication_role = replica;
  insert into public.creators (user_id, stage_name, country_code, categories, status, agreement_version,
    agreement_accepted_at)
    values (hc, 'Legacy Creator', 'US', '{talk,adult}', 'approved', 'audit-1', now());
  insert into public.creator_verifications (user_id, kind, provider, provider_reference, status, verified_country, over_18)
    values (hc, 'identity', 'VerifyCo', 'leg-1', 'passed', 'US', null), (hc, 'age', 'VerifyCo', 'leg-2', 'passed', 'US', true);
  insert into public.live_streams (creator_id, provider_key, title, category, status, started_at)
    values (hc, 'livekit', 'Legacy adult stream', 'adult', 'live', now()) returning id into hs;
  insert into public.private_sessions (creator_id, viewer_id, mode, category, provider_key, status)
    values (hc, vw, 'video', 'adult', 'livekit', 'accepted') returning id into hp;
  set local session_replication_role = origin;
  select count(*) into n from public.live_streams where id = hs;
  r := r || case when n = 1 then 'ok legacy adult stream record kept; ' else 'FAIL legacy stream lost; ' end;
  select count(*) into n from public.private_sessions where id = hp;
  r := r || case when n = 1 then 'ok legacy adult session record kept; ' else 'FAIL legacy session lost; ' end;

  set local role authenticated;

  -- ===== C. Members cannot touch categories or policies directly =====
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  begin
    update public.content_categories set available = true where key = 'adult';
    r := r || 'FAIL member updated categories; ';
  exception when insufficient_privilege then r := r || 'ok members cannot edit categories; ';
  end;
  begin
    update public.country_policies set explicit_allowed = true where country_code = 'US';
    r := r || 'FAIL member updated policies; ';
  exception when insufficient_privilege then r := r || 'ok members cannot edit country policies; ';
  end;

  -- ===== D. Legacy adult records are unusable by everyone =====
  arr := public.live_watch_check(hs, 'US');
  r := r || case when 'explicit_not_allowed_in_country' = any (arr) then 'ok legacy adult stream cannot be watched; '
              else 'FAIL watch ' || coalesce(array_to_string(arr, ','), 'none') || '; ' end;
  select count(*) into n from public.live_list_streams('US') where id = hs;
  r := r || case when n = 0 then 'ok legacy adult stream never listed; ' else 'FAIL legacy listed; ' end;
  select count(*) into n from public.live_streams where id = hs;
  r := r || case when n = 0 then 'ok legacy adult stream hidden from other members; ' else 'FAIL legacy readable; ' end;
  arr := public.live_session_check(hp, 'US');
  r := r || case when 'explicit_not_allowed_in_country' = any (arr) then 'ok legacy adult session cannot be joined; '
              else 'FAIL session ' || coalesce(array_to_string(arr, ','), 'none') || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', hc, 'role', 'authenticated')::text, true);
  arr := public.live_broadcast_check(hs);
  r := r || case when 'explicit_not_allowed_in_country' = any (arr) then 'ok legacy adult stream cannot broadcast; '
              else 'FAIL broadcast ' || coalesce(array_to_string(arr, ','), 'none') || '; ' end;
  begin
    update public.live_streams set category = 'talk' where id = hs;
    r := r || 'FAIL creator relabelled legacy stream; ';
  exception when insufficient_privilege then r := r || 'ok creators cannot relabel a stream category; ';
  end;
  update public.creators set bio = 'Updated bio' where user_id = hc;
  select count(*) into n from public.creators where user_id = hc and 'adult' = any (categories);
  r := r || case when n = 1 then 'ok legacy creator can edit other fields and history is unchanged; ' else 'FAIL creator history; ' end;

  -- Admin cannot enable adult content or approve it through admin functions.
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_set_country_policy('US', true, true, true, 'Opinion LO-9', null);
    r := r || 'FAIL admin enabled adult; ';
  exception when check_violation then r := r || 'ok admin cannot enable adult content; ';
  end;
  begin
    perform public.admin_upsert_provider('livekit', 'LiveKit', 'webrtc_sfu', 'wss://example.livekit.cloud', 'LIVEKIT',
      '{}', '{talk,adult}', true, true, 'signed', 'C-1', true, true, 'enabled', null);
    r := r || 'FAIL admin permitted adult for provider; ';
  exception when check_violation then r := r || 'ok admin cannot permit adult for a provider; ';
  end;
  perform public.live_terminate_stream(hs, 'Prohibited content (legacy)');
  select count(*) into n from public.admin_list_streams() where id = hs and status = 'terminated';
  r := r || case when n = 1 then 'ok moderators terminate legacy stream and the record stays; ' else 'FAIL terminate; ' end;

  -- ===== E. Text screening (bios, prompts, names, chat, Super Like notes, creator text, stream titles) =====
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  begin
    update public.profiles set bio = 'Escort services available, DM me' where id = vw; -- policy-guard: allow (refusal test)
    r := r || 'FAIL escort bio saved; '; -- policy-guard: allow (refusal test)
  exception when check_violation then r := r || 'ok escorting wording blocked in bios; ';
  end;
  begin
    update public.profiles set prompts = '[{"q":"Find me","a":"on OnlyFans"}]'::jsonb where id = vw; -- policy-guard: allow (refusal test)
    r := r || 'FAIL onlyfans prompt saved; '; -- policy-guard: allow (refusal test)
  exception when check_violation then r := r || 'ok adult links blocked in prompts; ';
  end;
  begin
    update public.profiles set display_name = 'xxx' where id = vw; -- policy-guard: allow (refusal test)
    r := r || 'FAIL xxx name saved; '; -- policy-guard: allow (refusal test)
  exception when check_violation then r := r || 'ok adult wording blocked in names; ';
  end;
  update public.profiles set bio = 'From Essex, love hiking, chai and Sussex coast walks.' where id = vw;
  r := r || 'ok ordinary bio with Essex/Sussex saves (no false positive); ';

  insert into public.likes (liker_id, liked_id) values (vw, mb);
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    insert into public.likes (liker_id, liked_id, is_super, message) values (mb, vw, true, 'send nudes'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL super like note with nudes; '; -- policy-guard: allow (refusal test)
  exception when check_violation then r := r || 'ok Super Like notes are screened; ';
  end;
  insert into public.likes (liker_id, liked_id) values (mb, vw);
  select id into m from public.matches where (user_a = mb and user_b = vw) or (user_a = vw and user_b = mb);
  begin
    insert into public.messages (match_id, sender_id, body) values (m, mb, 'Sex for money? cash only'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL solicitation message sent; ';
  exception when check_violation then r := r || 'ok sexual solicitation blocked in chat; ';
  end;
  insert into public.messages (match_id, sender_id, body) values (m, mb, 'Coffee at the cafe on Saturday?');
  r := r || 'ok ordinary chat message sends; ';

  perform set_config('request.jwt.claims', json_build_object('sub', hc, 'role', 'authenticated')::text, true);
  begin
    update public.creators set stage_name = 'Riya Escorts' where user_id = hc; -- policy-guard: allow (refusal test)
    r := r || 'FAIL escort stage name; '; -- policy-guard: allow (refusal test)
  exception when check_violation then r := r || 'ok creator names are screened; ';
  end;
  begin
    insert into public.live_streams (creator_id, provider_key, title, category) values (hc, 'livekit', 'NSFW night', 'talk'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL nsfw title; '; -- policy-guard: allow (refusal test)
  exception when check_violation then r := r || 'ok stream titles are screened; ';
  end;

  -- ===== F. Reporting, evidence, suspension, appeals =====
  perform set_config('request.jwt.claims', json_build_object('sub', vw, 'role', 'authenticated')::text, true);
  insert into public.reports (reporter_id, reported_id, reason, details)
    values (vw, mb, 'sexual_solicitation', 'Offered paid meetups in chat') returning id into rep;
  r := r || 'ok members can report sexual solicitation; ';
  insert into public.live_reports (reporter_id, stream_id, reason, details)
    values (vw, hs, 'sexual_content', 'Explicit content on stream') returning id into lrep;
  select priority into t from public.live_reports where id = lrep;
  r := r || case when t = 'urgent' then 'ok sexual content reports are urgent; ' else 'FAIL priority ' || coalesce(t, 'null') || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select count(*) into n from public.reports;
  r := r || case when n = 0 then 'ok reported member cannot see the report; ' else 'FAIL report visible; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.admin_list_reports() where id = lrep and priority = 'urgent';
  r := r || case when n = 1 then 'ok urgent report reaches moderators; ' else 'FAIL queue; ' end;
  perform public.admin_resolve_report(lrep, 'actioned', 'Stream ended; creator suspended');
  perform public.admin_review_creator(hc, 'suspended', 'Prohibited content');
  select count(*) into n from public.admin_list_creators() where user_id = hc and status = 'suspended';
  r := r || case when n = 1 then 'ok creator suspended; ' else 'FAIL suspend; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', hc, 'role', 'authenticated')::text, true);
  insert into public.creator_appeals (creator_id, statement) values (hc, 'Please review: legacy content was removed.')
    returning id into ap;
  r := r || 'ok suspended creator can appeal; ';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_decide_appeal(ap, false, 'Upheld: prohibited content');
  select count(*) into n from public.admin_moderation_log(1000)
    where action in ('report_actioned', 'creator_suspended', 'appeal_upheld', 'stream_terminated');
  r := r || case when n >= 3 then 'ok actions logged (' || n || '); ' else 'FAIL log ' || n || '; ' end;

  -- Evidence survives the reported person deleting their account.
  reset role;
  delete from auth.users where id = mb;
  select count(*) into n from public.reports where id = rep and details = 'Offered paid meetups in chat';
  r := r || case when n = 1 then 'ok report evidence kept after account deletion; ' else 'FAIL evidence lost; ' end;
  select count(*) into n from public.moderation_actions;
  r := r || case when n >= 3 then 'ok audit log kept; ' else 'FAIL audit log; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
