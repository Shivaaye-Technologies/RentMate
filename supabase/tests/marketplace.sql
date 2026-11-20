-- RentMate marketplace test: companion approval, services, availability, search, shortlists, bookings (server
-- pricing, availability, notice, overlap, lifecycle), messaging, reviews, disputes, suspensions, appeals, admin,
-- financial switches and privacy. Always rolls back. Every result must start with "ok".
do $$
declare
  adm uuid := gen_random_uuid();   -- admin
  modr uuid := gen_random_uuid();  -- moderator
  cm uuid := gen_random_uuid();    -- companion (all-day availability)
  cm2 uuid := gen_random_uuid();   -- companion (09:00-21:00)
  mb uuid := gen_random_uuid();    -- member
  mb2 uuid := gen_random_uuid();   -- second member
  out_ uuid := gen_random_uuid();  -- unrelated member
  r text := ''; n int; t text; v numeric; js jsonb;
  base timestamptz; s_hour uuid; s_sess uuid; s2 uuid;
  bk1 uuid; bk2 uuid; bk3 uuid; bk4 uuid; bk5 uuid; bk6 uuid; cv uuid; rv uuid; ap uuid;
  late boolean;
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@market.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[adm, modr, cm, cm2, mb, mb2, out_]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[adm, modr, cm, cm2, mb, mb2, out_]) u;
  insert into private.user_roles (user_id, role) values (adm, 'admin'), (modr, 'moderator');
  -- 11:00 India time, five days from now.
  base := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 days 11 hours') at time zone 'Asia/Kolkata';

  -- ===== Owner-level switches =====
  begin
    update public.platform_settings set payments_enabled = true;
    r := r || 'FAIL payments enabled; ';
  exception when check_violation then r := r || 'ok payments cannot be switched on before approval; ';
  end;
  begin
    insert into public.subscription_plans (key, audience, label, price_inr, period, active)
      values ('gold', 'member', 'Gold', 499, 'month', true);
    r := r || 'FAIL active plan; ';
  exception when check_violation then r := r || 'ok subscriptions cannot be activated before approval; ';
  end;
  -- Checks the allow-list does not contain any adult-type category.
  select count(*) into n from public.activity_categories where key ~ '(adult|escort|sex|night)'; -- policy-guard: allow (refusal test)
  r := r || case when n = 0 then 'ok activity allow-list has no adult categories; ' else 'FAIL categories; ' end;

  set local role authenticated;

  -- ===== Companion application =====
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  begin
    insert into public.companion_profiles (user_id, headline, city, status) values (cm, 'Friendly city guide', 'Pune', 'approved');
    r := r || 'FAIL companion set own status; ';
  exception when insufficient_privilege then r := r || 'ok companions cannot set their own status; ';
  end;
  begin
    insert into public.companion_profiles (user_id, headline, city, area) values (cm, 'Friendly city guide', 'Pune', 'Flat 12, Green Towers');
    r := r || 'FAIL address accepted; ';
  exception when check_violation then r := r || 'ok home addresses refused in area; ';
  end;
  begin
    insert into public.companion_profiles (user_id, headline, city, area) values (cm, 'Friendly city guide', 'Pune', 'Baner 411045');
    r := r || 'FAIL PIN accepted; ';
  exception when check_violation then r := r || 'ok PIN codes refused in area; ';
  end;
  begin
    insert into public.companion_profiles (user_id, headline, city) values (cm, 'Escort for hire', 'Pune'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL prohibited headline; ';
  exception when check_violation then r := r || 'ok prohibited wording refused in headline; ';
  end;
  insert into public.companion_profiles (user_id, headline, about, city, area, languages, interests)
    values (cm, 'Friendly city guide and coffee chats', 'I love walks and museums.', 'Pune', 'Baner',
            '{English,Hindi}', '{Museums,Coffee}');
  select status into t from public.companion_profiles where user_id = cm;
  r := r || case when t = 'pending' then 'ok new companions start pending; ' else 'FAIL status ' || coalesce(t, 'null') || '; ' end;
  begin
    update public.companion_profiles set status = 'approved', verified = true where user_id = cm;
    r := r || 'FAIL self approval; ';
  exception when insufficient_privilege then r := r || 'ok companions cannot approve or verify themselves; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select count(*) into n from public.companion_profiles where user_id = cm;
  r := r || case when n = 0 then 'ok pending companions are hidden; ' else 'FAIL pending visible; ' end;
  begin
    perform public.admin_review_companion(cm, 'approved', true, 'self');
    r := r || 'FAIL member approved companion; ';
  exception when insufficient_privilege then r := r || 'ok only moderators approve companions; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_review_companion(cm, 'approved', true, 'Identity and age checked');

  -- ===== Services and availability =====
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  begin
    insert into public.companion_services (companion_id, category, title, pricing, price_inr) values (cm, 'adult', 'x', 'hourly', 900);
    r := r || 'FAIL adult category service; ';
  exception when foreign_key_violation or check_violation then r := r || 'ok services only from the activity allow-list; ';
  end;
  begin
    insert into public.companion_services (companion_id, category, title, pricing, price_inr) values (cm, 'coffee', 'Coffee', 'hourly', 50);
    r := r || 'FAIL price too low; ';
  exception when check_violation then r := r || 'ok prices are range-checked; ';
  end;
  begin
    insert into public.companion_services (companion_id, category, title, pricing, price_inr)
      values (cm, 'coffee', 'Sexual services', 'hourly', 900); -- policy-guard: allow (refusal test)
    r := r || 'FAIL prohibited service title; ';
  exception when check_violation then r := r || 'ok prohibited wording refused in services; ';
  end;
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, min_minutes, max_minutes)
    values (cm, 'coffee', 'Coffee and conversation', 'hourly', 800, 60, 180) returning id into s_hour;
  insert into public.companion_services (companion_id, category, title, pricing, price_inr, min_minutes, max_minutes)
    values (cm, 'dining', 'Dinner company', 'session', 1500, 90, 120) returning id into s_sess;
  begin
    insert into public.companion_services (companion_id, category, title, pricing, price_inr) values (mb, 'coffee', 'Fake', 'hourly', 500);
    r := r || 'FAIL service for someone else; ';
  exception when insufficient_privilege or foreign_key_violation then r := r || 'ok services only on your own profile; ';
  end;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute)
    select cm, d, 0, 1440 from generate_series(0, 6) d;
  begin
    insert into public.companion_availability (companion_id, weekday, start_minute, end_minute, timezone)
      values (cm, 1, 10, 20, 'Mars/Olympus');
    r := r || 'FAIL bad timezone; ';
  exception when invalid_parameter_value then r := r || 'ok unknown time zones refused; ';
  end;

  -- Second companion with a 09:00-21:00 window.
  perform set_config('request.jwt.claims', json_build_object('sub', cm2, 'role', 'authenticated')::text, true);
  insert into public.companion_profiles (user_id, headline, city, languages) values (cm2, 'Board games and cafes', 'Pune', '{English}');
  insert into public.companion_services (companion_id, category, title, pricing, price_inr) values (cm2, 'gaming', 'Board games', 'hourly', 600)
    returning id into s2;
  insert into public.companion_availability (companion_id, weekday, start_minute, end_minute)
    select cm2, d, 540, 1260 from generate_series(0, 6) d;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_review_companion(cm2, 'approved', false, 'Approved');

  -- ===== Search and shortlist =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select count(*) into n from public.companions_search('pune');
  r := r || case when n = 2 then 'ok search lists approved companions; ' else 'FAIL search ' || n || '; ' end;
  select count(*) into n from public.companions_search('pune', 'coffee');
  r := r || case when n = 1 then 'ok search filters by activity; ' else 'FAIL category filter ' || n || '; ' end;
  select count(*) into n from public.companions_search(null, null, 700);
  r := r || case when n = 1 then 'ok search filters by price; ' else 'FAIL price filter ' || n || '; ' end;
  select count(*) into n from public.companions_search(null, null, null, 'hindi');
  r := r || case when n = 1 then 'ok search filters by language; ' else 'FAIL language ' || n || '; ' end;
  select count(*) into n from public.companions_search(null, null, null, null, null, true);
  r := r || case when n = 1 then 'ok search filters verified profiles; ' else 'FAIL verified ' || n || '; ' end;
  select count(*) into n from public.companions_search(null, null, null, null, 'museums');
  r := r || case when n = 1 then 'ok search filters by interest; ' else 'FAIL interest ' || n || '; ' end;
  insert into public.shortlists (member_id, companion_id) values (mb, cm);
  begin
    insert into public.shortlists (member_id, companion_id) values (mb2, cm);
    r := r || 'FAIL shortlist for someone else; ';
  exception when insufficient_privilege then r := r || 'ok shortlists are private to the member; ';
  end;

  -- ===== Booking requests =====
  begin
    insert into public.bookings (member_id, companion_id, category, service_title, pricing, starts_at, ends_at, timezone,
      price_inr, commission_pct, meeting_point, cancellation_policy)
    values (mb, cm, 'coffee', 'x', 'hourly', base, base + interval '1 hour', 'Asia/Kolkata', 1, 0, 'Cafe', 'x');
    r := r || 'FAIL direct booking insert; ';
  exception when insufficient_privilege then r := r || 'ok bookings cannot be written directly (no client prices); ';
  end;
  bk1 := public.booking_request(s_hour, base, 120, 'Cafe Goodluck, FC Road', 'Looking forward', 'key-bk1-0001');
  select price_inr, status into n, t from public.bookings where id = bk1;
  r := r || case when n = 1600 and t = 'requested' then 'ok server computes the price (2h x 800 = 1600); '
              else 'FAIL price ' || coalesce(n::text, 'null') || ' ' || coalesce(t, 'null') || '; ' end;
  r := r || case when public.booking_request(s_hour, base, 120, 'Cafe Goodluck, FC Road', '', 'key-bk1-0001') = bk1
              then 'ok repeated request with same key is idempotent; ' else 'FAIL idempotency; ' end;
  begin
    perform public.booking_request(s_hour, now() + interval '1 hour', 60, 'Cafe', '');
    r := r || 'FAIL short notice; ';
  exception when raise_exception then r := r || 'ok minimum notice enforced; ';
  end;
  begin
    perform public.booking_request(s_hour, base + interval '1 day', 20, 'Cafe', '');
    r := r || 'FAIL too short; ';
  exception when raise_exception then r := r || 'ok duration limits enforced; ';
  end;
  begin
    perform public.booking_request(s2, base + interval '12 hours', 60, 'Cafe', '');
    r := r || 'FAIL outside availability; ';
  exception when raise_exception then r := r || 'ok outside availability refused; ';
  end;
  begin
    perform public.booking_request(s_hour, base + interval '2 days', 60, 'Flat 4, Rose Apartments', '');
    r := r || 'FAIL residential meeting point; ';
  exception when check_violation then r := r || 'ok meeting points must be public places; ';
  end;
  bk5 := public.booking_request(s2, base, 60, 'Board game cafe, Baner', '');
  bk6 := public.booking_request(s_sess, base + interval '3 days', 120, 'Restaurant, Koregaon Park', '');
  select price_inr into n from public.bookings where id = bk6;
  r := r || case when n = 1500 then 'ok session pricing is a fixed price; ' else 'FAIL session price ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_request(s_hour, base + interval '1 day', 60, 'Cafe', '');
    r := r || 'FAIL self booking; ';
  exception when raise_exception then r := r || 'ok companions cannot book themselves; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  bk2 := public.booking_request(s_hour, base + interval '30 minutes', 60, 'Cafe Goodluck, FC Road', '');
  bk3 := public.booking_request(s_hour, base + interval '2 days', 60, 'Cafe Goodluck, FC Road', '');

  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  select count(*) into n from public.bookings;
  r := r || case when n = 0 then 'ok outsiders see no bookings; ' else 'FAIL outsider saw ' || n || '; ' end;
  begin
    perform public.booking_cancel(bk1, 'not mine');
    r := r || 'FAIL outsider cancelled; ';
  exception when insufficient_privilege then r := r || 'ok outsiders cannot cancel; ';
  end;

  -- ===== Responding and overlap =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_respond(bk1, 'accept', null);
    r := r || 'FAIL member accepted own request; ';
  exception when insufficient_privilege then r := r || 'ok only the companion can accept; ';
  end;
  begin
    update public.bookings set status = 'accepted' where id = bk1;
    r := r || 'FAIL direct status change; ';
  exception when insufficient_privilege then r := r || 'ok booking status cannot be changed directly; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(bk1, 'pending', 'Checking my diary');
  perform public.booking_respond(bk1, 'accept', null);
  select status into t from public.bookings where id = bk1;
  r := r || case when t = 'accepted' then 'ok requested -> pending -> accepted; ' else 'FAIL ' || coalesce(t, 'null') || '; ' end;
  begin
    perform public.booking_respond(bk2, 'accept', null);
    r := r || 'FAIL overlapping booking accepted; ';
  exception when raise_exception then r := r || 'ok overlapping bookings cannot both be accepted (companion); ';
  end;
  perform public.booking_respond(bk2, 'reject', 'Already booked');
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_request(s_hour, base + interval '1 hour', 60, 'Cafe', '');
    r := r || 'FAIL request into accepted slot; ';
  exception when raise_exception then r := r || 'ok accepted time is no longer requestable; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm2, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_respond(bk5, 'accept', null);
    r := r || 'FAIL member double-booked; ';
  exception when raise_exception then r := r || 'ok a member cannot have two accepted bookings at once; ';
  end;

  -- ===== Cancellation =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  perform public.booking_cancel(bk3, 'Change of plans');
  select status, late_cancellation into t, late from public.bookings where id = bk3;
  r := r || case when t = 'cancelled' and not late then 'ok member cancels a request (not late); ' else 'FAIL cancel; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_respond(bk6, 'accept', null);
  reset role;
  update public.bookings set starts_at = now() + interval '3 hours', ends_at = now() + interval '5 hours' where id = bk6;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  perform public.booking_cancel(bk6, 'Sick');
  select late_cancellation into late from public.bookings where id = bk6;
  r := r || case when late then 'ok cancellations inside the free window are marked late; ' else 'FAIL late flag; ' end;

  -- ===== Completion, reviews, disputes =====
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_complete(bk1);
    r := r || 'FAIL completed before end; ';
  exception when raise_exception then r := r || 'ok bookings complete only after they end; ';
  end;
  reset role;
  update public.bookings set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = bk1;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.review_create(bk1, 5, 'Lovely');
    r := r || 'FAIL review before completion; ';
  exception when raise_exception then r := r || 'ok no reviews before completion; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  perform public.booking_complete(bk1);
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  begin
    perform public.review_create(bk1, 1, 'Fake');
    r := r || 'FAIL non-participant review; ';
  exception when insufficient_privilege then r := r || 'ok only the member who booked can review; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.review_create(bk1, 6, 'Great');
    r := r || 'FAIL rating 6; ';
  exception when check_violation then r := r || 'ok ratings are 1 to 5; ';
  end;
  begin
    perform public.review_create(bk1, 5, 'Better than any escort'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL prohibited review; ';
  exception when check_violation then r := r || 'ok prohibited wording refused in reviews; ';
  end;
  rv := public.review_create(bk1, 5, 'Great conversation and a lovely walk.');
  begin
    perform public.review_create(bk1, 4, 'Again');
    r := r || 'FAIL second review; ';
  exception when raise_exception then r := r || 'ok one review per booking; ';
  end;
  select rating into v from public.companion_rating(cm);
  r := r || case when v = 5.0 then 'ok average rating calculated; ' else 'FAIL rating ' || coalesce(v::text, 'null') || '; ' end;
  begin
    insert into public.reviews (booking_id, reviewer_id, companion_id, rating) values (bk1, mb, cm, 5);
    r := r || 'FAIL direct review insert; ';
  exception when insufficient_privilege then r := r || 'ok reviews cannot be written directly; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  select completed_bookings, booked_value_inr, commission_inr, estimated_earnings_inr into n, js, v, t
  from (select completed_bookings, to_jsonb(booked_value_inr) booked_value_inr, commission_inr::numeric commission_inr,
               estimated_earnings_inr::text estimated_earnings_inr from public.companion_earnings()) x;
  r := r || case when n = 1 and js = '1600'::jsonb and v = 240 and t = '1360'
              then 'ok earnings estimate uses the commission snapshot (15%); ' else 'FAIL earnings; ' end;
  perform public.booking_dispute(bk1, 'Member arrived two hours late');
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_resolve_dispute(bk1, 'completed', 'x');
    r := r || 'FAIL member resolved dispute; ';
  exception when insufficient_privilege then r := r || 'ok only moderators resolve disputes; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_resolve_dispute(bk1, 'completed', 'Both sides heard; booking stands');
  select status into t from public.admin_list_bookings('completed') where id = bk1;
  r := r || case when t = 'completed' then 'ok disputes are resolved by moderators; ' else 'FAIL dispute ' || coalesce(t, 'null') || '; ' end;
  perform public.admin_set_review_status(rv, false, 'Testing moderation');
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.reviews where id = rv;
  r := r || case when n = 0 then 'ok hidden reviews are not shown to others; ' else 'FAIL hidden review visible; ' end;

  -- ===== Messaging =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  cv := public.conversation_open(cm);
  insert into public.conversation_messages (conversation_id, sender_id, body) values (cv, mb, 'Hi! Is Saturday free?');
  begin
    insert into public.conversation_messages (conversation_id, sender_id, body) values (cv, mb, 'Send nudes'); -- policy-guard: allow (refusal test)
    r := r || 'FAIL prohibited message; ';
  exception when check_violation then r := r || 'ok prohibited wording refused in marketplace chat; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.conversation_messages where conversation_id = cv and read_at is null and sender_id <> cm;
  r := r || case when n = 1 then 'ok companion sees one unread message; ' else 'FAIL unread ' || n || '; ' end;
  perform public.conversation_mark_read(cv);
  insert into public.conversation_messages (conversation_id, sender_id, body) values (cv, cm, 'Yes, 11am works.');
  perform set_config('request.jwt.claims', json_build_object('sub', out_, 'role', 'authenticated')::text, true);
  select count(*) into n from public.conversation_messages;
  r := r || case when n = 0 then 'ok outsiders cannot read conversations; ' else 'FAIL outsider read ' || n || '; ' end;
  begin
    insert into public.conversation_messages (conversation_id, sender_id, body) values (cv, out_, 'hello');
    r := r || 'FAIL outsider wrote; ';
  exception when insufficient_privilege then r := r || 'ok outsiders cannot write into conversations; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', cm, 'role', 'authenticated')::text, true);
  insert into public.blocks (blocker_id, blocked_id) values (cm, mb);
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    insert into public.conversation_messages (conversation_id, sender_id, body) values (cv, mb, 'Hello?');
    r := r || 'FAIL message after block; ';
  exception when insufficient_privilege then r := r || 'ok blocking stops marketplace messages; ';
  end;
  select count(*) into n from public.companions_search('pune') where user_id = cm;
  r := r || case when n = 0 then 'ok blocked companions disappear from search; ' else 'FAIL blocked in search; ' end;
  begin
    perform public.booking_request(s_hour, base + interval '4 days', 60, 'Cafe', '');
    r := r || 'FAIL booking after block; ';
  exception when raise_exception then r := r || 'ok blocked companions cannot be booked; ';
  end;

  -- ===== Notifications =====
  select count(*) into n from public.notifications where user_id = mb;
  r := r || case when n >= 3 then 'ok members are notified of booking changes; ' else 'FAIL notifications ' || n || '; ' end;
  select count(*) into n from public.notifications where user_id <> mb;
  r := r || case when n = 0 then 'ok notifications are private; ' else 'FAIL saw others notifications; ' end;
  update public.notifications set read_at = now() where user_id = mb;
  begin
    update public.notifications set title = 'x' where user_id = mb;
    r := r || 'FAIL edited notification text; ';
  exception when insufficient_privilege then r := r || 'ok members can only mark notifications read; ';
  end;

  -- ===== Reports referencing bookings =====
  insert into public.reports (reporter_id, reported_id, reason, details, booking_id)
    values (mb, cm2, 'booking_issue', 'Companion did not reply', bk5);
  r := r || 'ok bookings can be reported; ';

  -- ===== Suspension and appeals =====
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_suspend_account(mb, 'x');
    r := r || 'FAIL member suspended someone; ';
  exception when insufficient_privilege then r := r || 'ok only moderators suspend accounts; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_suspend_account(mb, 'Harassment reports');
  perform public.admin_suspend_account(cm2, 'Profile review');
  select status into t from public.admin_list_bookings(null) where id = bk5;
  r := r || case when t = 'cancelled' then 'ok suspension cancels upcoming bookings; '
              else 'FAIL bk5 ' || coalesce(t, 'null') || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.companions_search('pune') where user_id = cm2;
  r := r || case when n = 0 then 'ok suspended companions disappear from search; ' else 'FAIL suspended in search; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  begin
    perform public.booking_request(s_sess, base + interval '6 days', 90, 'Restaurant', '');
    r := r || 'FAIL suspended member booked; ';
  exception when insufficient_privilege then r := r || 'ok suspended members cannot book; ';
  end;
  begin
    perform public.conversation_open(cm);
    r := r || 'FAIL suspended member opened chat; ';
  exception when insufficient_privilege then r := r || 'ok suspended members cannot start conversations; ';
  end;
  ap := public.appeal_suspension('I believe this was a misunderstanding, please review.');
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  perform public.admin_decide_account_appeal(ap, true, 'Reports were not substantiated');
  perform set_config('request.jwt.claims', json_build_object('sub', mb, 'role', 'authenticated')::text, true);
  select count(*) into n from public.account_suspensions where user_id = mb and lifted_at is null;
  r := r || case when n = 0 then 'ok overturned appeal lifts the suspension; ' else 'FAIL still suspended; ' end;

  -- ===== Admin =====
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_set_commission(20);
    r := r || 'FAIL moderator set commission; ';
  exception when insufficient_privilege then r := r || 'ok commission is admin-only; ';
  end;
  js := public.admin_marketplace_stats();
  r := r || case when (js->>'payments_enabled')::boolean = false and (js->>'completed_booked_value_inr')::int = 1600
              then 'ok analytics report booked value and payments off; ' else 'FAIL stats ' || js::text || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform public.admin_set_commission(20);
  begin
    perform public.admin_set_commission(80);
    r := r || 'FAIL 80% commission; ';
  exception when check_violation then r := r || 'ok commission capped at 50%; ';
  end;
  select count(*) into n from public.admin_list_bookings(null) where id = bk1 and commission_pct = 15;
  r := r || case when n = 1 then 'ok existing bookings keep their commission snapshot; ' else 'FAIL snapshot; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mb2, 'role', 'authenticated')::text, true);
  begin
    perform 1 from public.transactions;
    r := r || 'FAIL transactions readable; ';
  exception when insufficient_privilege then r := r || 'ok financial records are not readable by members; ';
  end;
  begin
    perform public.admin_list_bookings(null);
    r := r || 'FAIL member listed all bookings; ';
  exception when insufficient_privilege then r := r || 'ok booking management is moderators only; ';
  end;

  -- ===== Records survive account deletion =====
  reset role;
  delete from auth.users where id = mb2;
  select count(*) into n from public.bookings where id in (bk2, bk3) and member_id is null;
  r := r || case when n = 2 then 'ok booking records kept after account deletion; ' else 'FAIL bookings lost ' || n || '; ' end;
  select count(*) into n from public.booking_events where booking_id = bk1;
  r := r || case when n >= 5 then 'ok every status change is in the booking history (' || n || '); ' else 'FAIL events ' || n || '; ' end;
  select count(*) into n from public.moderation_actions
    where action in ('companion_approved', 'account_suspended', 'dispute_completed', 'review_hidden', 'commission_set');
  r := r || case when n >= 5 then 'ok admin actions are audit-logged; ' else 'FAIL audit ' || n || '; ' end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
