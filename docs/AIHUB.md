# aihub: local control for the development setup

`aihub` is one command for checking and driving the **local** side of the setup. The main interface is still Claude (web, desktop or the Android app). Claude reaches GitHub, Render and Supabase through its own connectors, so you can do most work with no local software at all. `aihub` is for the machines where you also work locally: your MacBook, a Linux box, or Termux on Android.

What it will never do:

- install software, or run a downloaded script;
- print a secret: environment variables show as `set` or `unset`, and all tool output is redacted;
- claim a device, gateway or service is connected unless it checked on this machine;
- force-push, reset, or change a repo it cannot fast-forward cleanly;
- deploy anything.

## Commands

| Command                               | What it does                                                                                      | Exit codes          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| `aihub status`                        | Platform, tool versions, which credentials are set, repo branches, and local service ports        | 0                   |
| `aihub doctor [--online]`             | PASS/WARN/FAIL checks with fixes. `--online` also tests reaching GitHub, npm and Anthropic        | 0 ok, 1 failure     |
| `aihub setup [--repo P]... [--link]`  | Creates `~/.config/aihub/config` (mode 600), registers repos, links `aihub` onto your PATH        | 0                   |
| `aihub gateway [status\|info]`        | OmniRoute: installed? right Node? dashboard only on localhost?                                    | 0, 1, 3 not present |
| `aihub harness [status\|info]`        | DeepSeek Harness: only once you configure its command                                             | 0, 1, 3             |
| `aihub jarvis [status\|doctor\|info]` | OpenJarvis and Ollama: installed? APIs only on localhost? `doctor` runs `jarvis doctor`, redacted | 0, 1, 3             |
| `aihub connect [status\|start [P]]`   | How Claude reaches this machine. `start` runs `claude remote-control` in a repo root              | 0, 1, 3             |
| `aihub test [--install]`              | Runs each registered repo's own suite (`check` + `test:hooks`, or `test`)                         | 0, 1 any failed     |
| `aihub logs [-n N\|path]`             | aihub's own activity log (subcommand names only, never arguments)                                 | 0                   |
| `aihub update`                        | `git fetch` + fast-forward for clean repos that have an upstream; anything else is skipped        | 0                   |

Usage errors exit with 2.

## Install: macOS and Linux (including WSL)

Requirements: `bash` (the macOS default 3.2 works), `git`, Node 20+ and `npm`. Run `aihub doctor` and it prints the install command for anything missing.

```sh
git clone https://github.com/souravsingh80000-design/soulmate-ai.git ~/code/soulmate-ai
~/code/soulmate-ai/tools/aihub/aihub setup --link --repo ~/code/soulmate-ai
# optional: also register HunterExch
git clone https://github.com/souravsingh80000-design/Hunterexch.git ~/code/Hunterexch
aihub setup --repo ~/code/Hunterexch
aihub doctor
```

`--link` creates `~/.local/bin/aihub`. If `doctor` says `~/.local/bin` is not on your PATH, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` (macOS) or `~/.bashrc` (Linux).

To let Claude web or the Claude app work in a repo on this Mac:

```sh
npm install -g @anthropic-ai/claude-code   # once
cd ~/code/soulmate-ai && aihub connect start
```

Or use the Claude desktop app: **Settings > Claude Code > Remote Control** and add the repo folder. Claude can only use a **repository root**, and not folders that are hidden (start with `.`) or under `~/Library`. Remote Control is first-party and opens no ports, so you do **not** need Tailscale for this.

## Install: Android (Termux)

Termux is a reduced mode. On Android the **Claude app** is the real interface; it already reaches GitHub, Render and Supabase. In Termux, `aihub` is only useful to check and test a local clone.

```sh
pkg update && pkg install git nodejs-lts
git clone https://github.com/souravsingh80000-design/soulmate-ai.git ~/soulmate-ai
~/soulmate-ai/tools/aihub/aihub setup --link --repo ~/soulmate-ai
aihub doctor
```

On Termux:

- `status`, `doctor`, `setup`, `test`, `logs` and `update` work.
- `gateway` and `jarvis` exit with code 3: OmniRoute, OpenJarvis and Ollama are not supported there.
- `connect start` is not supported. You cannot share a Termux folder with Claude.
- Missing Claude Code CLI is reported as information, not a failure.
- Building the web app in Termux may be slow or run out of memory; let GitHub Actions run CI instead.

## Optional components

None of these are required. Claude web and the Claude app use none of them.

### OmniRoute

A local gateway that routes the **Claude Code CLI** through other AI providers (`omniroute run claude`). Consider it only if you deliberately want that, because:

- your prompts **and code** go to whichever third-party provider it picks;
- the npm package `omniroute` lists `github.com/diegosouzapw/OmniRoute` as its source, while some guides link `github.com/cheaper-inference/OmniRoute`. **Confirm which one is official before you run `npm install -g omniroute`.** A mismatch like this is a common supply-chain trick;
- it needs Node `>= 22.22.2`;
- its dashboard (`http://127.0.0.1:20128`) must stay on localhost with a password set. `aihub gateway` fails if it listens on a network address.

### OpenJarvis

An open-source, local-first assistant (`github.com/open-jarvis/OpenJarvis`, Apache-2.0). It runs on macOS, Linux and WSL, not on Termux. Its installer sets up `uv`, Python 3.11, Ollama, Rust and a 1.5 GB+ model. Install it like this, never with `curl … | bash`:

```sh
curl -fsSL -o /tmp/openjarvis-install.sh https://open-jarvis.github.io/OpenJarvis/install.sh
less /tmp/openjarvis-install.sh          # read it first
bash /tmp/openjarvis-install.sh --no-analytics
aihub jarvis doctor
```

Notes:

- If `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` or `GOOGLE_API_KEY` are set when you run it, it defaults to **cloud** models instead of local ones.
- Keep `jarvis serve` (port 8000) and Ollama (port 11434) on localhost. `aihub jarvis` fails if either listens on a network address.
- The `code-assistant` preset can run shell commands on your Mac; enable it only on purpose.

### DeepSeek Harness

**Not verified.** No source, configuration or install guide for it exists in these repos or in the documents provided. Once you know the exact upstream project and have checked it, register its start command:

```sh
echo 'harness_cmd=<the command>' >> ~/.config/aihub/config
aihub harness
```

### Tailscale

Not needed for Claude: use Remote Control instead. Use Tailscale only if you add a private server (VPS, home box) that cloud services cannot reach. If you do, keep its admin tools off the public internet. `aihub connect` shows whether Tailscale is connected.

## Configuration

`~/.config/aihub/config` (or `$XDG_CONFIG_HOME/aihub/config`) holds plain `key=value` lines. aihub **parses** it and never runs it as code. Never put secrets in it.

```ini
repo=~/code/soulmate-ai
repo=~/code/Hunterexch
harness_cmd=
omniroute_port=20128
```

Environment overrides: `AIHUB_REPOS` (colon-separated paths), `AIHUB_HARNESS_CMD`, `AIHUB_OMNIROUTE_PORT`, `NO_COLOR`.

`aihub setup --force` recreates the file after saving a timestamped backup next to it. The log is at `~/.local/state/aihub/aihub.log`.

## Troubleshooting

| You see                                           | Fix                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `aihub: command not found`                        | Run `tools/aihub/aihub setup --link`, then add `~/.local/bin` to PATH and open a new terminal             |
| `FAIL node vX is too old`                         | Install Node 22 LTS (`brew install node@22`, nvm, or `pkg install nodejs-lts`)                            |
| `FAIL ... .env file(s) committed to git`          | `git rm --cached <file>`, add it to `.gitignore`, and **rotate every secret it held**                     |
| `WARN .env is readable by other users`            | `chmod 600 <file>`                                                                                        |
| `FAIL ... listens on port N on a network address` | Restart that tool bound to `127.0.0.1`, or put real authentication in front of it                         |
| `test` says `dependencies not installed`          | `aihub test --install` (runs `npm ci` in each repo)                                                       |
| `update` skips a repo                             | It has local changes, no upstream, or has diverged. Commit or stash, or ask Claude to sort it on a branch |
| `connect start` refuses a folder                  | Use the repo root, not a hidden folder or one under `~/Library`                                           |
| `cannot inspect port` on Termux                   | Expected: Android restricts port listing                                                                  |

## Development

- Script: `tools/aihub/aihub`. Tests: `npm run test:aihub`, which runs `tools/aihub/test/aihub.test.sh` with stub programs and simulates Linux, macOS and Termux. CI runs it on every pull request.
- Keep it bash 3.2 compatible for macOS: no associative arrays, no `${var,,}`, no `mapfile`, no `sed -i`, no GNU-only flags.
