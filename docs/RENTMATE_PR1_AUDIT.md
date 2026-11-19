# RentMate — PR #1 Audit (feature/rentmate-conversion → main)

Date: 2026-11-20 · Auditor: Claude (automated, in a Linux container) · Audited head: see §1.

Every result below was produced in this session. **PASS** = verified here with the evidence named. **FAIL** = a
defect found and still open. **BLOCKED** = could not be verified or fixed from here; the reason and next step are given.
Nothing here was merged, deployed, migrated in production, or switched on.

## 1. Repository and branch status

| Item                                        | Value                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Repository                                  | `Shivaaye-Technologies/RentMate` (anonymous git read works; the GitHub API and git push answer 403 for this session) |
| `main`                                      | `b34bf5b` "Initial commit": **README only**. PR #1 therefore brings the whole application                            |
| PR head on GitHub at the start of the audit | `0743514` (= `refs/pull/1/head` = `origin/feature/rentmate-conversion`)                                              |
| Commits / files at that head (main..head)   | 86 commits, 441 files                                                                                                |
| Audit commits (this report)                 | `6eb1407`, `4d65357`, and the commit adding this file. Delivered as a bundle (push is blocked)                       |

## 2. Scope review of the 441 files

| Area                                 | Files | Assessment                                                                                                                                                                |
| ------------------------------------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/public`                    |   166 | 161 generated DiceBear SVG avatars (licence in `CREDITS.txt`, SVGs checked by the policy guard: no images, scripts or links), 4 html                                      |
| `apps/web/src`                       |   108 | Application code and tests                                                                                                                                                |
| `docs`                               |    42 | Design, audit, runbooks, rollback SQL                                                                                                                                     |
| `supabase/migrations`                |    24 | All new to `main`; see §5                                                                                                                                                 |
| `supabase/tests`                     |    18 | SQL suites                                                                                                                                                                |
| `apps/api/src`                       |    15 | API code and tests                                                                                                                                                        |
| `.claude` (skills, agents, hooks)    |    20 | Development tooling; hooks enforce repository rules and are tested (`npm run test:hooks`)                                                                                 |
| `supabase/seed`                      |     4 | Demo data and a manual owner-run tester grant; `is_tester` is not client-writable (checked)                                                                               |
| `scripts`, root config, CI, lockfile |   ~42 | Test harnesses, policy guard, CI                                                                                                                                          |
| `tools/aihub`                        |     2 | **Scope concern (Low):** a 763-line personal developer-environment tool unrelated to the product. Recommend moving it to its own repository; not deleted without approval |

No build output, logs, binaries, media, `.env` files or ignored-but-tracked files are committed. Largest files:
`package-lock.json` (196 KB), `supabase/seed/demo_profiles.sql` (116 KB). `.mcp.json` contains only `${…}` placeholders
(Low, developer tooling). No duplicate implementations found: the live, calls, marketplace and wallet modules each have
one implementation, and the older Soulmate dating code is the base RentMate builds on, not a copy.

**Review burden:** because `main` holds only a README, PR #1 is the entire product (≈ 441 files). A reviewer should go
area by area (migrations → API → web) rather than file order.

## 3. Review checklist

| #   | Item                                                   | Result                                      | Evidence                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Architecture and code changes                          | PASS                                        | Thin Express handlers; the database decides and the API signs (LiveKit); zod on every body (`apps/api/src/validation.ts`, `live/routes.ts`); typecheck strict                                                                  |
| 2   | Migrations, constraints, indexes, RLS                  | **FAIL** (deployment) / PASS (schema)       | Schema: catalog audit of the final schema (49 tables, 150 definer functions, all `search_path=''`; RLS or no grants on every table). History: see §5, H-1                                                                      |
| 3   | Authentication, authorization, server-side enforcement | PASS                                        | `requireAuth` on every `/api/v1` route, 503 when unconfigured; `has_role` needs `aal2` once MFA is enforced; SQL `admin_mfa` 28/28, `policy_audit` 36/36                                                                       |
| 4   | Booking availability and overlap                       | PASS                                        | `companion_no_overlap` / `member_no_overlap` `exclude using gist (… slot with &&) where status='accepted'` (`20261119090000_marketplace.sql:320`); `marketplace.sql` 80/80; races on real PostgreSQL 16: `test:db:concurrency` |
| 5   | Token accounting and ledger                            | PASS                                        | `balance >= 0` checks, unique `idempotency_key`, key reuse with other values refused (`20261120100000_token_wallet.sql`); `token_wallet.sql` 27/27; double spend and replay on PostgreSQL 16; wallet-upgrade test              |
| 6   | Live safety, host controls, guests, moderation         | PASS                                        | Persistent server-enforced host mutes (`guest_host_mutes.sql` 18/18; RTC checks against LiveKit's own state); removal queue on block/suspend; chat screening and rate limits (`calls_and_live_rooms.sql` 57/57)                |
| 7   | Install, format, lint, types, tests, builds            | PASS                                        | §7                                                                                                                                                                                                                             |
| 8   | GitHub Actions and dependency vulnerabilities          | **BLOCKED** (CI view) / PASS (dependencies) | CI results and alerts cannot be read from here (API 403). Dependencies: §6                                                                                                                                                     |
| 9   | Environment and deployment                             | PASS (repo) / BLOCKED (production)          | `.env.example` only; `render.yaml` CSP tested by the browser suites; production depends on H-1 and founder approvals F-03, F-06                                                                                                |

## 4. Security findings

No Critical findings. Fixed items keep their regression tests.

### High

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 | **Migration history mismatch with production.** Production (`soulmate-ai`, read-only `list_migrations`) records `20261023165729 demo_mode_public`; the repository has `20261023170000_demo_mode_public.sql`. The other 11 applied versions match. `supabase db push` refuses to run while a remote version is missing locally; with `--include-all` it would try to run demo_mode_public again. | **BLOCKED.** Fix = rename the file to `20261023165729_demo_mode_public.sql` (as commit `155cbd7` did for another file), but only after confirming its SQL equals the statements production recorded. That comparison is a read query on production, so it awaits approval |
| H-2 | **CodeQL `js/insufficient-password-hash`, `apps/api/src/live/providers.ts:70`** (open on GitHub).                                                                                                                                                                                                                                                                                               | **False positive; BLOCKED on a manual dismissal.** See below                                                                                                                                                                                                              |

**H-2 analysis.** CodeQL 2.27.5 was run locally on this branch; this is its only result. The flagged flow is
`opts.apiKey` → the JWT `iss` claim → `signingInput` → `createHmac("sha256", apiSecret).update(signingInput)`. The value
treated as a "password" is the LiveKit **API key ID**: a public identifier that LiveKit requires in `iss` ("API key used to
issue this token"), and that the official SDKs sign in exactly this way (HS256 keyed by the API secret). HMAC-SHA256 here
is a message authentication code over a JWT, not password storage, so a slow hash (bcrypt, scrypt, Argon2) would be wrong:
LiveKit would reject the token. The only stored secret hash in the system (`private.integration_secrets`) holds generated
tokens of 32+ characters, and since `20261123100000_integration_secret_strength.sql` the database refuses anything weaker
(`integration_secret_strength.sql` 7/7).

Required GitHub disposition: Security → Code scanning → this alert → **Dismiss → "False positive"**, with the comment in
`docs/SECURITY_NOTES_LIVEKIT_JWT.md` (the `gh api` command is there too). **The alert is not cleared until GitHub shows it
dismissed;** this report does not claim otherwise. If the PR's CodeQL check is the "not successful" check in the
screenshots, dismissing the alert is what turns it green.

### Medium

| ID  | Finding                                                                                                                                                                                                                                                                                                       | Status                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-1 | **vite 6.4.5** (dev dependency of `apps/web`, also used by vitest) is in the affected range of **GHSA-p4f5-76q4-ffq7** (remote code execution through `__vite-browser-external` when the dev server is exposed with `--host`/`server.host`; affected `<= 6.4.5`, fixed 6.4.6). `npm audit` did not report it. | **FIXED `6eb1407`.** Upgraded to 6.4.6 and the floor raised to `^6.4.6`. Exposure was low (no `--host` anywhere; production serves the static build). Regression: the policy guard fails if any copy of vite below 6.4.6 is in `package-lock.json` (`4d65357`)                      |
| M-2 | **Future-dated migration versions.** `20261123090000` and `20261123100000` are ahead of today (2026-11-20). A migration created before 23 Nov would sort before them and run out of order, or be refused by `supabase db push`.                                                                               | **FIXED `4d65357` (guard).** The files are not renamed (they may already be referenced, and the order is still valid). The policy guard now fails when a migration added later sorts at or before one added earlier, and names the version to use. CI fetches full history for this |

### Low

| ID  | Finding                                                                     | Status                        |
| --- | --------------------------------------------------------------------------- | ----------------------------- |
| L-1 | `tools/aihub` is unrelated personal tooling inside the product repository   | Open; recommend moving it out |
| L-2 | `CLAUDE.md` is still titled "SOULMATE.AI" and describes only the dating app | Open; documentation           |
| L-3 | `.mcp.json` committed (placeholders only)                                   | Accepted; no secrets          |

### Security areas reviewed (no open defect)

| Area                                | Evidence                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication and sessions         | Supabase JWT verified server-side; fails closed (503); MFA (`aal2`) for admin roles once enabled; recovery codes hashed; e2e-mfa                                                                 |
| Admin and roles                     | `has_role` in definer functions; roles not client-writable; `policy_audit.sql`                                                                                                                   |
| Input validation and rate limiting  | zod on every body; express-rate-limit and helmet; per-table write limits and chat/reaction limits in SQL                                                                                         |
| RLS and definer functions           | Every definer function `search_path=''`; anon has no write grants; anon-executable functions are a demo read and three secret-guarded integration RPCs                                           |
| Secrets                             | Policy guard secret patterns; no `.env` tracked; config redacts secrets (API test); integration secret stored as SHA-256 and strength-checked                                                    |
| LiveKit tokens and webhooks         | 600 s single-room tokens, no admin/recording grants; webhooks checked for signature, issuer, expiry and body hash (API tests); real LiveKit 1.13.11 rejects expired and foreign tokens (e2e-rtc) |
| Host mutes across reconnects        | Stored in the database, enforced by LiveKit permission and by every later token; e2e-rtc reload-and-rejoin check                                                                                 |
| Guest camera/microphone permissions | `live_my_publish_sources`; guests cannot mute the host; consent recorded on accept                                                                                                               |
| Blocking, reporting, suspension     | Block ends calls, empties rooms, cancels open bookings; suspension removes from rooms mid-stream (SQL and e2e-rtc)                                                                               |
| Booking fraud and races             | Exclusion constraints, re-checks on accept, concurrency suite on PostgreSQL 16                                                                                                                   |
| Personal data, location, messages   | Other members cannot read `lat`/`lng`; messages readable only by match participants; private photos bucket                                                                                       |
| Uploads and moderation              | Storage bucket MIME and size limits; reports; no-adult-content triggers and constraints (`no_adult_content.sql` 16/16)                                                                           |
| Product rules (§5 of the brief)     | Explicit categories disabled by constraint; `financial_flags` constraints keep purchases, deposits, transfers, withdrawals, cash redemption and payouts **off**; call metering off               |

## 5. Database and migration review

- **Order (24 files, oldest → newest):** `20261022210236_init` … `20261123100000_integration_secret_strength`. Versions grow
  in the order the files were added (renames keep their original position); the policy guard checks this now (M-2).
- **Production history (read-only):** 12 applied; 11 match file names; `demo_mode_public` does not (H-1). The 12 PR
  migrations from `20261024090000` on are **not applied** to production (founder approval F-03, back up first).
- **Destructive statements:** none in migrations from `20261118000000` on (policy guard). Earlier ones contain two
  `delete` statements, both inside functions run on demand, never at migration time: `private.delete_my_account` (a member
  deleting their own account) and `admin_set_role` (revoking a role).
  Top-level data writes are seed rows (`insert … values`), switching the photos bucket to private, and switching explicit
  categories and countries **off**. Nothing rewrites member data.
- **Existing database safety:** new tables, columns with defaults, functions and policies; `20261120090000` revokes
  TRUNCATE/REFERENCES/TRIGGER from API roles (least privilege).
- **Integration secret strength:** `private.set_integration_secret` requires 32+ characters from a token alphabet with at
  least 12 distinct characters; `integration_secret_strength.sql` 7/7.
- **Disposable databases:** all migrations on PGlite (16 SQL suites) and on a fresh PostgreSQL 16 (concurrency suite);
  nothing touched a real database apart from the read-only history listing.
- **Rollback and re-application:** `npm run test:rollback` undoes the six newest steps one after another, compares 858 → 622
  schema objects with a database that never had them, runs the older suites, then re-applies and re-runs each suite.

## 6. Dependency vulnerability report

| Source                             | Result                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit` (415 dependencies)     | 0 vulnerabilities before and after the upgrade                                                                                                                                           |
| Vendor advisories, checked by hand | vite 6.4.5 → GHSA-p4f5-76q4-ffq7 → fixed (M-1). vitest / @vitest/mocker 5.0.5: GHSA-5xrq-8626-4rwp, GHSA-82fw-gwwq-j7x9, GHSA-xp26-3454-mjgp all fixed at or before 5.0.3 → not affected |
| GitHub Dependabot                  | **BLOCKED:** the alert list cannot be read here. If the "moderate" alert names a package other than vite, send its GHSA id and it will be checked the same way                           |
| Manifests / Actions                | npm only; `actions/checkout@v7`, `actions/setup-node@v7`                                                                                                                                 |

## 7. Verification (head `4d65357`, run in this session)

Node 22.22.0, npm 10.9.4, clean `npm ci`, working tree clean. All logs were kept for this report.

| Check                                                                       | Command                       | Result                                                                                     |
| --------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Clean install                                                               | `npm ci`                      | PASS                                                                                       |
| Policy guard (secrets, media, adult content, migrations, dependency floors) | `npm run test:policy`         | PASS: self-test 67/67, 437 files                                                           |
| Format                                                                      | `npm run format:check`        | PASS                                                                                       |
| Lint                                                                        | `npm run lint`                | PASS                                                                                       |
| Type checks (API and web)                                                   | `npm run typecheck`           | PASS                                                                                       |
| API unit tests                                                              | `npm test`                    | PASS 103/103                                                                               |
| Web unit tests                                                              | `npm test`                    | PASS 175/175                                                                               |
| Demo generator tests                                                        | `npm test`                    | PASS                                                                                       |
| Database suites (PGlite)                                                    | `npm test` (`test:db`)        | PASS: 16 suites, 492 checks                                                                |
| Production builds                                                           | `npm run build`               | PASS                                                                                       |
| Rollback rehearsal                                                          | `npm run test:rollback`       | PASS: 6 steps, schema restored each time, suites pass after rollback and after re-applying |
| Wallet upgrade (existing members)                                           | `npm run test:wallet-upgrade` | PASS 6/6                                                                                   |
| Concurrency on PostgreSQL 16.15 (disposable)                                | `npm run test:db:concurrency` | PASS 5/5 (double accept, retry, cancel/accept, double spend, replayed spend)               |
| Browser smoke under the production CSP                                      | `npm run test:e2e`            | PASS 13/13                                                                                 |
| Admin MFA in the browser                                                    | `npm run test:e2e:mfa`        | PASS 17/17                                                                                 |
| Real-media LiveKit 1.13.11                                                  | `npm run test:e2e:rtc`        | PASS 59/59                                                                                 |
| Hook guards                                                                 | `npm run test:hooks`          | PASS 21/21                                                                                 |
| aihub tool                                                                  | `npm run test:aihub`          | PASS 32/32                                                                                 |
| Dependency audit                                                            | `npm audit`                   | 0 vulnerabilities (see §6 for the advisory npm did not list)                               |
| Secrets                                                                     | policy guard + `git ls-files` | No secrets; no `.env` file tracked                                                         |

**GitHub CI:** BLOCKED. Run results cannot be read from this session. The last run known to this audit,
[44601328482](https://github.com/Shivaaye-Technologies/RentMate/actions/runs/44601328482), failed the `rtc` job at
`f88118e`; that failure is fixed (RTC-01). The local commands above are the same commands the CI jobs run. After the
bundle is pushed, check each job (`check`, `db-concurrency`, `e2e`, `rtc`) and CodeQL on the PR's Checks tab.

## 8. Fixes in this audit

| Commit    | Change                                                                                                     | Regression test                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `6eb1407` | vite 6.4.5 → 6.4.6, range `^6.4.6` (M-1)                                                                   | Dependency-floor rule + 4 self-test cases          |
| `4d65357` | Policy guard: migration add order (with rename handling), dependency floors; CI fetches full history (M-2) | 9 order/log self-test cases; mutation runs (below) |

Mutation checks: an untracked `20261120210000_…` migration fails the guard with the message naming `20261123100000`; an
untracked `20261124000000_…` passes; a lockfile with vite 6.4.5 fails.

## 9. Remaining blockers

1. **H-1** migration version mismatch with production. Needs approval for a read-only comparison, then a one-file rename.
2. **H-2** CodeQL alert: dismiss as false positive in GitHub (founder).
3. Push the audit bundle (the assistant gets 403), then confirm every CI job and CodeQL on the PR.
4. Dependabot: confirm which alert GitHub shows (§6).
5. Not verified here: real Android/iOS devices, mobile networks, hosted LiveKit (F-06), load, an external penetration test,
   legal review of the companionship and token terms.
6. Founder decisions already listed in `docs/FOUNDER_APPROVALS.md` (F-03 production migrations, F-25 MFA rollout, F-27
   theme, and others).

## 10. Verdict

**NOT READY.**

The code itself holds up: no Critical or open code-level security defect was found, and every local check passes
on `4d65357`. It is not ready to hand over for merge review yet, because three things can't be confirmed from here:

1. The audit commits are not on GitHub yet, and the CI result for the head that will be reviewed is unknown.
2. The CodeQL alert (H-2) is still open in GitHub.
3. The migration file names do not match production's history (H-1), so the first deploy would fail.

It becomes **READY FOR HUMAN REVIEW** once:

- the bundle is pushed and every CI job and CodeQL are green on the new head;
- the CodeQL alert is dismissed with the documented justification;
- H-1 is resolved: compare, then rename.

Production readiness additionally needs the items in §9.5 and §9.6.
