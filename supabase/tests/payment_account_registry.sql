-- Payment account registry test (migration 20261123150000_payment_account_registry.sql). Always rolls back.
-- No provider secrets or live payment operations are used.
do $$
declare
  adm uuid := gen_random_uuid();
  modr uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  acct uuid;
  n int;
  account_status text;
  r text := '';
begin
  insert into auth.users (id, email, aud, role)
  select u, u::text || '@payments.test', 'authenticated', 'authenticated'
  from unnest(array[adm, modr, member_id]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Test member', 30, 'friendship', 18, 60 from unnest(array[adm, modr, member_id]) u;
  insert into private.user_roles(user_id, role) values (adm, 'admin'), (modr, 'moderator');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  acct := public.admin_upsert_payment_account(
    null, 'upi', 'razorpay', 'UPI primary', 'merchant-ref-001', 'test', 10,
    100, 500000, 'rentmate@bank', true
  );
  r := r || case when acct is not null then 'ok admin can add a UPI account; ' else 'FAIL account insert; ' end;
  select count(*) into n from public.admin_list_payment_accounts()
    where id = acct and status = 'draft' and environment = 'test'
      and min_amount_paise = 100 and max_amount_paise = 500000 and secret_configured = false;
  r := r || case when n = 1 then 'ok new account is draft and limits are stored in paise; ' else 'FAIL account metadata; ' end;

  begin
    perform public.admin_upsert_payment_account(
      null, 'upi', 'razorpay', 'Invalid UPI', 'merchant-ref-002', 'test', 10,
      100, 500000, 'not-a-vpa', false
    );
    r := r || 'FAIL invalid VPA accepted; ';
  exception when check_violation or invalid_parameter_value then
    r := r || 'ok invalid UPI VPA is rejected; ';
  end;
  begin
    perform public.admin_upsert_payment_account(
      null, 'card', 'upi_psp', 'Invalid card', 'merchant-ref-003', 'test', 10,
      100, 500000, null, false
    );
    r := r || 'FAIL incompatible card provider accepted; ';
  exception when invalid_parameter_value then
    r := r || 'ok incompatible payment adapter is rejected; ';
  end;

  -- Admin can use the masked RPC, but must not read the underlying table directly.
  begin
    select count(*) into n from public.payment_provider_accounts;
    r := r || 'FAIL admin directly selected payment account table; ';
  exception when insufficient_privilege then
    r := r || 'ok admin direct table SELECT is revoked; ';
  end;
  select status into strict account_status
    from public.admin_list_payment_accounts() where id = acct;
  r := r || case when account_status = 'draft'
    then 'ok admin reads metadata through the RPC; ' else 'FAIL admin RPC metadata; ' end;

  perform public.admin_set_payment_account_status(acct, 'paused');
  select status into strict account_status
    from public.admin_list_payment_accounts() where id = acct;
  r := r || case when account_status = 'paused'
    then 'ok admin can pause account through the RPC; ' else 'FAIL pause status; ' end;
  begin
    perform public.admin_set_payment_account_status(acct, 'active');
    r := r || 'FAIL account activated without provider test; ';
  exception when invalid_parameter_value then
    r := r || 'ok account cannot be activated through metadata-only controls; ';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', modr, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    perform public.admin_list_payment_accounts();
    r := r || 'FAIL moderator read payment accounts; ';
  exception when insufficient_privilege then
    r := r || 'ok moderator cannot administer payment accounts; ';
  end;
  begin
    perform public.admin_upsert_payment_account(
      null, 'card', 'razorpay', 'Card', 'merchant-ref-004', 'test', 10,
      100, 500000, null, false
    );
    r := r || 'FAIL moderator created payment account; ';
  exception when insufficient_privilege then
    r := r || 'ok moderator cannot create payment accounts; ';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', member_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  begin
    select count(*) into n from public.payment_provider_accounts;
    r := r || 'FAIL ordinary member directly selected payment account table; ';
  exception when insufficient_privilege then
    r := r || 'ok ordinary member has no direct table SELECT; ';
  end;
  begin
    perform public.admin_set_payment_account_status(acct, 'disabled');
    r := r || 'FAIL member changed payment account status; ';
  exception when insufficient_privilege then
    r := r || 'ok ordinary members cannot change payment account status; ';
  end;
  reset role;

  select count(*) into n from public.payment_provider_accounts where id = acct;
  r := r || case when n = 1 then 'ok account metadata persists after role checks; ' else 'FAIL account row missing; ' end;
  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
