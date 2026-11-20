# RentMate — Post-CI Security Audit

Date: 2026-11-20 · Auditor: Claude (automated, in a Linux container). Every result below was produced in this session
unless it is marked **reported** (stated by the founder, not observable here) or **not verified**.

## 1. Repository and commit inspected

| Item                     | Value                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository               | `Shivaaye-Technologies/RentMate` (public; anonymous git read works, GitHub API and push do not from this session)                                                                         |
| Branch                   | `feature/rentmate-conversion`                                                                                                                                                             |
| Inspected head           | `b5fedc01a2ba2d407444c61b71adbf28c7068edf` = remote branch = `refs/pull/1/head`                                                                                                           |
| Default branch on GitHub | `feature/rentmate-conversion` (`git ls-remote --symref`): **Dependabot evaluates this branch**, not `main` (`b34bf5b`, README only). Switching the default to `main` is founder item F-26 |
| New local commits        | listed in §11; not pushed                                                                                                                                                                 |

## 2. CI #7

**Reported:** CI run #7 on `b5fedc0` succeeded with all four jobs (`check`, `db-concurrency`, `browser`, `rtc`). This
session cannot read GitHub Actions, so the run itself was not inspected. The same commands were run locally (§8).

A green CI run is not production readiness: it does not cover real devices, hosted LiveKit, production configuration,
penetration testing or legal review (§10).

## 3. CodeQL alerts

The alert list cannot be read from this session. CodeQL CLI **2.27.5** with the `javascript-code-scanning` suite (87
rules, the suite GitHub's default setup runs) was run locally on the source at `4da9c6a`/`b5fedc0` (identical source;
`b5fedc0` changed documentation only).

| Rule                            | Location                                         | Result            | Disposition                                                   |
| ------------------------------- | ------------------------------------------------ | ----------------- | ------------------------------------------------------------- |
| `js/insufficient-password-hash` | `apps/api/src/live/providers.ts:70` (`hs256Mac`) | 1 result, 4 flows | **False positive. Left open** (not dismissed, not suppressed) |
| All other 86 rules              | whole repository                                 | 0 results         | —                                                             |

**What is flagged.** All four flows start at `this.opts.apiKey` (`requireCreds()`, line 175, or the `iss: apiKey` claims
at lines 185 and 217) and end at `createHmac("sha256", apiSecret).update(signingInput)` on line 70. The "password" is
the LiveKit **API key ID**, a public identifier LiveKit requires in every token's `iss` claim. The "hash" is the HS256
JWT signature over the token body.

**Why it is not password hashing.** HMAC-SHA256 here authenticates a token; the secret is the HMAC _key_ (the
LiveKit-generated API secret), not the hashed input. LiveKit verifies only HS256 tokens signed with that secret, so
Argon2, bcrypt or scrypt would break every join, webhook and RoomService call. No member password reaches this code:
callers of `signJwt` are `issueToken` and `adminToken` (claims: key ID, user id, room, grants, times); login is Supabase
Auth. Full evidence, the ten verification points and maintainer dismissal steps: `docs/SECURITY_NOTES_LIVEKIT_JWT.md`.

**Genuine weaknesses found around it** (fixed in `4da9c6a`, already in `b5fedc0`; CI #7 covers them):

- RoomService admin tokens carried `roomAdmin + roomList + roomCreate` on every call; `roomCreate` is project-wide.
  Now each call carries only its documented grant (60 s). Verified against a real LiveKit 1.13.11 server.
- `LIVEKIT_API_SECRET` accepted 16 characters of anything; every member receives a token signed with it. Now 32+
  characters, no whitespace, 12+ distinct.
- `issueToken` now refuses invalid TTLs, rooms and identities (defence in depth).

No further weakness was found in this pass.

## 4. Dependabot alerts

The alert list cannot be read from this session. Instead, the repository's lockfile was matched against the data
Dependabot alerts are raised from: GitHub's **reviewed** advisory database (`github/advisory-database`, commit
`72f482c`, 2026-11-20, 37,984 reviewed advisories, 10,783 npm entries), using `scripts/advisory-scan.mjs` (added in
this audit; npm version ordering, every nested copy).

| Lockfile                        | Package copies | Matches |
| ------------------------------- | -------------: | ------: |
| `b5fedc0` (default branch head) |            411 |   **0** |
| Working tree after this audit   |            411 |   **0** |

**Alert history on this branch** (every lockfile version replayed):

| Advisory                                                                                         | Severity     | Package and path                                                                        | Installed                                  | Patched | Scope                           | Disposition                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------ | ------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-g3hv-75wg-m249 (DoS via globparts amplification, `>= 7.0.0 < 11.0.1`)                       | Moderate     | `minimatch`, `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` | 10.2.6 (until `0e2b324`)                   | 11.0.1  | Development only (lint)         | **Fixed** in `0e2b324` (typescript-eslint 8.73.0 → minimatch 11.0.9). eslint's own `minimatch` 3.1.5 is below the range. Regression guard added (§5) |
| 14 advisories in vite 5.4.21, vitest 2.1.9, @vitest/mocker 2.1.9, tinypool 1.1.1, esbuild 0.21.5 | Low–Critical | various                                                                                 | Oct 22–23 lockfiles (`fcade65`, `bfae7e2`) | —       | Development only                | Fixed in `c07b60d` (Oct 23); none present since                                                                                                      |
| GHSA-mrhx-c7xc-m3w5 (zod)                                                                        | High         | `node_modules/zod`                                                                      | 3.25.76                                    | 4.6.6   | **Production** (API validation) | Fixed in `396cf42` (Oct 29, zod 4.6.7)                                                                                                               |

GHSA-g3hv-75wg-m249 is very likely the "moderate" alert seen earlier: from Oct 29 (`396cf42`) until `0e2b324` it was
the only reviewed advisory matching the branch. Because Dependabot evaluates the default branch and that branch's head has no match, GitHub should show
the alert as **fixed** (closed automatically). **Not verified:** confirm on Security → Dependabot.

**Not in the reviewed database:** GHSA-p4f5-76q4-ffq7 (vite ≤ 6.4.5, fixed in 6.4.6) exists only as Vite's repository
advisory, not in the global database, so neither `npm audit` nor Dependabot reports it. It was fixed anyway (`6eb1407`)
and is guarded by the policy check.

GitHub Actions: only `actions/checkout@v7` and `actions/setup-node@v7`; no reviewed advisory affects either.

## 5. Vulnerabilities fixed

| ID                                                                 | Fix                      | Commit                     | Regression test                                                                                                                                   |
| ------------------------------------------------------------------ | ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-g3hv-75wg-m249 (minimatch)                                    | typescript-eslint 8.73.0 | `0e2b324` (earlier)        | Policy guard rule + 7 cases including the exact pre-fix nested layout; the `b5fedc0` guard passed that lockfile, the new one fails it (`790b4d0`) |
| GHSA-p4f5-76q4-ffq7 (vite)                                         | vite 6.4.6               | `6eb1407`, guard `b9c8e3b` | 32 range cases                                                                                                                                    |
| Admin-token over-grant, weak signing secret, unchecked join grants | providers/config         | `4da9c6a`                  | 5 API tests; each fix reverted once to confirm its test fails                                                                                     |

## 6. Files changed in this audit

| File                             | Change                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `scripts/advisory-scan.mjs`      | New: reviewed-advisory scan of `package-lock.json`, with matcher self-test   |
| `scripts/policy-check.mjs`       | GHSA-g3hv-75wg-m249 added to the dependency advisory list                    |
| `scripts/policy-check.cases.mjs` | 7 new cases                                                                  |
| `package.json`                   | `test:policy` also runs the matcher self-test; new `audit:advisories` script |
| `docs/POST_CI_SECURITY_AUDIT.md` | This report                                                                  |

No application code and no runtime behaviour changed in this audit.

## 7. Dependency upgrades

None in this audit: no installed version matches a reviewed advisory, and `npm audit` reports 0. Upgrading packages
without a finding would add risk without a security reason. Earlier security upgrades on this branch: typescript-eslint
8.73.0 (`0e2b324`), vite 6.4.6 (`6eb1407`).

## 8. Test results

Run on `790b4d0` (the code commit of this audit) from a clean `npm ci`, Node 22.22.0, npm 10.9.4, working tree clean.
`git diff --check` is clean for every commit.

| Check                                   | Command                             | Result                                                                                                                                                                                          |
| --------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install                                 | `npm ci`                            | Pass                                                                                                                                                                                            |
| Policy guard + matcher self-test        | `npm run test:policy`               | Pass: 103/103 policy cases, 439 files clean; matcher 12/12                                                                                                                                      |
| Format                                  | `npm run format:check`              | Pass                                                                                                                                                                                            |
| Lint                                    | `npm run lint`                      | Pass, 0 warnings                                                                                                                                                                                |
| Type checks (API, web)                  | `npm run typecheck`                 | Pass                                                                                                                                                                                            |
| API unit tests                          | `npm test`                          | 108/108                                                                                                                                                                                         |
| Web unit tests                          | `npm test`                          | 175/175                                                                                                                                                                                         |
| Database suites (PGlite)                | `npm test`                          | 16 suites, 492 checks, 0 failures                                                                                                                                                               |
| Production build                        | `npm run build`                     | Pass, **1 warning**: two chunks over 500 kB (`index` 666.72 kB / 188.20 kB gzip; `room`, the lazily loaded LiveKit client, 580.28 kB / 151.93 kB gzip). Performance, not security; pre-existing |
| Rollback rehearsal                      | `npm run test:rollback`             | 6/6 steps restore the schema; suites pass after rollback and re-apply                                                                                                                           |
| Wallet upgrade                          | `npm run test:wallet-upgrade`       | 6/6                                                                                                                                                                                             |
| Concurrency, PostgreSQL 16 (disposable) | `npm run test:db:concurrency`       | 5/5                                                                                                                                                                                             |
| Browser smoke under production CSP      | `npm run test:e2e`                  | 13/13                                                                                                                                                                                           |
| Admin MFA in the browser                | `npm run test:e2e:mfa`              | 17/17                                                                                                                                                                                           |
| Real-media LiveKit 1.13.11              | `npm run test:e2e:rtc`              | 59/59                                                                                                                                                                                           |
| Hook guards / aihub                     | `npm run test:hooks` / `test:aihub` | 21/21 / 32/32                                                                                                                                                                                   |
| Dependency audit                        | `npm audit`                         | 0 vulnerabilities (info 0, low 0, moderate 0, high 0, critical 0)                                                                                                                               |
| Reviewed-advisory scan                  | `npm run audit:advisories`          | 0 matches, 411 package copies                                                                                                                                                                   |
| Secrets                                 | policy guard, `git ls-files`        | No secrets; no `.env` file tracked                                                                                                                                                              |

No failures. Same results as on `b5fedc0` except the policy self-test count (96 → 103) and the new matcher self-test.

## 9. Remaining security risks

- **Alerts not observed directly.** CodeQL and Dependabot states on GitHub were inferred from local analysis; a
  maintainer must confirm them (§11).
- **CodeQL alert open** until a maintainer dismisses it as a false positive (with founder approval).
- **Default branch** is the feature branch (F-26). Dependabot and code scanning results describe it, not `main`.
- **Unreviewed advisories** (like GHSA-p4f5 before publication) are invisible to `npm audit` and Dependabot;
  vendor advisories for key packages still need watching.
- **Not tested here:** real Android/iOS devices, mobile networks, hosted LiveKit (F-06), load, an external penetration
  test, production configuration.

## 10. Production-readiness blockers

Not production ready. Open items:

1. Independent security review (penetration test) and legal review (companionship terms, tokens, data protection).
2. Founder decisions: F-03 production migrations (after a backup), F-06 LiveKit, F-25 MFA rollout, F-20 retention,
   F-04/F-05 SMS and age-verification providers, F-08/F-09 allowances and metering, F-14 recording (default: none),
   F-26 default branch, F-27 theme.
3. Production configuration review (Render and Supabase settings, secrets, CORS, CSP hosts).
4. Real-device and network testing for calls and live streaming.
5. Payments, subscriptions, withdrawals, payouts and cryptocurrency stay **disabled** (database constraints); tokens stay
   internal, non-transferable and not cash-equivalent.

## 11. Pushing the new commits

Not pushed. This session's GitHub credential cannot push to the repository (403), so a maintainer pushes, after
approving the commits:

```sh
cd RentMate
git checkout feature/rentmate-conversion
git pull --ff-only                                   # must be at b5fedc0
sha256sum -c RentMate-post-ci-audit.bundle.sha256    # from the folder holding the bundle
git bundle verify RentMate-post-ci-audit.bundle
git pull --ff-only RentMate-post-ci-audit.bundle HEAD
git log --oneline -3                                 # the commits in §6 on top of b5fedc0
git push origin feature/rentmate-conversion          # normal push, never --force
```

Then confirm on GitHub: CI on the new head; Security → Dependabot (GHSA-g3hv-75wg-m249 shown as fixed, no open alerts);
Security → Code scanning (only the documented `js/insufficient-password-hash` alert open).
