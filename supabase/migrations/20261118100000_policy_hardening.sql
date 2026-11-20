-- RentMate policy hardening (audit 2026-11-18).
--
-- Permanent policy: no pornography, sexually explicit content, adult entertainment, sexual services, escorting
-- or sexual solicitation, anywhere, in any country.
--
-- Additive only. No rows are deleted or rewritten; the checks below run only when text is written, so historical
-- records stay intact for moderation and evidence.

-- ---------- 1. Prohibited wording in text members write ----------
-- Conservative list: terms whose ordinary meaning on a dating/social platform is adult content or sexual
-- solicitation. Returns the first match, or null.
create function private.prohibited_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select (regexp_match(
    lower(coalesce(p_text, '')),
    '(\mporn\w*|\mp0rn\w*|\mpr0n\M|\mxxx\M|\mnsfw\M|\monlyfans\M|\mnudes\M|\mnudity\M|\msexting\M|\mcam ?girls?\M'
    || '|\mescort(s|ing)?\M|\msex(ual)? ?(services?|work|worker|chat)\M|\m(paid|money|cash) (for|4) sex\M'
    || '|\msex (for|4) (money|cash|pay)\M)'
  ))[1];
$$;
revoke execute on function private.prohibited_text(text) from public;

create function private.reject_prohibited_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(new);
  t text;
begin
  -- Read the row as JSON so one function serves every table (columns differ per table).
  t := case tg_table_name
    when 'profiles' then concat_ws(' ', r->>'display_name', r->>'bio', r->>'job', r->>'prompts')
    when 'messages' then r->>'body'
    when 'likes' then r->>'message'
    when 'creators' then concat_ws(' ', r->>'stage_name', r->>'bio')
    when 'live_streams' then r->>'title'
    else null
  end;
  if private.prohibited_text(t) is not null then
    raise exception 'RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.reject_prohibited_text() from public;

create trigger profiles_no_prohibited_text
  before insert or update of display_name, bio, job, prompts on public.profiles
  for each row execute function private.reject_prohibited_text();
create trigger messages_no_prohibited_text
  before insert or update of body on public.messages
  for each row execute function private.reject_prohibited_text();
create trigger likes_no_prohibited_text
  before insert or update of message on public.likes
  for each row execute function private.reject_prohibited_text();
create trigger creators_no_prohibited_text
  before insert or update of stage_name, bio on public.creators
  for each row execute function private.reject_prohibited_text();
create trigger live_streams_no_prohibited_text
  before insert or update of title on public.live_streams
  for each row execute function private.reject_prohibited_text();

-- ---------- 2. Providers can never be permitted an adult category ----------
create function private.reject_provider_adult_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from unnest(coalesce(new.permitted_categories, '{}'::text[])) as k(key)
    join public.content_categories c on c.key = k.key
    where c.explicit or not c.available
  ) then
    raise exception 'RentMate does not support adult or sexually explicit content.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.reject_provider_adult_categories() from public;
create trigger live_providers_no_adult_content
  before insert or update of permitted_categories on public.live_providers
  for each row execute function private.reject_provider_adult_categories();

-- ---------- 3. Members can report sexual content and solicitation ----------
-- Superset of the old reasons, so every existing report stays valid.
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in (
  'fake', 'inappropriate', 'harassment', 'underage', 'scam', 'other', 'sexual_content', 'sexual_solicitation'));

alter table public.live_reports drop constraint live_reports_reason_check;
alter table public.live_reports add constraint live_reports_reason_check check (reason in (
  'minor', 'non_consensual', 'trafficking_or_coercion', 'leaked_or_stolen', 'violence', 'harassment', 'hate',
  'spam_or_scam', 'illegal_in_my_country', 'other', 'sexual_content', 'sexual_solicitation'));

-- Sexual content and solicitation in live/private sessions go to the top of the moderation queue.
create or replace function private.live_report_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.priority := case when new.reason in ('minor', 'non_consensual', 'trafficking_or_coercion', 'leaked_or_stolen',
                                           'violence', 'sexual_content', 'sexual_solicitation')
                       then 'urgent' else 'normal' end;
  new.status := 'open';
  new.handled_by := null;
  new.handled_at := null;
  if (select count(*) from public.live_reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily report limit reached.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
