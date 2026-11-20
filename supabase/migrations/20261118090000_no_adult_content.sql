-- RentMate does not support pornographic, sexually explicit or adult content anywhere.
--
-- Nothing is deleted: the existing 'adult' category row is kept for history but marked unavailable,
-- and the database refuses to enable adult content in any country or to use an adult or unknown
-- category for a creator application, stream or private session.

-- Categories: explicit categories can never be available.
alter table public.content_categories add column if not exists available boolean not null default true;
update public.content_categories set available = false where explicit;
alter table public.content_categories
  add constraint explicit_never_available check (not (explicit and available));

-- Country policies: adult content is off in every country (replaces the per-country clearance route).
update public.country_policies set explicit_allowed = false where explicit_allowed;
alter table public.country_policies add constraint no_adult_content check (not explicit_allowed);

-- Creators, streams and private sessions may only use available, non-explicit categories.
create function private.reject_unavailable_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cats text[];
begin
  if tg_table_name = 'creators' then
    cats := new.categories;
  else
    cats := array[new.category];
  end if;
  if exists (
    select 1
    from unnest(coalesce(cats, '{}'::text[])) as k(key)
    left join public.content_categories c on c.key = k.key
    where c.key is null or c.explicit or not c.available
  ) then
    raise exception 'RentMate does not support adult or sexually explicit content.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.reject_unavailable_categories() from public;

create trigger creators_no_adult_content
  before insert or update of categories on public.creators
  for each row execute function private.reject_unavailable_categories();

create trigger live_streams_no_adult_content
  before insert or update of category on public.live_streams
  for each row execute function private.reject_unavailable_categories();

create trigger private_sessions_no_adult_content
  before insert or update of category on public.private_sessions
  for each row execute function private.reject_unavailable_categories();
