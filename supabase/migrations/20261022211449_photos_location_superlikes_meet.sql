-- Photos, coarse location, online status, verification, Super Likes, rewind,
-- likes received, and "ready to meet".

-- 1. Profile fields --------------------------------------------------------
-- lat/lng are stored with 2 decimals (about 1 km) so exact locations are never kept.
alter table public.profiles
  add column photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  add column lat numeric(5, 2) check (lat between -90 and 90),
  add column lng numeric(5, 2) check (lng between -180 and 180),
  add column last_seen_at timestamptz not null default now(),
  add column verified boolean not null default false;

-- Users may write only these columns. "verified", created_at and updated_at
-- cannot be set by users (verification is granted by an admin).
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, display_name, age, bio, interests, looking_for, age_min, age_max, photo_path, lat, lng, last_seen_at)
  on public.profiles to authenticated;
grant update (id, display_name, age, bio, interests, looking_for, age_min, age_max, photo_path, lat, lng, last_seen_at)
  on public.profiles to authenticated;

-- 2. Likes: Super Likes, likes received, rewind ------------------------------
alter table public.likes
  add column is_super boolean not null default false,
  add column message text check (message is null or char_length(message) between 1 and 300);

-- People can see who liked them (the Likes screen).
create policy "likes select received" on public.likes for select to authenticated
  using (liked_id = (select auth.uid()));

-- Rewind: undo your own pass.
create policy "passes delete own" on public.passes for delete to authenticated
  using (passer_id = (select auth.uid()));

-- At most 3 Super Likes per rolling 24 hours.
create function public.enforce_super_like_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_super and (
    select count(*) from public.likes l
    where l.liker_id = new.liker_id and l.is_super and l.created_at > now() - interval '1 day'
  ) >= 3 then
    raise exception 'You can send 3 Super Likes per day' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_super_like_limit() from public, anon, authenticated;

create trigger likes_super_limit
  before insert on public.likes
  for each row execute function public.enforce_super_like_limit();

-- 3. Ready to meet -----------------------------------------------------------
alter table public.matches
  add column ready_a boolean not null default false,
  add column ready_b boolean not null default false;

-- Each participant can set only their own flag. A security-definer function is
-- used because RLS cannot restrict which of the two columns a user changes.
create function public.set_ready_to_meet(p_match_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  update public.matches
     set ready_a = case when user_a = uid then p_ready else ready_a end,
         ready_b = case when user_b = uid then p_ready else ready_b end
   where id = p_match_id and uid in (user_a, user_b);
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_ready_to_meet(uuid, boolean) from public, anon;
grant execute on function public.set_ready_to_meet(uuid, boolean) to authenticated;

-- 4. Photo storage -----------------------------------------------------------
-- Public-read bucket; paths are <user id>/<random>.jpg so they cannot be guessed
-- or listed. Users can write only inside their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy "photos insert own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
