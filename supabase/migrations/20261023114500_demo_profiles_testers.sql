-- Demo profiles for testing, visible only to tester accounts.
--
-- * profiles.is_demo marks fictional demo profiles (seeded by supabase/seed/demo_profiles.sql).
-- * profiles.is_tester marks accounts allowed to see them (granted by an admin in SQL).
-- Users can set neither column (they are outside the column grants).
-- Everyone who is not a tester never sees a demo profile: not in discovery,
-- not by id, not by reading the table, and cannot like one.
-- Demo profiles like testers back (most of the time) and send short automatic
-- replies in chat, so likes, matching and messaging can be tested end to end.

alter table public.profiles
  add column is_demo boolean not null default false,
  add column is_tester boolean not null default false;

create index profiles_is_demo_idx on public.profiles (id) where is_demo;

-- True when the caller is a tester.
create function private.is_tester()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_tester from public.profiles p where p.id = (select auth.uid())), false);
$$;
revoke execute on function private.is_tester() from public;
grant execute on function private.is_tester() to authenticated;

-- True when `other` is a demo profile and the caller is not a tester.
create function private.hidden_demo(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = other and p.is_demo)
     and not private.is_tester();
$$;
revoke execute on function private.hidden_demo(uuid) from public;
grant execute on function private.hidden_demo(uuid) to authenticated;

-- Restrictive policies are combined with AND on top of the existing ones.
create policy "demo profiles only for testers" on public.profiles
  as restrictive for select to authenticated
  using (not private.hidden_demo(id));

create policy "cannot like hidden demo profiles" on public.likes
  as restrictive for insert to authenticated
  with check (not private.hidden_demo(liked_id));

-- Discovery and by-id lookups: same as before, plus the demo rule. Demo
-- profiles take turns appearing online (each about a quarter of the time,
-- changing every 10 minutes) because nobody is signed in to them.
create or replace function private.people(p_ids uuid[], p_limit int)
returns table (
  id uuid,
  display_name text,
  age int,
  bio text,
  interests text[],
  looking_for text,
  age_min int,
  age_max int,
  photo_path text,
  verified boolean,
  created_at timestamptz,
  distance_km int,
  online boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select (select auth.uid()) as uid, p.lat::float8 as lat, p.lng::float8 as lng,
           coalesce(p.is_tester, false) as tester
    from (select 1) one
    left join public.profiles p on p.id = (select auth.uid())
  )
  select
    p.id, p.display_name, p.age, p.bio, p.interests, p.looking_for, p.age_min, p.age_max,
    p.photo_path, p.verified, p.created_at,
    private.distance_bucket(me.lat, me.lng, p.lat::float8, p.lng::float8),
    case
      when p.is_demo then abs(hashtext(p.id::text || floor(extract(epoch from now()) / 600)::text)) % 4 = 0
      else p.last_seen_at > now() - interval '10 minutes'
    end
  from public.profiles p
  cross join me
  where me.uid is not null
    and p.id <> me.uid
    and (not p.is_demo or me.tester)
    and not private.blocked_either(p.id)
    and (
      (
        p_ids is null
        and not exists (select 1 from public.likes l where l.liker_id = me.uid and l.liked_id = p.id)
        and not exists (select 1 from public.passes s where s.passer_id = me.uid and s.passed_id = p.id)
      )
      or (
        p_ids is not null
        and p.id = any (p_ids)
        and (
          exists (select 1 from public.likes l
                  where (l.liker_id = p.id and l.liked_id = me.uid) or (l.liker_id = me.uid and l.liked_id = p.id))
          or exists (select 1 from public.matches m
                     where (m.user_a = me.uid and m.user_b = p.id) or (m.user_b = me.uid and m.user_a = p.id))
        )
      )
    )
  order by p.last_seen_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 500);
$$;

-- Ids of demo profiles, for the "Demo" label in the app. Empty for non-testers.
create function private.demo_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p where p.is_demo and private.is_tester();
$$;
revoke execute on function private.demo_profile_ids() from public;
grant execute on function private.demo_profile_ids() to authenticated;

create function public.demo_profile_ids()
returns setof uuid
language sql stable security invoker set search_path = ''
as $$ select * from private.demo_profile_ids(); $$;
revoke execute on function public.demo_profile_ids() from public, anon;
grant execute on function public.demo_profile_ids() to authenticated;

-- A tester likes a demo profile: the demo likes back about 3 times in 4
-- (always for a Super Like), which creates the match through the existing trigger.
create function private.demo_like_back()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles d where d.id = new.liked_id and d.is_demo)
     and exists (select 1 from public.profiles t where t.id = new.liker_id and t.is_tester and not t.is_demo)
     and (new.is_super or abs(hashtext(new.liker_id::text || new.liked_id::text)) % 4 <> 0)
  then
    insert into public.likes (liker_id, liked_id) values (new.liked_id, new.liker_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function private.demo_like_back() from public;

create trigger likes_demo_like_back
  after insert on public.likes
  for each row execute function private.demo_like_back();

-- A tester messages a demo match: the demo answers with the next short reply
-- (up to 10 per conversation), so chat and realtime updates can be tested.
create function private.demo_auto_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  demo public.profiles%rowtype;
  sent int;
  topic text;
  replies text[];
begin
  select d.* into demo
  from public.matches m
  join public.profiles d
    on d.id = case when m.user_a = new.sender_id then m.user_b else m.user_a end
  where m.id = new.match_id and d.is_demo;

  if not found
     or not exists (select 1 from public.profiles t where t.id = new.sender_id and t.is_tester and not t.is_demo)
  then
    return new;
  end if;

  select count(*) into sent from public.messages x
  where x.match_id = new.match_id and x.sender_id = demo.id;
  if sent >= 10 then
    return new;
  end if;

  topic := coalesce(lower(demo.interests[1]), 'music');
  replies := array[
    'Hey! Thanks for the message 😊 How is your day going?',
    format('I saw your profile — what got you into it? I''m pretty obsessed with %s lately.', topic),
    'Haha, that''s great. What do you usually do on weekends?',
    'Nice! I''m more of a slow-morning, good-coffee kind of person.',
    format('Have you tried any %s spots around here? I''m always looking for new ones.', topic),
    'Okay, important question: mountains or beaches?',
    'Good answer 😄 What''s one thing on your bucket list?',
    'I love that. Mine is to travel somewhere completely new every year.',
    'This is fun. Do you prefer chatting here or meeting for a coffee sometime?',
    'Heads up: I''m a demo profile for testing, so my replies stop here. 👋'
  ];

  insert into public.messages (match_id, sender_id, body)
  values (new.match_id, demo.id, replies[sent + 1]);
  return new;
end;
$$;
revoke execute on function private.demo_auto_reply() from public;

create trigger messages_demo_auto_reply
  after insert on public.messages
  for each row execute function private.demo_auto_reply();
