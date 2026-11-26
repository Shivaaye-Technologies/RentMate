-- Staff role tiers (migration 20261126110000). Always rolls back. Every result must start with "ok".
do $$
declare
  sup uuid := gen_random_uuid();
  mas uuid := gen_random_uuid();
  sub uuid := gen_random_uuid();
  agt uuid := gen_random_uuid();
  leg uuid := gen_random_uuid();  -- legacy 'admin'
  mem uuid := gen_random_uuid();
  mem2 uuid := gen_random_uuid();
  rep uuid;
  r text := ''; n bigint; t text; roles text[];
begin
  insert into auth.users (id, email, aud, role, instance_id)
  select u, u::text || '@roles.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[sup, mas, sub, agt, leg, mem, mem2]) u;
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select u, 'Member', 30, 'friendship', 18, 60 from unnest(array[sup, mas, sub, agt, leg, mem, mem2]) u;
  insert into private.user_roles (user_id, role) values (sup, 'super_admin'), (mas, 'master_admin'),
    (sub, 'sub_admin'), (agt, 'agent'), (leg, 'admin');
  insert into public.reports (reporter_id, reported_id, reason, details) values (mem, mem2, 'harassment', 'private details')
    returning id into rep;

  set local role authenticated;

  -- ===== Capability checks =====
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  r := r || case when private.has_role('super_admin') and private.has_role('admin') and private.has_role('moderator')
                      and private.has_role('agent') then 'ok super admin has every capability; ' else 'FAIL super; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mas, 'role', 'authenticated')::text, true);
  r := r || case when private.has_role('admin') and private.has_role('moderator') and not private.has_role('super_admin')
                 then 'ok master admin is admin-level, not super; ' else 'FAIL master; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', sub, 'role', 'authenticated')::text, true);
  r := r || case when private.has_role('moderator') and private.has_role('agent') and not private.has_role('admin')
                 then 'ok sub admin moderates but is not admin; ' else 'FAIL sub; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  r := r || case when private.has_role('agent') and not private.has_role('moderator') and not private.has_role('admin')
                 then 'ok agent has support access only; ' else 'FAIL agent; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', leg, 'role', 'authenticated')::text, true);
  r := r || case when private.has_role('admin') and private.has_role('moderator') and not private.has_role('super_admin')
                 then 'ok legacy admin keeps admin rights; ' else 'FAIL legacy; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', mem, 'role', 'authenticated')::text, true);
  r := r || case when not private.has_role('agent') and not private.has_role('nonsense') and public.my_staff_tier() is null
                 then 'ok members have no staff capability; ' else 'FAIL member; ' end;

  -- ===== Admin screens see implied roles =====
  perform set_config('request.jwt.claims', json_build_object('sub', mas, 'role', 'authenticated')::text, true);
  roles := public.my_live_roles();
  r := r || case when roles @> array['admin', 'moderator', 'master_admin'] and public.my_staff_tier() = 'master_admin'
                 then 'ok my_live_roles includes implied admin/moderator; ' else 'FAIL roles ' || roles::text || '; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  roles := public.my_live_roles();
  r := r || case when roles = array['agent'] then 'ok agent sees no admin screens; ' else 'FAIL agent roles ' || roles::text || '; ' end;

  -- ===== Granting rules =====
  perform set_config('request.jwt.claims', json_build_object('sub', mas, 'role', 'authenticated')::text, true);
  perform public.admin_grant_staff_role(mem, 'sub_admin');
  reset role;
  r := r || case when private.rank_of(mem) = 30 then 'ok master admin grants sub admin; ' else 'FAIL grant; ' end;
  set local role authenticated;
  begin
    perform public.admin_grant_staff_role(mem2, 'master_admin');
    r := r || 'FAIL master granted a peer role; ';
  exception when insufficient_privilege then r := r || 'ok cannot grant own level; ';
  end;
  begin
    perform public.admin_grant_staff_role(mem2, 'super_admin');
    r := r || 'FAIL granted super; ';
  exception when invalid_parameter_value then r := r || 'ok super admin can never be granted through the API; ';
  end;
  begin
    perform public.admin_grant_staff_role(leg, 'agent');
    r := r || 'FAIL changed a peer; ';
  exception when insufficient_privilege then r := r || 'ok cannot change someone at the same level; ';
  end;
  begin
    perform public.admin_grant_staff_role(mas, 'agent');
    r := r || 'FAIL self change; ';
  exception when insufficient_privilege then r := r || 'ok cannot change own roles; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform public.admin_grant_staff_role(mem2, 'agent');
  reset role;
  r := r || case when private.rank_of(mem2) = 20 then 'ok sub admin grants agent; ' else 'FAIL agent grant; ' end;
  set local role authenticated;
  begin
    perform public.admin_grant_staff_role(mem2, 'sub_admin');
    r := r || 'FAIL sub granted sub admin; ';
  exception when insufficient_privilege then r := r || 'ok sub admin cannot grant its own level; ';
  end;
  begin
    perform public.admin_set_role(mem2, 'moderator', true);
    r := r || 'FAIL sub used the legacy admin function; ';
  exception when insufficient_privilege then r := r || 'ok legacy role function stays admin-only; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_grant_staff_role(gen_random_uuid(), 'agent');
    r := r || 'FAIL agent changed roles; ';
  exception when insufficient_privilege then r := r || 'ok agents cannot manage roles; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', sup, 'role', 'authenticated')::text, true);
  perform public.admin_grant_staff_role(mem, 'master_admin');
  reset role;
  r := r || case when private.rank_of(mem) = 40 then 'ok super admin grants master admin; ' else 'FAIL super grant; ' end;
  set local role authenticated;
  begin
    perform public.admin_grant_staff_role(gen_random_uuid(), 'agent');
    r := r || 'FAIL granted to nobody; ';
  exception when raise_exception then r := r || 'ok unknown members are refused; ';
  end;
  select count(*) into n from public.admin_list_staff();
  r := r || case when n = 8 then 'ok staff directory lists every role; ' else 'FAIL staff ' || n || '; ' end;
  reset role;
  select count(*) into n from public.moderation_actions where action in ('role_granted', 'role_revoked');
  r := r || case when n = 3 then 'ok every role change is logged; ' else 'FAIL logged ' || n || '; ' end;
  set local role authenticated;

  -- ===== Agent support queue =====
  perform set_config('request.jwt.claims', json_build_object('sub', agt, 'role', 'authenticated')::text, true);
  select count(*) into n from public.support_report_queue(50) q where q.id = rep and q.has_details and not q.escalated;
  r := r || case when n = 1 then 'ok agent sees the report queue; ' else 'FAIL queue; ' end;
  begin
    perform 1 from public.reports where id = rep;
    select count(*) into n from public.reports where id = rep;
    r := r || case when n = 0 then 'ok agent cannot read report rows directly; ' else 'FAIL agent read report row; ' end;
  end;
  begin
    perform public.support_escalate_report(rep, 'no');
    r := r || 'FAIL short note; ';
  exception when invalid_parameter_value then r := r || 'ok escalation needs a note; ';
  end;
  perform public.support_escalate_report(rep, 'Repeated harassment, needs moderator');
  select count(*) into n from public.support_report_queue(50) q where q.id = rep and q.escalated;
  r := r || case when n = 1 then 'ok escalation is recorded; ' else 'FAIL escalate; ' end;
  begin
    perform public.admin_list_reports();
    r := r || 'FAIL agent moderated; ';
  exception when insufficient_privilege then r := r || 'ok agents cannot open the moderation queue; ';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', mem2, 'role', 'authenticated')::text, true);
  -- mem2 is now an agent (granted above); a plain member is refused:
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform public.support_report_queue(10);
    r := r || 'FAIL member read queue; ';
  exception when insufficient_privilege then r := r || 'ok members cannot read the support queue; ';
  end;

  -- ===== Owner-only constraint =====
  reset role;
  begin
    insert into private.user_roles (user_id, role) values (mem2, 'owner');
    r := r || 'FAIL unknown role stored; ';
  exception when check_violation then r := r || 'ok unknown roles are refused; ';
  end;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
