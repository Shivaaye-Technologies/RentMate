# Automation Setup

How Claude Code is configured to work on this repo, and what you need to finish connecting.

## What is configured

| Piece        | Location                                   | What it does                                                                                          |
| ------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Instructions | `CLAUDE.md`                                | Architecture, commands, conventions, security rules, repair loop                                      |
| Skills       | `.claude/skills/*/SKILL.md`                | `/inspect` `/build` `/test` `/debug` `/security-audit` `/review` `/deploy-check` `/release`           |
| Subagents    | `.claude/agents/*.md`                      | code-architect, frontend-, backend-, database-, test-engineer, security-reviewer, deployment-engineer |
| Hooks        | `.claude/settings.json` + `.claude/hooks/` | Guards, auto-format and lint, notifications                                                           |
| Permissions  | `.claude/settings.json`                    | Safe commands allowed; pushes, installs, migrations ask; force-push and `.env` reads denied           |
| MCP servers  | `.mcp.json`                                | GitHub, Supabase (read-only), Render                                                                  |
| CI           | `.github/workflows/ci.yml`                 | Format, lint, typecheck, tests, hook tests, build, secret scan, audit                                 |

## Hooks

| Event                       | Script                | Behavior                                                                                                                                                                   |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PreToolUse: Bash            | `guard-bash.mjs`      | Blocks `rm -rf /` and `~`, force push, push to main, `reset --hard`, DROP/TRUNCATE, unscoped DELETE, `supabase db reset/push`, curl-pipe-shell, reading `.env`, `printenv` |
| PreToolUse: Read/Edit/Write | `guard-files.mjs`     | Blocks access to real `.env` files; blocks editing existing migrations                                                                                                     |
| PostToolUse: Edit/Write     | `post-edit-check.mjs` | Runs Prettier, then ESLint; lint errors are sent back to Claude to fix                                                                                                     |
| Notification, Stop          | `notify.mjs`          | Logs to `.claude/logs/session.log` and rings the terminal bell                                                                                                             |

All blocks are logged to `.claude/logs/blocked.log` (gitignored). `npm run test:hooks` verifies 21 allow/block cases.

Hooks run with Node, so they work the same on Windows, macOS, and Linux.

## Connecting MCP servers

`.mcp.json` reads credentials from environment variables. Set them in your shell, never in the file:

| Variable               | Where to get it                                                | Scope needed                                                                  |
| ---------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GITHUB_PAT`           | GitHub → Settings → Developer settings → Fine-grained tokens   | This repo only: Contents, Pull requests, Issues (read/write); Actions (read)  |
| `SUPABASE_PROJECT_REF` | Supabase dashboard URL: `supabase.com/dashboard/project/<ref>` | Not a secret. Server is read-only; you sign in via browser OAuth on first use |
| `RENDER_API_KEY`       | Render → Account settings → API keys                           | Account-wide; keep it local                                                   |

Then in Claude Code run `/mcp` to confirm each server shows as connected.

## Using it

```text
claude                  # start in the repo root
/inspect                # assessment of current state
/test                   # run and repair tests
/security-audit         # before any release
/deploy-check           # before merging to main
```

Ask for a subagent by name: "use the database-engineer to add a photos table".

## Known limitations

- Hooks catch common destructive commands by pattern. They are a safety net, not a sandbox; permissions and human review remain the main control.
- The API reads and writes profiles in Supabase with each user's own token (RLS applies). The in-memory store in `apps/api/src/store.ts` is used only by tests.
- The Supabase MCP server is read-only by design. Apply migrations yourself (see the deployment guide).
