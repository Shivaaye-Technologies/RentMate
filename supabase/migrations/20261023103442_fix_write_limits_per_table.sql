-- Fix: the single IF condition referenced new.sender_id for every table, and
-- PL/pgSQL resolves it even for likes/reports rows, so every like and report
-- insert failed ("record new has no field sender_id"). Each table's check now
-- sits in its own branch, which is only planned for that table's rows.
create or replace function public.enforce_write_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'messages' then
    if (select count(*) from public.messages m
        where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 20 then
      raise exception 'You are sending messages too fast. Please wait a moment.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'likes' then
    if (select count(*) from public.likes l
        where l.liker_id = new.liker_id and l.created_at > now() - interval '1 day') >= 300 then
      raise exception 'Daily like limit reached. Try again tomorrow.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'reports' then
    if (select count(*) from public.reports r
        where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') >= 20 then
      raise exception 'Daily report limit reached.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
