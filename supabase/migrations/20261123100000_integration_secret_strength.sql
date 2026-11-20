-- The LiveKit webhook integration secret is stored as an unsalted SHA-256 (private.integration_secrets). That is the
-- right storage for a high-entropy machine secret (like an API token) but not for anything a person might choose: a
-- guessable value could be recovered offline from its hash. Until now only the length (>= 32) was checked.
-- Now the value must look like a generated token: at least 32 characters from the base64/hex/url-safe alphabet (no
-- spaces) with at least 12 distinct characters. Generate it with: openssl rand -base64 48
-- Append-only. Does not touch a secret that is already set.
create or replace function private.set_integration_secret(p_name text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v text := coalesce(p_secret, '');
begin
  if char_length(v) < 32 then
    raise exception 'Integration secrets must be at least 32 characters.' using errcode = '22023';
  end if;
  if v !~ '^[A-Za-z0-9+/=_-]+$' then
    raise exception 'Integration secrets must be a generated token (letters, digits, + / = _ - only; no spaces). Use: openssl rand -base64 48'
      using errcode = '22023';
  end if;
  if (select count(distinct c) from regexp_split_to_table(v, '') c) < 12 then
    raise exception 'Integration secret looks guessable (too few distinct characters). Use: openssl rand -base64 48'
      using errcode = '22023';
  end if;
  insert into private.integration_secrets (name, secret_sha256) values (p_name, sha256(convert_to(v, 'UTF8')))
  on conflict (name) do update set secret_sha256 = excluded.secret_sha256, set_at = now();
end;
$$;
revoke execute on function private.set_integration_secret(text, text) from public, anon, authenticated;
