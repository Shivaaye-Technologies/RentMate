-- Versioned financial configuration test. Always rolls back; no payments or payouts are activated.
do $$
declare
  proposer uuid := gen_random_uuid();
  approver uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  pricing_id uuid;
  tax_id uuid;
  n int;
  config_status text;
  balance_before bigint;
  r text := '';
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@financial-config.test', 'authenticated', 'authenticated'
  from unnest(array[proposer, approver, modr, member_id]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Financial config test', 30, 'friendship', 18, 60
  from unnest(array[proposer, approver, modr, member_id]) u;
  insert into private.user_roles(user_id, role)
  values (proposer, 'admin'), (approver, 'admin'), (modr, 'moderator');
  select balance into balance_before from public.token_wallets where user_id = member_id;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', proposer, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  pricing_id := public.admin_propose_financial_config(
    'token_pricing',
    '{"currency":"INR","tax_inclusive":false,"packages":[{"code":"starter","tokens":100,"price_paise":15000,"bonus_tokens":5}]}',
    now() + interval '1 day',
    'Approved commercial pricing review'
  );
  r := r || case when pricing_id is not null then 'ok admin can propose versioned token pricing; ' else 'FAIL pricing proposal; ' end;

  tax_id := public.admin_propose_financial_config(
    'tax_rule',
    '{"country_code":"IN","state_code":"DL","tax_category":"review_required","tax_name":"Applicable indirect tax","rate_bps":0,"treatment":"exclusive"}',
    now() + interval '1 day',
    'Tax adviser review reference'
  );
  r := r || case when tax_id is not null then 'ok explicit jurisdiction tax rule can be proposed without a hardcoded rate; ' else 'FAIL tax proposal; ' end;

  begin
    perform public.admin_approve_financial_config(pricing_id, 'approved', 'self approval');
    r := r || 'FAIL proposer self-approved; ';
  exception when insufficient_privilege then
    r := r || 'ok proposer cannot approve own change; ';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', approver, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.admin_approve_financial_config(pricing_id, 'approved', 'Independent finance review');
  perform public.admin_approve_financial_config(tax_id, 'approved', 'Independent tax review');
  select count(*) into n from public.admin_list_financial_configs() where id in (pricing_id, tax_id) and approval_count = 1;
  r := r || case when n = 2 then 'ok independent admin approvals are recorded; ' else 'FAIL approval history; ' end;
  select c.status into config_status from public.admin_list_financial_configs() c where c.id = pricing_id;
  r := r || case when config_status = 'scheduled' then 'ok future-effective approved pricing is scheduled; ' else 'FAIL scheduled state; ' end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    perform public.admin_list_financial_configs();
    r := r || 'FAIL moderator read financial configurations; ';
  exception when insufficient_privilege then
    r := r || 'ok moderator cannot administer financial configurations; ';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    perform public.admin_propose_financial_config(
      'token_pricing',
      '{"currency":"INR","tax_inclusive":false,"packages":[{"code":"starter","tokens":100,"price_paise":15000,"bonus_tokens":0}]}',
      now() + interval '1 day',
      'Unauthorized member proposal'
    );
    r := r || 'FAIL ordinary member proposed pricing; ';
  exception when insufficient_privilege then
    r := r || 'ok ordinary member cannot propose pricing; ';
  end;
  reset role;

  select balance into n from public.token_wallets where user_id = member_id;
  r := r || case when n = balance_before then 'ok pricing changes do not alter member token balances; ' else 'FAIL token wallet changed; ' end;
  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
