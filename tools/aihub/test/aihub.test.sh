#!/usr/bin/env bash
# Tests for tools/aihub/aihub. Each case runs aihub with an isolated HOME and a PATH that holds only
# basic utilities plus stub programs, so results do not depend on what is installed on the machine.
# Run: bash tools/aihub/test/aihub.test.sh   (or: npm run test:aihub)

set -u
HERE=$(cd "$(dirname "$0")" && pwd)
AIHUB="$HERE/../aihub"
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/aihub-test.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT

PASSED=0; FAILED=0
ok() { PASSED=$((PASSED + 1)); printf 'PASS  %s\n' "$1"; }
bad() { FAILED=$((FAILED + 1)); printf 'FAIL  %s\n' "$1"; printf '%s\n' "$OUT" | sed 's/^/      | /' | head -40; }

UTILS="bash sh find awk sed grep head tail tr cut wc sort uname date mkdir cp mv rm ln chmod ls cat dirname basename mktemp git env printf id touch readlink pwd"

# fresh: new HOME and a bin dir with real utilities only. Sets B (bin) and H (home).
fresh() {
  n=$((${n:-0} + 1))
  H="$ROOT/case$n/home"; B="$ROOT/case$n/bin"
  mkdir -p "$H" "$B"
  for u in $UTILS; do
    p=$(command -v "$u") && ln -s "$p" "$B/$u"
  done
  stub uname 'case "${1:-}" in -s) echo Linux ;; -m) echo x86_64 ;; -r) echo 6.0-test ;; *) echo Linux ;; esac'
}

# stub NAME BODY: a fake program on the isolated PATH.
stub() { rm -f "$B/$1"; printf '#!/bin/sh\n%s\n' "$2" >"$B/$1"; chmod +x "$B/$1"; }
real() { rm -f "$B/$1"; ln -s "$(command -v "$1")" "$B/$1"; }
core_stubs() {
  stub node 'echo v22.22.2'
  stub npm 'echo 10.9.0'
}

# run ARGS...: run aihub in the sandbox; sets OUT and RC.
run() {
  OUT=$(env -i HOME="$H" PATH="$B" TMPDIR="$ROOT" NO_COLOR=1 ${EXTRA_ENV:-} bash "$AIHUB" "$@" 2>&1)
  RC=$?
}
has() { printf '%s\n' "$OUT" | grep -qF -- "$1"; }

# ---------------------------------------------------------------- cases

fresh; core_stubs
run help
if [ $RC -eq 0 ] && has "status" && has "doctor" && has "setup" && has "gateway" && has "harness" \
  && has "jarvis" && has "connect" && has "test" && has "logs" && has "update"; then ok "help lists all ten commands"; else bad "help lists all ten commands"; fi

run frobnicate
if [ $RC -eq 2 ] && has 'unknown command "frobnicate"'; then ok "unknown command exits 2"; else bad "unknown command exits 2"; fi

fresh; core_stubs
run status
if [ $RC -eq 0 ] && has "node       v22.22.2" && has "omniroute  not installed" && has "Linux"; then ok "status reports tools on Linux"; else bad "status reports tools on Linux"; fi

fresh; core_stubs
stub jarvis 'echo "jarvis 0.4.0 token=abcdef123456 key sk-ant-api03-ABCDEFGHIJKLMNOP"'
EXTRA_ENV="GITHUB_PAT=ghp_SuperSecretValue12345 ANTHROPIC_API_KEY=sk-ant-REALSECRET987654 DATABASE_URL=postgresql://postgres:hunter2pass@db.example.com:5432/postgres"
run status; S1=$OUT
run doctor; S2=$OUT
EXTRA_ENV=""
OUT="$S1
$S2"
if has "GITHUB_PAT                 set" && has "ANTHROPIC_API_KEY          set" \
  && ! has "SuperSecretValue" && ! has "REALSECRET" && ! has "hunter2pass" && ! has "abcdef123456" && ! has "ABCDEFGHIJKLMNOP"; then
  ok "secrets are reported as set but never printed, and tool output is redacted"
else bad "secrets are reported as set but never printed, and tool output is redacted"; fi

fresh; stub node 'echo v18.19.0'; stub npm 'echo 9.0.0'
run doctor
if [ $RC -eq 1 ] && has "FAIL node v18.19.0 is too old"; then ok "doctor fails on old node"; else bad "doctor fails on old node"; fi

fresh; stub npm 'echo 10'
run doctor
if [ $RC -eq 1 ] && has "FAIL node is missing"; then ok "doctor fails when node is missing"; else bad "doctor fails when node is missing"; fi

fresh; core_stubs
REPO="$ROOT/repo-clean"; git init -q -b main "$REPO"; git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
EXTRA_ENV="AIHUB_REPOS=$REPO"
run doctor
EXTRA_ENV=""
if [ $RC -eq 0 ] && has "PASS $REPO: on main, clean"; then ok "doctor passes on a healthy setup"; else bad "doctor passes on a healthy setup"; fi

fresh; core_stubs
REPO="$ROOT/repo-env"; git init -q -b main "$REPO"; echo "X=1" >"$REPO/.env"; echo "X=" >"$REPO/.env.example"
git -C "$REPO" add -f .env .env.example; git -C "$REPO" -c user.email=t@t -c user.name=t commit -q -m env
EXTRA_ENV="AIHUB_REPOS=$REPO"
run doctor
EXTRA_ENV=""
if [ $RC -eq 1 ] && has ".env file(s) committed to git: .env" && ! has ".env.example"; then ok "doctor fails when a .env is committed"; else bad "doctor fails when a .env is committed"; fi

fresh; core_stubs; stub node 'echo v22.22.2'
stub omniroute 'echo 3.8.52'
stub ss 'printf "State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0 511 0.0.0.0:20128 0.0.0.0:*\n"'
run gateway status
if [ $RC -eq 1 ] && has "FAIL OmniRoute dashboard listens on port 20128 on a network address: 0.0.0.0"; then ok "gateway fails when the dashboard is exposed"; else bad "gateway fails when the dashboard is exposed"; fi

stub ss 'printf "State Recv-Q Send-Q Local Address:Port Peer Address:Port\nLISTEN 0 511 127.0.0.1:20128 0.0.0.0:*\nLISTEN 0 511 [::1]:20128 [::]:*\n"'
run gateway status
if [ $RC -eq 0 ] && has "PASS OmniRoute dashboard listens on port 20128 on localhost only"; then ok "gateway passes when bound to localhost"; else bad "gateway passes when bound to localhost"; fi

stub node 'echo v22.22.0'
run gateway status
if [ $RC -eq 1 ] && has "needs node >= 22.22.2, found v22.22.0"; then ok "gateway enforces OmniRoute's node requirement"; else bad "gateway enforces OmniRoute's node requirement"; fi

fresh; core_stubs
run gateway status
if [ $RC -eq 3 ] && has "not installed"; then ok "gateway exits 3 when OmniRoute is absent"; else bad "gateway exits 3 when OmniRoute is absent"; fi
run gateway info
if [ $RC -eq 0 ] && has "diegosouzapw/OmniRoute" && has "cheaper-inference/OmniRoute"; then ok "gateway info warns about the upstream mismatch"; else bad "gateway info warns about the upstream mismatch"; fi

fresh; core_stubs
stub uname 'case "${1:-}" in -s) echo Darwin ;; -m) echo arm64 ;; *) echo 24.0 ;; esac'
stub sw_vers 'echo 15.1'
stub jarvis 'echo 0.4.0'
stub ollama 'echo "ollama version 0.5.0"'
stub lsof 'case "$*" in *11434*) printf "p123\nn*:11434\n" ;; *) : ;; esac'
run jarvis status
if [ $RC -eq 1 ] && has "FAIL Ollama listens on port 11434 on a network address: *"; then ok "macOS: jarvis flags an exposed Ollama via lsof"; else bad "macOS: jarvis flags an exposed Ollama via lsof"; fi
run status
if has "macOS 15.1 (arm64)"; then ok "macOS is detected"; else bad "macOS is detected"; fi

fresh; core_stubs
EXTRA_ENV="TERMUX_VERSION=0.118 PREFIX=/data/data/com.termux/files/usr"
run doctor; D=$OUT; DRC=$RC
run gateway status; G=$RC
run jarvis; J=$RC
EXTRA_ENV=""
OUT="$D"
if [ $DRC -eq 0 ] && has "Termux detected" && has "Claude app is the supported interface" && [ $G -eq 3 ] && [ $J -eq 3 ]; then
  ok "Termux: reduced mode, no failure for missing Claude CLI, gateways unsupported"
else bad "Termux: reduced mode, no failure for missing Claude CLI, gateways unsupported"; fi

fresh; core_stubs
REPO="$ROOT/repo-setup"; git init -q -b main "$REPO"
run setup --repo "$REPO"
CFG="$H/.config/aihub/config"
if [ $RC -eq 0 ] && grep -qxF "repo=$REPO" "$CFG" && [ "$(ls -l "$CFG" | cut -c1-10)" = "-rw-------" ]; then ok "setup creates a private config and registers a repo"; else bad "setup creates a private config and registers a repo"; fi
run setup --repo "$REPO"
if has "already registered" && [ "$(grep -c "^repo=" "$CFG")" -eq 1 ]; then ok "setup does not duplicate repos"; else bad "setup does not duplicate repos"; fi
run setup --force
BAKS=$(find "$H/.config/aihub" -name 'config.bak.*' | wc -l | tr -d ' ')
if [ "$BAKS" -ge 1 ] && has "backed up existing config"; then ok "setup --force backs up the old config"; else bad "setup --force backs up the old config"; fi
run setup --repo "$ROOT/not-a-repo"
if has "is not a git repository; not added"; then ok "setup refuses non-repositories"; else bad "setup refuses non-repositories"; fi

fresh; core_stubs
mkdir -p "$H/.config/aihub"
printf 'repo=$(touch %s/pwned)\nharness_cmd=deepseek-harness --serve\n' "$ROOT" >"$H/.config/aihub/config"
run harness status
if [ ! -e "$ROOT/pwned" ] && [ $RC -eq 1 ] && has "configured command 'deepseek-harness' not found"; then ok "config is parsed, never executed"; else bad "config is parsed, never executed"; fi
stub deepseek-harness 'echo 0.1.0'
run harness
if [ $RC -eq 0 ] && has "command 'deepseek-harness' found"; then ok "harness found when configured"; else bad "harness found when configured"; fi

fresh; core_stubs
run harness
if [ $RC -eq 3 ] && has "not configured"; then ok "harness exits 3 when unconfigured"; else bad "harness exits 3 when unconfigured"; fi

fresh; core_stubs
UP="$ROOT/upstream.git"; git init -q --bare -b main "$UP"
A="$ROOT/clone-a"; git clone -q "$UP" "$A" 2>/dev/null; git -C "$A" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one; git -C "$A" push -q origin HEAD:main 2>/dev/null
C="$ROOT/clone-c"; git clone -q "$UP" "$C" 2>/dev/null
git -C "$A" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two; git -C "$A" push -q origin HEAD:main 2>/dev/null
EXTRA_ENV="AIHUB_REPOS=$C"
git -C "$C" fetch -q
run status
if has "ahead 0 / behind 1 of origin/main"; then ok "status shows ahead/behind counts"; else bad "status shows ahead/behind counts"; fi
run update
if [ $RC -eq 0 ] && has "is up to date with origin/main" && [ "$(git -C "$C" log -1 --format=%s)" = "two" ]; then ok "update fast-forwards a clean repo"; else bad "update fast-forwards a clean repo"; fi
echo dirty >"$C/file"
git -C "$A" -c user.email=t@t -c user.name=t commit -q --allow-empty -m three; git -C "$A" push -q origin HEAD:main 2>/dev/null
run update
EXTRA_ENV=""
if has "has uncommitted changes; skipped" && [ "$(git -C "$C" log -1 --format=%s)" = "two" ] && [ -f "$C/file" ]; then ok "update never touches a dirty repo"; else bad "update never touches a dirty repo"; fi

fresh; core_stubs
REPO="$ROOT/repo-pass"; mkdir -p "$REPO/node_modules"; git init -q -b main "$REPO"
printf '{"scripts":{"test":"echo all good; echo leaked ghp_AAAAAAAAAAAAAAAAAAAA"}}' >"$REPO/package.json"
REPO2="$ROOT/repo-fail"; mkdir -p "$REPO2/node_modules"; git init -q -b main "$REPO2"
printf '{"scripts":{"check":"exit 1","test:hooks":"exit 0"}}' >"$REPO2/package.json"
real node; stub npm 'case "$1" in test) exec sh -c "$(node -e "console.log(require(\"./package.json\").scripts.test)")" ;; run) exec sh -c "$(node -e "console.log(require(\"./package.json\").scripts[\"$2\"])")" ;; *) echo 10 ;; esac'
EXTRA_ENV="AIHUB_REPOS=$REPO:$REPO2"
run test
EXTRA_ENV=""
if [ $RC -eq 1 ] && has "PASS $REPO" && has "FAIL $REPO2" && has "npm run check && npm run test:hooks" && ! has "AAAAAAAAAAAAAAAAAAAA"; then
  ok "test runs each repo's own suite, reports per repo, redacts output"
else bad "test runs each repo's own suite, reports per repo, redacts output"; fi

fresh; core_stubs
run status
run logs
if [ $RC -eq 0 ] && has " linux status"; then ok "logs shows aihub's own activity"; else bad "logs shows aihub's own activity"; fi
EXTRA_ENV="GITHUB_PAT=ghp_ShouldNeverBeLogged999"
run setup --repo "ghp_ShouldNeverBeLogged999"
EXTRA_ENV=""
if ! grep -q "ShouldNeverBeLogged" "$H/.local/state/aihub/aihub.log"; then ok "log records subcommands only, never arguments"; else bad "log records subcommands only, never arguments"; fi
run logs -n abc
if [ $RC -eq 2 ]; then ok "logs rejects a bad -n"; else bad "logs rejects a bad -n"; fi

fresh; core_stubs
run connect
if [ $RC -eq 0 ] && has "Remote Control" && has "cannot confirm it from here"; then ok "connect explains Remote Control without claiming a connection"; else bad "connect explains Remote Control without claiming a connection"; fi
run connect start
if [ $RC -eq 3 ] && has "Claude Code CLI not installed"; then ok "connect start refuses without the Claude CLI"; else bad "connect start refuses without the Claude CLI"; fi

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
