-- Integration secret strength (migration 20261123100000_integration_secret_strength.sql). Always rolls back.
-- Every result must start with "ok".
do $$
declare r text := ''; v text;
begin
  foreach v in array array[
    'short-secret',                                   -- too short
    'correct horse battery staple and more words',    -- spaces: a phrase, not a generated token
    'passwordpasswordpasswordpassword',               -- 32 characters, 7 distinct
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'        -- 1 distinct
  ] loop
    begin
      perform private.set_integration_secret('livekit_webhook', v);
      r := r || 'FAIL accepted ' || left(v, 12) || '; ';
    exception when invalid_parameter_value then r := r || 'ok refused a guessable secret (' || char_length(v) || ' chars); ';
    end;
  end loop;
  -- What `openssl rand -base64 48` and `openssl rand -hex 32` produce is accepted, and only its hash is stored.
  perform private.set_integration_secret('livekit_webhook', 'q3Vx9+Lr0aZk/2mWfT7bYc4NpH1sJdE8uG6oRiQ5wXyKjAlMnB0vC2eF4gS7hT9u');
  perform private.set_integration_secret('livekit_webhook', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  r := r || case when private.integration_secret_ok('livekit_webhook', '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
                 then 'ok generated base64 and hex secrets are accepted and verify; ' else 'FAIL generated secret; ' end;
  r := r || case when not exists (select 1 from private.integration_secrets
                                  where secret_sha256::text like '%9f86d081884c7d659a2feaa0c55ad015%')
                 then 'ok only a hash is stored, never the value; ' else 'FAIL plaintext stored; ' end;
  r := r || case when not private.integration_secret_ok('livekit_webhook', 'q3Vx9+Lr0aZk/2mWfT7bYc4NpH1sJdE8uG6oRiQ5wXyKjAlMnB0vC2eF4gS7hT9u')
                 then 'ok replacing the secret invalidates the old one; ' else 'FAIL old secret still valid; ' end;
  raise exception 'ROLLED BACK. RESULTS: %', r;
end $$;
