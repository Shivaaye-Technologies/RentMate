-- Rollback for 20261123100000_integration_secret_strength.sql. NOT a migration. Founder approval first.
-- Restores the setter from 20261121090000_calls_and_live_rooms.sql, verbatim. A secret already set is unaffected.
create or replace function private.set_integration_secret(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if char_length(coalesce(p_secret, '')) < 32 then
    raise exception 'Integration secrets must be at least 32 characters.' using errcode = '22023';
  end if;
  insert into private.integration_secrets (name, secret_sha256) values (p_name, sha256(convert_to(p_secret, 'UTF8')))
  on conflict (name) do update set secret_sha256 = excluded.secret_sha256, set_at = now();
end;
$$;
revoke execute on function private.set_integration_secret(text, text) from public, anon, authenticated;
