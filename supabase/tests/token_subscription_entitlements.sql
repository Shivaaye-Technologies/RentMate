-- Subscription and discovery entitlement foundation test. Runs only in the disposable PGlite harness.
do $$
declare
  actor uuid := gen_random_uuid();
  target_ids uuid[] := array[]::uuid[];
  target uuid;
  i integer;
  blocked boolean := false;
  ent record;
  rewind_actor uuid := gen_random_uuid();
  rewind_targets uuid[] := array[]::uuid[];
  affected integer;
  rewind_usage bigint;
begin
  insert into auth.users(id, email, aud, role)
  values (actor, actor::text || '@entitlement.test', 'authenticated', 'authenticated');

  for i in 1..32 loop
    target := gen_random_uuid();
    target_ids := array_append(target_ids, target);
    insert into auth.users(id, email, aud, role)
    values (target, target::text || '@entitlement.test', 'authenticated', 'authenticated');
    insert into public.profiles(id, display_name, age, looking_for, age_min, age_max)
    values (target, 'Target ' || i, 30, 'friendship', 18, 60);
  end loop;

  insert into public.profiles(id, display_name, age, looking_for, age_min, age_max)
  values (actor, 'Entitlement actor', 30, 'friendship', 18, 60);

  perform set_config('request.jwt.claims',
    json_build_object('sub', actor, 'role', 'authenticated')::text, true);

  for i in 1..15 loop
    insert into public.likes(liker_id, liked_id) values (actor, target_ids[i]);
  end loop;

  begin
    insert into public.likes(liker_id, liked_id) values (actor, target_ids[16]);
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL free member exceeded the 15-like rolling limit';
  end if;

  blocked := false;
  for i in 17..31 loop
    insert into public.passes(passer_id, passed_id) values (actor, target_ids[i]);
  end loop;
  begin
    insert into public.passes(passer_id, passed_id) values (actor, target_ids[32]);
  exception when raise_exception then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL free member exceeded the 15-dislike rolling limit';
  end if;

  reset role;
  insert into public.subscription_entitlements(
    user_id, plan_key, status, provider, provider_purchase_id,
    current_period_start, current_period_end, verified_at
  ) values (
    actor, 'monthly', 'active', 'admin', 'test-entitlement-' || actor,
    now() - interval '1 minute', now() + interval '30 days', now()
  );

  set local role authenticated;
  select * into ent from public.my_subscription_entitlement();
  if not ent.is_subscriber or ent.plan_key <> 'monthly' or ent.status <> 'active' then
    raise exception 'FAIL active verified subscription was not exposed to its owner';
  end if;

  -- The same user can continue discovering as a subscriber; abuse/safety controls remain separate.
  insert into public.likes(liker_id, liked_id) values (actor, target_ids[16]);
  insert into public.passes(passer_id, passed_id) values (actor, target_ids[32]);
  reset role;

  -- A separate free member receives exactly three rewinds in a rolling 24-hour window.
  insert into auth.users(id, email, aud, role)
  values (rewind_actor, rewind_actor::text || '@rewind.test', 'authenticated', 'authenticated');
  insert into public.profiles(id, display_name, age, looking_for, age_min, age_max)
  values (rewind_actor, 'Rewind actor', 30, 'friendship', 18, 60);
  for i in 1..4 loop
    target := gen_random_uuid();
    rewind_targets := array_append(rewind_targets, target);
    insert into auth.users(id, email, aud, role)
    values (target, target::text || '@rewind.test', 'authenticated', 'authenticated');
    insert into public.profiles(id, display_name, age, looking_for, age_min, age_max)
    values (target, 'Rewind target ' || i, 30, 'friendship', 18, 60);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', rewind_actor, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for i in 1..4 loop
    insert into public.passes(passer_id, passed_id)
    values (rewind_actor, rewind_targets[i]);
  end loop;

  for i in 1..3 loop
    delete from public.passes
    where passer_id = rewind_actor and passed_id = rewind_targets[i];
    get diagnostics affected = row_count;
    if affected <> 1 then
      raise exception 'FAIL rewind % did not delete exactly one owned pass (rows=%)', i, affected;
    end if;
  end loop;

  reset role;
  select count(*) into rewind_usage
  from public.discovery_action_usage
  where user_id = rewind_actor and action = 'rewind'
    and created_at > now() - interval '24 hours';
  if rewind_usage <> 3 then
    raise exception 'FAIL expected 3 recorded rewinds after 3 deletes, got %', rewind_usage;
  end if;
  set local role authenticated;

  blocked := false;
  begin
    delete from public.passes
    where passer_id = rewind_actor and passed_id = rewind_targets[4];
    get diagnostics affected = row_count;
    if affected = 1 then
      raise exception 'FAIL fourth rewind unexpectedly deleted a pass';
    end if;
  exception when raise_exception then
    if sqlerrm like 'Daily rewind limit reached.%' then
      blocked := true;
    else
      raise;
    end if;
  end;
  if not blocked then
    raise exception 'FAIL free member exceeded the 3-rewind rolling limit';
  end if;

  reset role;
  insert into public.subscription_entitlements(
    user_id, plan_key, status, provider, provider_purchase_id,
    current_period_start, current_period_end, verified_at
  ) values (
    rewind_actor, 'monthly', 'active', 'admin', 'rewind-entitlement-' || rewind_actor,
    now() - interval '1 minute', now() + interval '30 days', now()
  );
  set local role authenticated;
  delete from public.passes
  where passer_id = rewind_actor and passed_id = rewind_targets[4];
  reset role;

  raise exception 'ROLLED BACK. RESULTS: ok free likes capped at 15; ok free dislikes capped at 15; ok verified subscriber entitlement; ok subscriber discovery actions allowed; ok own subscription status readable; ok free rewinds capped at 3; ok subscriber rewind exemption';
end
$$;
