#!/usr/bin/env bash
# Runs a command and retries it (up to 3 attempts, 30 s and 60 s apart) only when it failed because Expo's API was
# briefly unavailable ("Service Unavailable" / "GraphQL request failed"). Any other failure is returned at once, so
# real build errors are never retried or hidden. The command's stdout and stderr pass through unchanged.
#   RETRY_DELAY=<seconds> overrides the base delay (used by the self-test).
set -uo pipefail
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
delay="${RETRY_DELAY:-30}"
status=1
for attempt in 1 2 3; do
  : > "$log"
  # stdout and stderr each pass through tee into the log; with pipefail the group's status is the command's.
  { { "$@" | tee -a "$log"; } 2>&1 >&3 3>&- | tee -a "$log" >&2 3>&-; } 3>&1
  status=$?
  [ "$status" -eq 0 ] && exit 0
  grep -qE 'Service Unavailable|GraphQL request failed' "$log" || exit "$status"
  [ "$attempt" -eq 3 ] && break
  echo "::warning::Expo API unavailable (attempt $attempt of 3); retrying in $((attempt * delay)) s." >&2
  sleep $((attempt * delay))
done
exit "$status"
