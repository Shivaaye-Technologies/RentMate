# Infrastructure audit and plan

Audit date: 2026-10-29. Run from a Claude Code cloud session with access to the two GitHub repos, the Render and Supabase connectors, and no access to your own devices. Every **Verified** line was checked in that session. Everything else is marked as an assumption or as needing access.

## 1. Findings

### Verified

| Area                     | Finding                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub                   | Two repos: `soulmate-ai` (private) and `Hunterexch` (public), both pushable. No other repos on the account are visible to Claude.                                                                                       |
| soulmate-ai tests        | On `main`: `npm run check` passes (format, lint, typecheck, 54 API + 76 web unit tests, build). `npm run test:hooks` passes 21/21. CI runs on GitHub Actions.                                                           |
| soulmate-ai open PRs     | #9 (full dating experience; title says its migration is not applied) and #7 (migration rename). Neither is merged.                                                                                                      |
| soulmate-ai on Render    | `soulmate-api` (free, Singapore) and `soulmate-web` (static). Both auto-deploy from `main`, and both are live on `main`'s HEAD (`cf33f00`).                                                                             |
| soulmate-ai on Supabase  | Project `soulmate-ai` is **INACTIVE (paused)**. Sign-in and data for the live app will not work until it is restored.                                                                                                   |
| Hunterexch tests         | On `main`: 233 unit tests, 232 pass and 1 is a skipped placeholder. With a disposable PostgreSQL 16: 13/13 integration tests pass, the migration runner applies 001 to 017, and the Playwright browser test passes.     |
| Hunterexch CI            | **None existed.** Added in Hunterexch PR #5.                                                                                                                                                                            |
| Hunterexch on Render     | `hunterexch` (free, Oregon). **Auto-deploy is off** in the dashboard, though `render.yaml` says `autoDeploy: true`. Live is `a9f1f98`, five commits behind `main`.                                                      |
| Hunterexch on Supabase   | Project `Hunterexch` is active, and its security advisor reports no issues.                                                                                                                                             |
| Other Supabase projects  | `Shivaaye` (active) and `TestPilot-AI` (paused). No repo for either is connected to Claude.                                                                                                                             |
| Other Render services    | `TestPilot-AI` (Docker, free, Oregon), from a repo that is not connected to Claude.                                                                                                                                     |
| Claude Code tooling      | soulmate-ai has 7 agents, 8 skills, guard hooks, permission rules and `.mcp.json` (secrets referenced by variable name only). Hunterexch has only a CLAUDE.md.                                                          |
| Playwright               | Hunterexch had one browser test that skipped without a database. soulmate-ai had none; a smoke suite is added here.                                                                                                     |
| Your devices             | **No computer is connected** to Claude Remote Control, so nothing about your MacBook or phone is known.                                                                                                                 |
| OmniRoute                | Not referenced in either repo. The npm package `omniroute` (3.8.52) points to `diegosouzapw/OmniRoute`, while the guide you shared links `cheaper-inference/OmniRoute`. **Verify which is official before installing.** |
| OpenJarvis               | Not referenced in either repo. The upstream `open-jarvis/OpenJarvis` exists. Its guide lists macOS, Linux and WSL, not Android.                                                                                         |
| DeepSeek Harness         | No reference anywhere. **The exact project is unknown.**                                                                                                                                                                |
| Tailscale, Termux, macOS | No configuration in the repos.                                                                                                                                                                                          |

### HunterExch free-to-play review

`main` is still demo-only: approving a request explicitly makes **no balance change** (`transaction_requests.js`: "Deliberately no wallet mutation, payment collection, or payout"), and `demo_payment.js` rejects anything that looks like a real account number, payment ID, phone number or link.

Things to watch:

- `017_transaction_requests.sql` stores requests typed `deposit` and `withdrawal`, reviewed by an `agent → sub_admin → master_admin → super_admin` hierarchy.
- The demo "Banking" screen asks for an account number and IFSC code (kept in the page, never sent).
- The repo's CLAUDE.md now describes a "multi-country gaming platform" and DiamondExch integration.

Together, that is the structure an off-platform real-money operation would use, even though no money moves today. Any step that ties credits to payments, to cash value, or to agents settling off-platform needs separate authorization and legal review first. That includes real bank details, payment-proof uploads, cash-outs, and paid credit packs.

### Could not be verified from the cloud

- Whether the public Render URLs respond: this session's network policy blocks `*.onrender.com`. Check `/health` (soulmate-api) and `/healthz` (hunterexch) in a browser.
- Anything on your MacBook or phone.

## 2. Recommended architecture

```
 You (Android app / MacBook / any browser)
        │
        ▼
   Claude (web, desktop, app) ── connectors ──► GitHub · Render (read) · Supabase (read)
        │ Claude Code cloud sessions
        ▼
   feature branch → draft PR → GitHub Actions CI (unit, integration, Playwright)
        │ you review and merge
        ▼
   main → Render deploys (auto for soulmate-ai; manual for hunterexch today)
        │
        ▼
   Supabase (Postgres + Auth, RLS on)

 Optional, MacBook only:  Claude Remote Control (repo folders) · aihub · OpenJarvis · OmniRoute
```

- **Core, required:** Claude + GitHub + Actions + Render + Supabase. It already exists and works from every device with nothing installed.
- **Local machines:** `aihub` (docs/AIHUB.md) for status, doctor, tests and updates. Claude **Remote Control** when you want Claude to work in a folder on your Mac. **Tailscale is not needed** unless you add a private server.
- **Optional tools:**
  - OmniRoute only if you accept sending code to third-party providers. It doesn't help Claude web.
  - OpenJarvis only if you want a private local assistant.
  - DeepSeek Harness stays out until it is identified and verified.

## 3. Component status

| Component             | Installed                   | Starts                 | Missing                             | Tests                                      | Network / auth                     | Usable from Claude web | Needs a running device |
| --------------------- | --------------------------- | ---------------------- | ----------------------------------- | ------------------------------------------ | ---------------------------------- | ---------------------- | ---------------------- |
| Claude Code web       | yes (this session)          | yes                    | –                                   | –                                          | GitHub, Render, Supabase connected | yes                    | no                     |
| GitHub + Actions      | yes                         | yes                    | Hunterexch CI (PR #5)               | soulmate CI on PRs                         | verified                           | yes                    | no                     |
| Render: soulmate      | yes                         | live deploy on `main`  | –                                   | not reachable from sandbox                 | dashboard auth                     | read via connector     | no                     |
| Render: hunterexch    | yes                         | live, 5 commits behind | auto-deploy off                     | not reachable from sandbox                 | dashboard auth                     | read via connector     | no                     |
| Supabase: soulmate-ai | yes                         | **paused**             | restore it                          | –                                          | –                                  | read via connector     | no                     |
| Supabase: Hunterexch  | yes                         | active                 | –                                   | advisor: 0 issues                          | verified                           | read via connector     | no                     |
| Playwright            | in CI (`--no-save`)         | yes                    | –                                   | soulmate 12/12, Hunterexch 1/1 (local run) | blocks all external requests       | runs in CI             | no                     |
| aihub                 | in repo (`tools/aihub`)     | yes (Linux, verified)  | –                                   | 32/32                                      | no secrets printed                 | n/a (local tool)       | yes                    |
| Claude Remote Control | unknown                     | unknown                | needs Claude on your Mac            | –                                          | –                                  | once connected         | yes (Mac on)           |
| OmniRoute             | unknown (not on any server) | –                      | upstream to confirm, Node ≥ 22.22.2 | `aihub gateway`                            | dashboard must stay on localhost   | no                     | yes                    |
| OpenJarvis            | unknown                     | –                      | uv, Python, Ollama, model           | `aihub jarvis`                             | APIs must stay on localhost        | no                     | yes                    |
| DeepSeek Harness      | unknown                     | –                      | project not identified              | `aihub harness`                            | –                                  | no                     | unknown                |
| Tailscale             | unknown                     | –                      | not needed                          | `aihub connect`                            | –                                  | no                     | yes                    |
| Termux                | unknown                     | –                      | `git`, `nodejs-lts`                 | aihub Termux mode (simulated in tests)     | –                                  | n/a                    | yes (phone)            |

## 4. Security checklist

- [x] No secrets in either repo; CI in both fails if a `.env` file is committed.
- [x] soulmate-ai guard hooks block force-push, push to `main`, `reset --hard`, destructive SQL, `curl | sh` and reading `.env`.
- [x] `.mcp.json` references `GITHUB_PAT` and `RENDER_API_KEY` by name only; Supabase MCP is read-only.
- [x] aihub never prints secret values, redacts tool output, logs subcommand names only, and parses (never runs) its config.
- [x] aihub fails when OmniRoute, Ollama or OpenJarvis listen on a network address.
- [x] CI test databases are throwaway containers; the Hunterexch migration runner refuses its test database by design.
- [x] Playwright tests block every non-local request.
- [ ] Restore the `soulmate-ai` Supabase project, then re-run its security advisor.
- [ ] Decide whether `hunterexch` should auto-deploy, and make the Render dashboard and `render.yaml` agree.
- [ ] Turn on branch protection for `main` in both repos (require PR + CI). This is a GitHub setting only you can change.
- [ ] Before installing OmniRoute or OpenJarvis: confirm the upstream, read the install script, and keep the dashboards on localhost.
- [ ] Never add payment, cash-out or real-money features to HunterExch without authorization and legal review.

## 5. Status

### Done in this change set

- `aihub` with all ten commands, for macOS, Linux, WSL and Termux, plus a 32-case test suite (`npm run test:aihub`), all in CI.
- A Playwright smoke suite for the soulmate web app (`npm run test:e2e`): desktop and phone, sign-in screen, no horizontal scroll, no JS errors, SPA deep links, and the unconfigured build. It runs as a CI job.
- docs/AIHUB.md and this audit.
- Hunterexch PR #5: CI that runs unit, PostgreSQL integration and browser tests.

### Needs you

1. **Supabase:** restore the `soulmate-ai` project. On the free plan you may first have to pause another project; `Shivaaye` and `Hunterexch` are active.
2. **Render:** decide on `hunterexch` auto-deploy and whether to deploy the five pending commits.
3. **GitHub:** review and merge the two draft PRs once CI is green, and enable branch protection on `main`.
4. **MacBook:** install Claude Code, run `aihub setup --link --repo …` and `aihub doctor`, and turn on Remote Control if you want Claude to reach it.
5. **DeepSeek Harness:** send the exact project link.
6. **OmniRoute:** decide whether you want it at all, and which upstream is official.
7. **soulmate-ai PRs #9 and #7:** still open; #9 says its migration is not applied.
