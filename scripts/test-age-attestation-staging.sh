#!/usr/bin/env bash
# Staging rehearsal of database-level age attestation (P2-03) on a real, disposable PostgreSQL server.
#
# Builds a fresh database from every migration, adds an existing member and the demo seed, then runs the real
# operations files: docs/ops/require_age_attestation.enable.sql (staging value: true), checks the rules with one
# session per request (as separate Supabase REST requests would), runs require_age_attestation.disable.sql and the
# migration rollback, and checks that the previous behaviour returns.
#
# Usage: PGHOST=... PGPORT=... PGUSER=... [PGPASSWORD=...] scripts/test-age-attestation-staging.sh
# It creates and drops its own database (rentmate_age_staging_<pid>). Never point it at production.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="rentmate_age_staging_$$"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
fail=0
passed=0
ok() { echo "ok   $1"; passed=$((passed + 1)); }
bad() { echo "FAIL $1"; fail=1; }
cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${PSQL[@]}" -d postgres -c "create database $DB"
{
  sed -E "s/^create role ([a-z_]+) nologin;/do \$\$ begin create role \1 nologin; exception when duplicate_object then null; end \$\$;/" \
    supabase/tests/supabase_stubs.sql
  for f in supabase/migrations/*.sql; do cat "$f"; echo; done
} | "${PSQL[@]}" -d "$DB" >/dev/null
echo "Migrations applied to a fresh PostgreSQL $("${PSQL[@]}" -d "$DB" -c 'show server_version')."

owner() { "${PSQL[@]}" -d "$DB" -c "$1" 2>&1; }
# One request as a signed-in member (role authenticated + JWT claims), in its own session and transaction.
as_member() {
  "${PSQL[@]}" -d "$DB" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true) is null;
$2
commit;
SQL
}
expect_ok() { if out=$(eval "$2"); then ok "$1"; else bad "$1: $out"; fi; }
expect_err() { # $1 name, $2 command, $3 pattern the error must contain
  if out=$(eval "$2"); then bad "$1: was accepted"; elif grep -qiE "$3" <<<"$out"; then ok "$1"; else bad "$1: $out"; fi
}

ADULT=33333333-0000-4000-8000-000000000001
MINOR=33333333-0000-4000-8000-000000000002
NOCONF=33333333-0000-4000-8000-000000000003
NODOB=33333333-0000-4000-8000-000000000004
NONE=33333333-0000-4000-8000-000000000005
EXIST=33333333-0000-4000-8000-000000000006
FAKEDEMO=33333333-0000-4000-8000-000000000007
PROFILE="display_name, age, looking_for, age_min, age_max"
ADULT_DOB="(current_date - interval '25 years')::date"

owner "insert into auth.users (id, email, aud, role) values
  ('$ADULT', 'adult@staging.test', 'authenticated', 'authenticated'),
  ('$MINOR', 'minor@staging.test', 'authenticated', 'authenticated'),
  ('$NOCONF', 'noconf@staging.test', 'authenticated', 'authenticated'),
  ('$NODOB', 'nodob@staging.test', 'authenticated', 'authenticated'),
  ('$NONE', 'none@staging.test', 'authenticated', 'authenticated'),
  ('$EXIST', 'existing@staging.test', 'authenticated', 'authenticated'),
  ('$FAKEDEMO', 'fake-demo@staging.test', 'authenticated', 'authenticated');
insert into public.profiles (id, $PROFILE) values ('$EXIST', 'Existing', 33, 'friendship', 18, 60);" >/dev/null
"${PSQL[@]}" -d "$DB" -f supabase/seed/demo_profiles.sql >/dev/null
DEMO_BEFORE=$(owner "select count(*) from public.profiles where is_demo")
echo "Before enabling: 1 existing member, $DEMO_BEFORE demo profiles, require_age_attestation = $(owner 'select require_age_attestation from public.platform_settings')."

# ===== Enable (staging value: true) =====
"${PSQL[@]}" -d "$DB" -f docs/ops/require_age_attestation.enable.sql >/dev/null
[ "$(owner 'select require_age_attestation from public.platform_settings')" = "t" ] &&
  ok "enable script sets require_age_attestation = true" || bad "enable script"

# ===== Rules =====
expect_err "direct REST insert without an attestation is refused" \
  "as_member $NONE \"insert into public.profiles (id, $PROFILE) values ('$NONE', 'Nina', 30, 'friendship', 18, 60);\"" \
  "confirm your date of birth"
expect_err "direct REST upsert without an attestation is refused" \
  "as_member $NONE \"insert into public.profiles (id, $PROFILE) values ('$NONE', 'Nina', 30, 'friendship', 18, 60) on conflict (id) do update set bio = 'x';\"" \
  "confirm your date of birth"
expect_err "under-18 date of birth is refused" \
  "as_member $MINOR \"select public.attest_adult((current_date - interval '17 years')::date, true);\"" "18 or over"
expect_err "...and that member still cannot create a profile" \
  "as_member $MINOR \"insert into public.profiles (id, $PROFILE) values ('$MINOR', 'Yash', 18, 'friendship', 18, 60);\"" \
  "confirm your date of birth"
expect_err "missing 18+ confirmation is refused" \
  "as_member $NOCONF \"select public.attest_adult($ADULT_DOB, false);\"" "confirm that you are 18"
expect_err "...and that member still cannot create a profile" \
  "as_member $NOCONF \"insert into public.profiles (id, $PROFILE) values ('$NOCONF', 'Chirag', 25, 'friendship', 18, 60);\"" \
  "confirm your date of birth"
expect_err "missing date of birth is refused" \
  "as_member $NODOB \"select public.attest_adult(null, true);\"" "valid date of birth"
expect_err "...and that member still cannot create a profile" \
  "as_member $NODOB \"insert into public.profiles (id, $PROFILE) values ('$NODOB', 'Mira', 25, 'friendship', 18, 60);\"" \
  "confirm your date of birth"
[ "$(owner "select count(*) from private.age_attestations where user_id in ('$MINOR','$NOCONF','$NODOB')")" = "0" ] &&
  ok "nothing is stored for refused attempts" || bad "refused attempts stored something"

expect_ok "normal sign-up: valid adult attestation, then profile creation (as onboarding does)" \
  "as_member $ADULT \"select public.attest_adult($ADULT_DOB, true); insert into public.profiles (id, $PROFILE) values ('$ADULT', 'Asha', 30, 'friendship', 18, 60) on conflict (id) do update set display_name = excluded.display_name;\""
[ "$(owner "select age from public.profiles where id = '$ADULT'")" = "25" ] &&
  ok "the new profile's age comes from the attested date of birth" || bad "attested age"
[ "$(owner "select method from private.age_attestations where user_id = '$ADULT'")" = "self_declared" ] &&
  ok "the record is labelled self_declared" || bad "method label"
expect_err "members cannot read the attestation table" \
  "as_member $NONE \"select count(*) from private.age_attestations;\"" "permission denied"
[ "$(as_member $NONE "select count(*) from public.my_age_attestation();" | tail -1)" = "0" ] &&
  ok "another member sees no date of birth" || bad "date of birth leak"
expect_err "members cannot change the switch" \
  "as_member $NONE \"update public.platform_settings set require_age_attestation = false;\"" "permission denied"

expect_ok "existing member (no attestation) can still update their profile" \
  "as_member $EXIST \"update public.profiles set bio = 'Still here', age = 34 where id = '$EXIST';\""
expect_ok "existing member can still upsert their profile (as the API's PUT /profile does)" \
  "as_member $EXIST \"insert into public.profiles (id, $PROFILE) values ('$EXIST', 'Existing', 34, 'friendship', 18, 60) on conflict (id) do update set display_name = excluded.display_name;\""
[ "$(as_member $EXIST "select count(*) from public.profiles where id = '$EXIST';" | tail -1)" = "1" ] &&
  ok "existing member can still read their profile" || bad "existing read"

expect_err "the owner/service role cannot create an unattested profile either" \
  "owner \"insert into public.profiles (id, $PROFILE) values ('$NONE', 'Nina', 30, 'friendship', 18, 60);\"" \
  "confirm your date of birth"
expect_err "is_demo alone does not exempt a real account" \
  "owner \"insert into public.profiles (id, $PROFILE, is_demo) values ('$FAKEDEMO', 'Farah', 30, 'friendship', 18, 60, true);\"" \
  "confirm your date of birth"
expect_ok "the demo seed still runs with the requirement on (reserved demo accounts)" \
  "\"\${PSQL[@]}\" -d \"$DB\" -f supabase/seed/demo_profiles.sql"
[ "$(owner "select count(*) from public.profiles where is_demo")" = "$DEMO_BEFORE" ] &&
  ok "demo profiles unchanged in number ($DEMO_BEFORE)" || bad "demo count changed"
[ "$(owner "select count(*) from public.profiles p join auth.users u on u.id = p.id where p.is_demo and u.email !~ '^demo-[0-9]+@demo\\.soulmate\\.invalid\$'")" = "0" ] &&
  ok "every demo profile belongs to a reserved demo account" || bad "non-reserved demo profile"

# ===== Disable: previous behaviour returns =====
"${PSQL[@]}" -d "$DB" -f docs/ops/require_age_attestation.disable.sql >/dev/null
expect_ok "after the disable script, a profile without an attestation is created as before" \
  "as_member $NONE \"insert into public.profiles (id, $PROFILE) values ('$NONE', 'Nina', 30, 'friendship', 18, 60);\""

# ===== Migration rollback restores the previous function =====
"${PSQL[@]}" -d "$DB" -f docs/rollback/20261123_age_attestation_enforcement.rollback.sql >/dev/null
[ "$(owner "select to_regprocedure('private.age_attestation_required()') is null and to_regprocedure('private.is_reserved_demo_account(uuid)') is null")" = "t" ] &&
  ok "rollback removes the enforcement helpers" || bad "helpers still present"
ORIGINAL=$(sed -n '/^create function private.profile_age_attestation()/,/^\$\$;/p' supabase/migrations/20261123130000_age_attestation.sql | sed '1,/^as \$\$/d;$d')
[ "$(owner "select btrim(prosrc, E'\\n') from pg_proc where proname = 'profile_age_attestation'")" = "$(printf '%s' "$ORIGINAL")" ] &&
  ok "rollback restores the trigger function exactly as before" || bad "restored function differs"
expect_ok "after rollback, profiles are created as before (requirement off)" \
  "as_member $NOCONF \"insert into public.profiles (id, $PROFILE) values ('$NOCONF', 'Chirag', 25, 'friendship', 18, 60);\""
expect_ok "after rollback, attested members are unaffected" \
  "as_member $ADULT \"update public.profiles set bio = 'after rollback' where id = '$ADULT';\""

echo
[ "$fail" = 0 ] && echo "all $passed staging checks passed" || echo "some staging checks FAILED ($passed passed)"
exit "$fail"
