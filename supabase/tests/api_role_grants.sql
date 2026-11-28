-- Privileges for the API roles under current Supabase defaults (no automatic grants; see supabase_stubs.sql).
-- Regression test for "permission denied for table likes" on RentMate-staging. Always rolls back.
-- Every result must start with "ok".
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  r text := ''; n int; mid uuid; missing text;
begin
  -- 1. Every RLS policy for signed-in users has the privilege it needs. A policy without its grant is dead: the
  --    database refuses before RLS runs (the staging bug).
  -- Policies are read straight from pg_policy/pg_class (public schema only), so each table is addressed by oid.
  with pol as materialized (
    select c.oid as rel, c.relname, pp.polname,
           case pp.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE'
                          when 'd' then 'DELETE' else 'ALL' end as cmd
    from pg_policy pp
    join pg_class c on c.oid = pp.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and pp.polpermissive
      and (pp.polroles = '{0}'::oid[] or 'authenticated'::regrole::oid = any (pp.polroles))
  )
  select string_agg(format('%s %s (%s)', relname, cmd, polname), ', ' order by relname, cmd)
    into missing
  from pol
  where not (
      case when cmd = 'ALL' then
        has_table_privilege('authenticated', rel, 'SELECT') or has_any_column_privilege('authenticated', rel, 'SELECT')
      when cmd = 'DELETE' then
        has_table_privilege('authenticated', rel, 'DELETE')
      else
        has_table_privilege('authenticated', rel, cmd) or has_any_column_privilege('authenticated', rel, cmd)
      end);
  r := r || case when missing is null then 'ok every signed-in policy has its privilege; '
                 else 'FAIL policies without privileges: ' || missing || '; ' end;

  -- 2. anon gets nothing on the social tables.
  select count(*) into n
  from unnest(array['likes','passes','matches','messages','blocks','reports']) t,
       unnest(array['SELECT','INSERT','UPDATE','DELETE']) pr
  where has_table_privilege('anon', format('public.%I', t), pr)
     or (pr <> 'DELETE' and has_any_column_privilege('anon', format('public.%I', t), pr));
  r := r || case when n = 0 then 'ok anon has no access to the social tables; ' else 'FAIL anon privileges: ' || n || '; ' end;

  -- 3. Members cannot rewrite or delete likes and messages (no UPDATE/DELETE privilege, no policy).
  r := r || case when not has_table_privilege('authenticated', 'public.likes', 'UPDATE')
                  and not has_table_privilege('authenticated', 'public.likes', 'DELETE')
                  and not has_table_privilege('authenticated', 'public.messages', 'UPDATE')
                  and not has_table_privilege('authenticated', 'public.messages', 'DELETE')
                  and not has_table_privilege('authenticated', 'public.matches', 'INSERT')
             then 'ok likes, messages and match creation stay server-controlled; '
             else 'FAIL members can rewrite likes, messages or create matches; ' end;

  -- 4. The likes flow as the app runs it.
  insert into auth.users (id, email, aud, role, instance_id) values
    (a, 'a@grants.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (b, 'b@grants.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (c, 'c@grants.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (s, 's@grants.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, display_name, age, looking_for, age_min, age_max) values
    (a, 'Asha', 30, 'friendship', 18, 60), (b, 'Bilal', 31, 'friendship', 18, 60),
    (c, 'Chitra', 32, 'friendship', 18, 60), (s, 'Suresh', 33, 'friendship', 18, 60);
  insert into public.account_suspensions (user_id, reason) values (s, 'test');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.likes (liker_id, liked_id) values (a, b);
  r := r || 'ok a member can like; ';
  select count(*) into n from public.likes where liker_id = a;
  r := r || case when n = 1 then 'ok "You liked" reads your own likes; ' else 'FAIL own likes: ' || n || '; ' end;
  begin
    insert into public.likes (liker_id, liked_id) values (b, c);
    r := r || 'FAIL liked on behalf of someone else; ';
  exception when insufficient_privilege or check_violation or raise_exception then
    r := r || 'ok cannot like on behalf of someone else; ';
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.likes where liked_id = b;
  r := r || case when n = 1 then 'ok "Liked you" reads likes you received; ' else 'FAIL received likes: ' || n || '; ' end;
  insert into public.likes (liker_id, liked_id) values (b, a);
  select id into mid from public.matches where (user_a, user_b) = (least(a, b), greatest(a, b));
  r := r || case when mid is not null then 'ok a mutual like creates the match; ' else 'FAIL no match; ' end;
  select count(*) into n from public.matches where id = mid;
  r := r || case when n = 1 then 'ok participants see their match; ' else 'FAIL participant match: ' || n || '; ' end;
  insert into public.messages (match_id, sender_id, body) values (mid, b, 'hello');
  select count(*) into n from public.messages where match_id = mid;
  r := r || case when n = 1 then 'ok participants read and send messages; ' else 'FAIL messages: ' || n || '; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  select count(*) into n from public.likes where liker_id in (a, b) or liked_id in (a, b);
  r := r || case when n = 0 then 'ok others cannot read likes between two people; ' else 'FAIL cross-user likes: ' || n || '; ' end;
  select count(*) into n from public.matches where id = mid;
  r := r || case when n = 0 then 'ok others cannot see the match; ' else 'FAIL cross-user match; ' end;
  select count(*) into n from public.messages where match_id = mid;
  r := r || case when n = 0 then 'ok others cannot read the chat; ' else 'FAIL cross-user messages; ' end;
  insert into public.blocks (blocker_id, blocked_id) values (c, a);
  r := r || 'ok a member can block; ';
  begin
    insert into public.likes (liker_id, liked_id) values (c, a);
    r := r || 'FAIL liked someone they blocked; ';
  exception when others then
    r := r || 'ok cannot like someone in a block; ';
  end;
  insert into public.reports (reporter_id, reported_id, reason) values (c, a, 'other');
  select count(*) into n from public.reports where reporter_id = c;
  r := r || case when n = 1 then 'ok a member can report and see their own report; ' else 'FAIL report: ' || n || '; ' end;
  insert into public.passes (passer_id, passed_id) values (c, b);
  delete from public.passes where passer_id = c and passed_id = b;
  get diagnostics n = row_count;
  r := r || case when n = 1 then 'ok passes can be made and undone; ' else 'FAIL pass undo; ' end;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  begin
    insert into public.likes (liker_id, liked_id) values (s, b);
    r := r || 'FAIL a suspended account liked someone; ';
  exception when insufficient_privilege then
    -- Ordinary members liked successfully above, so this refusal is the suspension rule, not a missing grant.
    r := r || 'ok suspended accounts cannot like; ';
  end;
  reset role;

  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
