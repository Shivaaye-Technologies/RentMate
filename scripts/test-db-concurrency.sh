#!/usr/bin/env bash
# Real concurrency tests for the booking engine. PGlite (npm run test:db) has one connection, so it cannot prove what
# happens when two requests arrive at the same moment; this script uses a real, disposable PostgreSQL server.
#
# Usage: PGHOST=... PGPORT=... PGUSER=... [PGPASSWORD=...] scripts/test-db-concurrency.sh
# It creates and drops its own database (rentmate_concurrency_<pid>). Never point it at production.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="rentmate_concurrency_$$"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() { "${PSQL[@]}" -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${PSQL[@]}" -d postgres -c "create database $DB"
{
  # Roles are cluster-wide: create them only if this server does not have them yet.
  sed -E "s/^create role ([a-z_]+) nologin;/do \$\$ begin create role \1 nologin; exception when duplicate_object then null; end \$\$;/" \
    supabase/tests/supabase_stubs.sql
  for f in supabase/migrations/*.sql; do cat "$f"; echo; done
} | "${PSQL[@]}" -d "$DB" >/dev/null
echo "Migrations applied to a fresh PostgreSQL $("${PSQL[@]}" -d "$DB" -c 'show server_version')."

CM=11111111-0000-4000-8000-000000000001
M1=11111111-0000-4000-8000-000000000002
M2=11111111-0000-4000-8000-000000000003
SVC=22222222-0000-4000-8000-000000000001
SLOT="(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 days 11 hours') at time zone 'Asia/Kolkata'"

"${PSQL[@]}" -d "$DB" >/dev/null <<SQL
insert into auth.users (id, email, aud, role) values
  ('$CM', 'cm@race.test', 'authenticated', 'authenticated'),
  ('$M1', 'm1@race.test', 'authenticated', 'authenticated'),
  ('$M2', 'm2@race.test', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  select id, 'Racer', 30, 'friendship', 18, 60 from auth.users where email like '%@race.test';
insert into public.companion_profiles (user_id, headline, city, status, verified)
  values ('$CM', 'City walks guide', 'Pune', 'approved', true);
insert into public.companion_services (id, companion_id, category, title, pricing, price_inr, min_minutes, max_minutes)
  values ('$SVC', '$CM', 'coffee', 'Coffee chat', 'hourly', 500, 60, 120);
insert into public.companion_availability (companion_id, weekday, start_minute, end_minute, timezone)
  select '$CM', d, 0, 1440, 'Asia/Kolkata' from generate_series(0, 6) d;
SQL

as_user() { # $1 user, $2 sql, $3 seconds to hold the transaction open
  "${PSQL[@]}" -d "$DB" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true) is null;
$2
select pg_sleep($3);
commit;
SQL
}

# Two members request the same slot (requests do not reserve; acceptance does).
B1=$(as_user "$M1" "select public.booking_request('$SVC', $SLOT, 60, 'Cafe on FC Road', '', 'race-key-0001');" 0 | grep -E '^[0-9a-f-]{36}$')
B2=$(as_user "$M2" "select public.booking_request('$SVC', $SLOT, 60, 'Cafe on FC Road', '', 'race-key-0002');" 0 | grep -E '^[0-9a-f-]{36}$')

# 1. The companion accepts both at the same moment from two connections.
as_user "$CM" "select public.booking_respond('$B1', 'accept', null);" 3 >/tmp/race_a.$$ &
sleep 1
as_user "$CM" "select public.booking_respond('$B2', 'accept', null);" 0 >/tmp/race_b.$$ || true
wait
accepted=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.bookings where id in ('$B1', '$B2') and status = 'accepted'")
if [ "$accepted" = "1" ] && grep -q "overlaps another accepted booking" /tmp/race_b.$$; then
  ok "simultaneous accepts of one slot: exactly one wins, the other gets a clear error"
else
  bad "simultaneous accepts: $accepted accepted; second session said: $(tr '\n' ' ' </tmp/race_b.$$)"
fi

# 2. The same member sends the same request twice at the same moment (double tap / network retry).
REQ="select 'id=' || public.booking_request('$SVC', $SLOT + interval '1 day', 60, 'Cafe on FC Road', '', 'same-key-0777');"
as_user "$M1" "$REQ" 3 >/tmp/race_c.$$ &
sleep 1
as_user "$M1" "$REQ" 0 >/tmp/race_d.$$ || true
wait
rows=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.bookings where idempotency_key = 'same-key-0777'")
id_c=$(grep -o 'id=.*' /tmp/race_c.$$ || true)
id_d=$(grep -o 'id=.*' /tmp/race_d.$$ || true)
if [ "$rows" = "1" ] && [ -n "$id_c" ] && [ "$id_c" = "$id_d" ]; then
  ok "simultaneous retries with one idempotency key: one booking, both callers get its id"
else
  bad "idempotent retry: rows=$rows first=[$id_c] second=[$id_d] $(tr '\n' ' ' </tmp/race_d.$$)"
fi

# 3. Member and companion act on one booking at once: cancel vs accept. The row lock serialises them.
B3=$(as_user "$M2" "select public.booking_request('$SVC', $SLOT + interval '2 days', 60, 'Cafe on FC Road', '', 'race-key-0003');" 0 | grep -E '^[0-9a-f-]{36}$')
as_user "$M2" "select public.booking_cancel('$B3', 'changed plans');" 3 >/tmp/race_e.$$ &
sleep 1
as_user "$CM" "select public.booking_respond('$B3', 'accept', null);" 0 >/tmp/race_f.$$ || true
wait
st=$("${PSQL[@]}" -d "$DB" -c "select status from public.bookings where id = '$B3'")
events=$("${PSQL[@]}" -d "$DB" -c "select string_agg(coalesce(from_status, '-') || '>' || to_status, ',' order by created_at) from public.booking_events where booking_id = '$B3'")
if [ "$st" = "cancelled" ] && grep -q "can no longer be answered" /tmp/race_f.$$ && [ "$events" = "->requested,requested>cancelled" ]; then
  ok "cancel and accept at once: the first wins, the second is refused, history stays consistent ($events)"
else
  bad "cancel vs accept: status=$st events=$events second said: $(tr '\n' ' ' </tmp/race_f.$$)"
fi

# 4. Two spends against one wallet at the same moment (100-token bonus, 60 each): exactly one may succeed.
# private.ledger_post is server-only, so this runs as the database owner, the way server code would call it.
spend() { # $1 key, $2 seconds to hold
  "${PSQL[@]}" -d "$DB" 2>&1 <<SQL
begin;
select 'entry=' || private.ledger_post('$M1', -60, 'video_call', 'call', 'race', '$1');
select pg_sleep($2);
commit;
SQL
}
spend "race-spend-0001" 3 >/tmp/race_g.$$ &
sleep 1
spend "race-spend-0002" 0 >/tmp/race_h.$$ || true
wait
bal=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M1'")
sum=$("${PSQL[@]}" -d "$DB" -c "select sum(delta) from public.token_ledger where user_id = '$M1'")
if [ "$bal" = "40" ] && [ "$sum" = "40" ] && grep -q "Not enough tokens" /tmp/race_h.$$; then
  ok "two simultaneous spends from one wallet: one succeeds, the other is refused, balance never negative"
else
  bad "concurrent spends: balance=$bal ledger_sum=$sum second said: $(tr '\n' ' ' </tmp/race_h.$$)"
fi

# 5. The same spend replayed at the same moment (webhook retry): charged once.
spend "race-spend-0003" 3 >/tmp/race_i.$$ &
sleep 1
spend "race-spend-0003" 0 >/tmp/race_j.$$ || true
wait
rows=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.token_ledger where idempotency_key = 'race-spend-0003'")
# 40 tokens cannot cover 60, so both attempts must be refused and nothing posted; then retry with a fundable amount.
if [ "$rows" = "0" ] && grep -q "Not enough tokens" /tmp/race_i.$$; then
  "${PSQL[@]}" -d "$DB" -c "select private.ledger_post('$M2', -10, 'message', 'msg', 'r', 'race-spend-0004')" >/dev/null
  (echo "begin; select private.ledger_post('$M2', -10, 'message', 'msg', 'r', 'race-spend-0005'); select pg_sleep(3); commit;" \
    | "${PSQL[@]}" -d "$DB" >/tmp/race_k.$$ 2>&1) &
  sleep 1
  echo "select private.ledger_post('$M2', -10, 'message', 'msg', 'r', 'race-spend-0005');" | "${PSQL[@]}" -d "$DB" >/tmp/race_l.$$ 2>&1 || true
  wait
  rows=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.token_ledger where idempotency_key = 'race-spend-0005'")
  bal=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M2'")
  if [ "$rows" = "1" ] && [ "$bal" = "80" ]; then
    ok "a spend replayed at the same moment is charged once (balance $bal)"
  else
    bad "replayed spend: rows=$rows balance=$bal $(tr '\n' ' ' </tmp/race_l.$$)"
  fi
else
  bad "unfundable replay: rows=$rows $(tr '\n' ' ' </tmp/race_i.$$)"
fi

# 6. Token-funded bookings (sandbox): two requests from one member at the same moment with different request keys.
# The member has 100 tokens and each request holds 80, so exactly one may succeed and the other must leave nothing.
M3=11111111-0000-4000-8000-000000000004
TSVC=22222222-0000-4000-8000-000000000002
"${PSQL[@]}" -d "$DB" >/dev/null <<SQL
insert into auth.users (id, email, aud, role) values ('$M3', 'm3@race.test', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  values ('$M3', 'Racer', 30, 'friendship', 18, 60);
update public.profiles set is_tester = true where id in ('$CM', '$M3');
update public.booking_token_settings set sandbox_spend_enabled = true;
insert into public.companion_services (id, companion_id, category, title, pricing, price_inr, price_tokens, min_minutes, max_minutes)
  values ('$TSVC', '$CM', 'coffee', 'Coffee chat (tokens)', 'hourly', 500, 80, 60, 120);
SQL
TREQ() { echo "select 'id=' || public.booking_request_with_tokens('$TSVC', $SLOT + interval '$1', 60, 'Cafe on FC Road', '', '$2');"; }
as_user "$M3" "$(TREQ '3 days' token-race-0001)" 3 >/tmp/race_m.$$ &
sleep 1
as_user "$M3" "$(TREQ '4 days' token-race-0002)" 0 >/tmp/race_n.$$ || true
wait
bal=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M3'")
nb=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.bookings where member_id = '$M3'")
nh=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.booking_token_holds where member_id = '$M3'")
if [ "$bal" = "20" ] && [ "$nb" = "1" ] && [ "$nh" = "1" ] && grep -q "id=" /tmp/race_m.$$ && grep -q "Not enough tokens" /tmp/race_n.$$; then
  ok "two token bookings at once from one wallet: one holds 80, the other is refused and leaves no booking"
else
  bad "token booking race: balance=$bal bookings=$nb holds=$nh second said: $(tr '\n' ' ' </tmp/race_n.$$)"
fi

# 7. The same token booking request sent twice at the same moment (double tap): one booking, one hold, one debit.
"${PSQL[@]}" -d "$DB" -c "select private.ledger_post('$M3', 200, 'sandbox_grant', 'sandbox', null, 'sandbox-race-grant')" >/dev/null
as_user "$M3" "$(TREQ '5 days' token-same-0777)" 3 >/tmp/race_o.$$ &
sleep 1
as_user "$M3" "$(TREQ '5 days' token-same-0777)" 0 >/tmp/race_p.$$ || true
wait
bal=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M3'")
nb=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.bookings where idempotency_key = 'token-same-0777'")
nh=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.booking_token_holds h join public.bookings b on b.id = h.booking_id where b.idempotency_key = 'token-same-0777'")
id_o=$(grep -o 'id=.*' /tmp/race_o.$$ || true)
id_p=$(grep -o 'id=.*' /tmp/race_p.$$ || true)
if [ "$bal" = "140" ] && [ "$nb" = "1" ] && [ "$nh" = "1" ] && [ -n "$id_o" ] && [ "$id_o" = "$id_p" ]; then
  ok "a token booking retried at the same moment: one booking, one hold, charged once (balance $bal)"
else
  bad "token booking retry: balance=$bal bookings=$nb holds=$nh first=[$id_o] second=[$id_p] $(tr '\n' ' ' </tmp/race_p.$$)"
fi

# 8. Reject and cancel at the same moment on one held booking: the hold is refunded exactly once.
B9=${id_o#id=}
as_user "$CM" "select public.booking_respond('$B9', 'reject', 'busy');" 3 >/tmp/race_q.$$ &
sleep 1
as_user "$M3" "select public.booking_cancel('$B9', 'changed plans');" 0 >/tmp/race_r.$$ || true
wait
refunds=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.token_ledger where idempotency_key = 'booking_refund:$B9'")
bal=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M3'")
if [ "$refunds" = "1" ] && [ "$bal" = "220" ]; then
  ok "reject and cancel at once: the hold is refunded exactly once (balance $bal)"
else
  bad "double refund race: refunds=$refunds balance=$bal"
fi

# 9. The same Google Play purchase recorded twice at the same moment (app retry and second device): credited once.
"${PSQL[@]}" -d "$DB" -c "select private.set_integration_secret('play_billing', 'k9Qw2Lr7Zp4Xv1Tn8Bs5Hd3Jf6Gm0Ca9Ue2Yi7Ro4Wl1Pq8Nt5Kb3Mc6Vx0Az2'); update public.billing_settings set sandbox_enabled = true; update public.store_products set enabled = true where product_id = 'rentmate_tokens_100';" >/dev/null
before=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M3'")
record() { # $1 seconds to hold
  "${PSQL[@]}" -d "$DB" 2>&1 <<SQL
begin;
set local role anon;
select 'out=' || ((public.billing_record_play_purchase('k9Qw2Lr7Zp4Xv1Tn8Bs5Hd3Jf6Gm0Ca9Ue2Yi7Ro4Wl1Pq8Nt5Kb3Mc6Vx0Az2', '$M3', 'rentmate_tokens_100',
  encode(sha256('race-purchase-token'::bytea), 'hex'), 'GPA.race', 'purchased', true, 1, now(), null))->>'outcome');
select pg_sleep($1);
commit;
SQL
}
record 3 >/tmp/race_s.$$ &
sleep 1
record 0 >/tmp/race_t.$$ || true
wait
after=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M3'")
credits=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.token_ledger where reason = 'token_purchase' and user_id = '$M3'")
if [ "$credits" = "1" ] && [ "$after" = "$((before + 100))" ] && grep -q "out=credited" /tmp/race_s.$$ && grep -q "out=already_recorded" /tmp/race_t.$$; then
  ok "one Play purchase recorded twice at once: credited exactly once (balance $after)"
else
  bad "purchase race: credits=$credits before=$before after=$after first=$(tr '\n' ' ' </tmp/race_s.$$) second=$(tr '\n' ' ' </tmp/race_t.$$)"
fi

# 10. Two settlement job runs at the same moment (two API processes): every finished booking is decided once.
M4=11111111-0000-4000-8000-000000000005
ADM=11111111-0000-4000-8000-000000000006
JOBS_SECRET='Rv3Tq8Lm2Xp7Wz1Kn5Bs9Hd4Jf6Gc0Ya8Ue2Ti7Ro4Wl1Pq8Nv5Kb3Mc6Vx0Az9'
"${PSQL[@]}" -d "$DB" >/dev/null <<SQL
insert into auth.users (id, email, aud, role) values
  ('$M4', 'm4@race.test', 'authenticated', 'authenticated'), ('$ADM', 'adm@race.test', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, age, looking_for, age_min, age_max)
  values ('$M4', 'Racer', 30, 'friendship', 18, 60), ('$ADM', 'Admin', 30, 'friendship', 18, 60);
update public.profiles set is_tester = true where id = '$M4';
insert into private.user_roles (user_id, role) values ('$ADM', 'admin');
select private.ledger_post('$M4', 500, 'sandbox_grant', 'sandbox', null, 'sandbox-settle-grant');
select private.set_integration_secret('booking_jobs', '$JOBS_SECRET');
SQL
S1=$(as_user "$M4" "$(TREQ '8 days' settle-race-0001)" 0 | grep -o 'id=.*' | sed 's/id=//')
S2=$(as_user "$M4" "$(TREQ '9 days' settle-race-0002)" 0 | grep -o 'id=.*' | sed 's/id=//')
S3=$(as_user "$M4" "$(TREQ '10 days' settle-race-0003)" 0 | grep -o 'id=.*' | sed 's/id=//')
for b in "$S1" "$S2" "$S3"; do as_user "$CM" "select public.booking_respond('$b', 'accept', null);" 0 >/dev/null; done
"${PSQL[@]}" -d "$DB" >/dev/null <<SQL
update public.bookings b set starts_at = now() - interval '3 days' - v.k * interval '2 hours',
                             ends_at = now() - interval '3 days' - v.k * interval '2 hours' + interval '1 hour'
from (values ('$S1'::uuid, 0), ('$S2'::uuid, 1), ('$S3'::uuid, 2)) v(id, k) where b.id = v.id;
SQL
# The member confirms S1 and S2; nobody confirms S3 (it must go to review, not settle).
as_user "$M4" "select public.booking_complete('$S1'); select public.booking_complete('$S2');" 0 >/dev/null
settle() { # $1 seconds to hold
  "${PSQL[@]}" -d "$DB" 2>&1 <<SQL
begin;
set local role anon;
select 'out=' || completed || '/' || held_for_review from public.booking_jobs_settle('$JOBS_SECRET', 100);
select pg_sleep($1);
commit;
SQL
}
settle 3 >/tmp/race_u.$$ &
sleep 1
settle 0 >/tmp/race_v.$$ || true
wait
earn=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.creator_booking_earnings where booking_id in ('$S1', '$S2', '$S3')")
settled=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.booking_token_hold_events where event = 'settled' and booking_id in ('$S1', '$S2', '$S3')")
frozen=$("${PSQL[@]}" -d "$DB" -c "select string_agg(status, ',') from public.booking_token_holds where booking_id = '$S3'")
if [ "$earn" = "2" ] && [ "$settled" = "2" ] && [ "$frozen" = "frozen" ] && grep -q "out=2/1" /tmp/race_u.$$ && grep -q "out=0/0" /tmp/race_v.$$; then
  ok "two settlement runs at once: each booking decided once (2 settled, 1 held for review)"
else
  bad "settlement race: earnings=$earn settled=$settled S3=$frozen first=$(tr '\n' ' ' </tmp/race_u.$$) second=$(tr '\n' ' ' </tmp/race_v.$$)"
fi

# 11. Two admins reverse the same disputed settlement at the same moment: the member is refunded once.
as_user "$M4" "select public.booking_dispute('$S1', 'The companion left after five minutes.');" 0 >/dev/null
before=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M4'")
as_user "$ADM" "select public.admin_decide_settled_dispute('$S1', 'reverse', 'Refund after review (first)');" 3 >/tmp/race_w.$$ &
sleep 1
as_user "$ADM" "select public.admin_decide_settled_dispute('$S1', 'reverse', 'Refund after review (second)');" 0 >/tmp/race_x.$$ || true
wait
after=$("${PSQL[@]}" -d "$DB" -c "select balance from public.token_wallets where user_id = '$M4'")
refunds=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.token_ledger where idempotency_key = 'booking_reversal:$S1'")
revs=$("${PSQL[@]}" -d "$DB" -c "select count(*) from public.booking_settlement_reversals where booking_id = '$S1'")
if [ "$refunds" = "1" ] && [ "$revs" = "1" ] && [ "$after" = "$((before + 80))" ] && grep -q "Only disputed bookings" /tmp/race_x.$$; then
  ok "two reversals of one settlement at once: refunded once (balance $before -> $after), the second is refused"
else
  bad "reversal race: refunds=$refunds reversals=$revs before=$before after=$after second=$(tr '\n' ' ' </tmp/race_x.$$)"
fi

rm -f /tmp/race_[a-x].$$
exit $fail
