# RentMate — GitHub Security Configuration Report

Date: 2026-11-20 · Prepared by Claude (automated). **This session had no access to GitHub's settings or alert pages**
(API: 403 for this repository; no browser connected). Nothing on GitHub was changed by this session.

Evidence labels used throughout:

- **GitHub (founder)** — read directly on GitHub by the founder and reported to this session (screenshots were described
  in chat; the image files were not received here).
- **Local** — verified in this session against the repository's git data or by running the code.
- **Inferred** — reasoned from evidence, not observed.
- **Not accessible** — could not be checked by anyone in this session.

## 1. Repository and branch

| Item           | Value                                                                              | Evidence                         |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| Repository     | `Shivaaye-Technologies/RentMate` (public)                                          | Local (`git ls-remote`)          |
| Branch         | `feature/rentmate-conversion`                                                      | Local                            |
| Default branch | `feature/rentmate-conversion` (unchanged; switching to `main` is F-26)             | Local (`git ls-remote --symref`) |
| `main`         | `b34bf5b`, README only                                                             | Local                            |
| PR #1          | head `5f1af3c` = remote branch; merge ref present (consistent with open, unmerged) | Local; open state per founder    |

## 2. Latest commit and CI

| Item                                                             | Value                                                                | Evidence         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------- |
| Latest commit                                                    | `5f1af3c5066c1dba5a6b107a8733d9bbb39557f7`                           | Local            |
| CI #8 on `5f1af3c`                                               | Success, all four jobs (`check`, `db-concurrency`, `browser`, `rtc`) | GitHub (founder) |
| Same commands locally on `790b4d0` (code identical to `5f1af3c`) | All pass (see `docs/POST_CI_SECURITY_AUDIT.md` §8)                   | Local            |

## 3. Dependabot alert inventory

| #   | Advisory            | Package   | Installed (vulnerable) | Severity | Path                                                                             | Status                                  | Patched                        | Action                          | Evidence                                                              |
| --- | ------------------- | --------- | ---------------------- | -------- | -------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------ | ------------------------------- | --------------------------------------------------------------------- |
| 1   | GHSA-g3hv-75wg-m249 | minimatch | 10.2.6                 | Moderate | `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` (dev) | **Closed — Fixed** (not auto-dismissed) | 11.0.1 (installed now: 11.0.9) | None; regression guard in place | Status: GitHub (founder). Path, versions, fix commit `0e2b324`: Local |

Open alerts: **0** — GitHub (founder). Consistent with the local scan of `5f1af3c`'s lockfile against GitHub's 37,984
reviewed advisories: 0 matches across 411 package copies (Local, `npm run audit:advisories`).

## 4. CodeQL alert inventory

| Rule                                         | Severity | Location                            | Status                                                           | Evidence                                                                |
| -------------------------------------------- | -------- | ----------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `js/insufficient-password-hash`              | High     | `apps/api/src/live/providers.ts:70` | **Open** — false positive, left open pending maintainer approval | Status: GitHub (founder). Flow and rationale: Local (CodeQL CLI 2.27.5) |
| `js/insufficient-password-hash` (historical) | —        | `providers.ts:49`                   | Closed — Fixed                                                   | GitHub (founder)                                                        |
| `js/insufficient-password-hash` (historical) | —        | `providers.ts:57`                   | Closed — Fixed                                                   | GitHub (founder)                                                        |

The two historical alerts are the same finding at earlier line numbers: the HMAC code moved as LiveKit features were
added (49/57 → 61 → 70). GitHub records a moved finding as a closed alert plus a new one. Inferred from the commit
history and `docs/SECURITY_NOTES_LIVEKIT_JWT.md`.

**Why line 70 is a false positive** (Local; full evidence in `docs/SECURITY_NOTES_LIVEKIT_JWT.md`):

- All four CodeQL flows start at `this.opts.apiKey` (`requireCreds()` line 175, or the `iss: apiKey` claims at lines 185
  and 217) and end at `createHmac("sha256", apiSecret).update(signingInput)`. CodeQL's name heuristic treats a value
  called `apiKey` as a password.
- The value is LiveKit's **public API key ID**, which LiveKit requires in every token's `iss` claim. The operation is
  **HS256 JWT signing** (HMAC-SHA256 keyed with the LiveKit API secret), not storage of a member password. No member
  password reaches this code; login is Supabase Auth.
- LiveKit verifies only HS256 signatures made with the API secret. Argon2, bcrypt or scrypt would break every join,
  webhook and RoomService call, and would protect nothing: HS256's strength depends on the secret, which configuration
  requires to be 32+ characters with 12+ distinct characters.
- A local CodeQL run with GitHub's default suite (87 rules) finds no other result in the repository.

**Not changed:** the alert was not dismissed, suppressed or worked around, and the HMAC implementation is unchanged.
Maintainer dismissal steps (only after your approval) are in `docs/SECURITY_NOTES_LIVEKIT_JWT.md` §5.

## 5. Minimatch alert disposition

**Fixed.** Alert #1 is closed as Fixed, not auto-dismissed (GitHub, founder). The vulnerable 10.2.6 copy came from
typescript-eslint and was replaced by 11.0.9 in `0e2b324` (Local). eslint's own minimatch 3.1.5 is below the affected
range (Local). The policy guard fails if any copy in the affected range returns, including the exact nested layout
(`790b4d0`, Local).

## 6. Secret scanning settings

| Setting             | State | Recommendation                                                                                            | Evidence                        |
| ------------------- | ----- | --------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Secret scanning     | On    | Keep                                                                                                      | GitHub (founder, earlier brief) |
| Validity checks     | On    | Keep                                                                                                      | GitHub (founder)                |
| Extended metadata   | On    | Keep                                                                                                      | GitHub (founder)                |
| Generic patterns    | On    | Keep                                                                                                      | GitHub (founder)                |
| Push protection     | On    | Keep                                                                                                      | GitHub (founder)                |
| AI-detected secrets | Off   | Optional: enable if your plan offers it; finds passwords that no pattern matches, may add false positives | GitHub (founder)                |

No change recommended to the five protections that are on. The repository's own policy guard also blocks committed
secrets (Local).

## 7. Dependabot configuration

| Item                                                                   | State              | Recommendation                                                                                                                                                                                                                                | Evidence                                                       |
| ---------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Dependabot alerts                                                      | On                 | Keep                                                                                                                                                                                                                                          | GitHub (founder)                                               |
| Preset "Dismiss low-impact alerts for development-scoped dependencies" | **Enabled**        | **Disable** (§10, step A). It auto-dismisses some alerts in npm dev dependencies; minimatch #1 was exactly that kind of alert (a denial-of-service bug in a dev package). It was fixed, not dismissed, but the preset could hide the next one | State: GitHub (founder). Criteria: Inferred from GitHub's docs |
| Dependabot security updates                                            | Off                | **Enable** (§10, step C). Opens a pull request only when a vulnerable dependency has a fix; never merges                                                                                                                                      | GitHub (founder)                                               |
| Grouped security updates                                               | Off                | **Enable** with security updates: one pull request per batch in this npm workspace instead of one per package                                                                                                                                 | GitHub (founder)                                               |
| Malware alerts                                                         | Off                | Enable only if the setting is offered for this repository; alerts only                                                                                                                                                                        | GitHub (founder); availability Not accessible                  |
| `.github/dependabot.yml`                                               | **Does not exist** | Not needed for security updates. Add one only if you want routine version-update pull requests                                                                                                                                                | Local                                                          |

Impact of enabling security updates: pull requests target the **default branch**, currently
`feature/rentmate-conversion`, and each runs CI. Merge them only after review. No auto-merge exists in this
repository: no workflow enables it (Local).

## 8. CodeQL configuration

| Item                              | State                                                                                                                  | Evidence                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Setup                             | Default setup: no CodeQL workflow in `.github/workflows` (only `ci.yml`), so no duplicate or conflicting configuration | Local; enabled state per founder                                                       |
| Results on the correct branch     | Alerts appear for `feature/rentmate-conversion` (the default branch)                                                   | GitHub (founder)                                                                       |
| Last scan time and scanned commit | Not reported                                                                                                           | **Not accessible.** Check Settings → Advanced Security → CodeQL analysis (tool status) |
| Query suite                       | Default; unchanged                                                                                                     | Founder; not changed by this session                                                   |

## 9. Branch protection findings

| Item                      | State                                                                                                                                  | Evidence         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Rulesets                  | None                                                                                                                                   | GitHub (founder) |
| Classic branch protection | None                                                                                                                                   | GitHub (founder) |
| Risk                      | Any account with write access can force-push or delete `feature/rentmate-conversion`, the default branch holding the whole application | Inferred         |

**Recommended now:** one branch ruleset on `feature/rentmate-conversion` with **Restrict deletions** and **Block force
pushes** only (§10, step B). Normal `git push` (fast-forward, as the Termux bundle pushes are) keeps working. The only
workflow change: when PR #1 is merged later, GitHub's "Delete branch" button will be refused until the ruleset is
disabled. That is intended.

**Not recommended yet:** requiring pull requests, reviews or status checks on this branch. These would block direct
pushes, and a sole maintainer cannot approve their own pull request. Apply them to `main` once it becomes the default
branch (F-26): require a pull request, the four CI checks and code scanning results, block force pushes and deletion.

## 10. Changes made and settings changed

**Settings changed on GitHub by this session: none.** No access. Repository changes: this report only (local commit,
not pushed).

Manual steps for a maintainer, in this order:

**A. Disable the low-impact auto-dismiss preset**

1. Repository → **Settings** → in the sidebar under "Security and quality", **Advanced Security**.
2. In the **Dependabot** section, click the gear icon next to **Dependabot rules**.
3. Under **GitHub presets**, click the gear icon next to **Dismiss low-impact alerts for development-scoped
   dependencies**.
4. Under **State**, choose the disabled option (GitHub documents only the enable path; the label may differ slightly)
   → **Save rule**.
5. Verify: the preset shows as disabled. Open Security → Dependabot → **Closed** and check whether any alert is marked
   auto-dismissed; it should list only #1, closed as Fixed.

**B. Ruleset: block force pushes and deletion**

1. **Settings** → in the sidebar under "Code, planning, and automation", **Rules** → **Rulesets** → **New ruleset** →
   **New branch ruleset**.
2. **Ruleset name:** `protect-rentmate-conversion`.
3. **Enforcement status:** **Active**.
4. **Bypass list:** leave empty. If a history repair is ever needed, set the ruleset to Disabled temporarily instead.
5. **Target branches:** **Add target** → include by pattern → `feature/rentmate-conversion`. Use the exact name, not
   "Default branch", so the rule stays put when F-26 switches the default to `main`.
6. **Branch rules:** tick **Restrict deletions** and **Block force pushes**. **Untick everything else**, in particular
   _Require a pull request before merging_, _Require status checks to pass_, _Require code scanning results_,
   _Restrict creations_, _Restrict updates_ and _Require signed commits_.
7. **Create**.
8. Verify: the ruleset shows **Active** with exactly two rules. A normal `git push origin feature/rentmate-conversion`
   still succeeds. Do not test with a force-push.

**C. Dependabot security updates (recommended, optional)**

1. **Settings** → **Advanced Security** → **Dependabot**.
2. **Dependabot security updates** → **Enable**.
3. **Grouped security updates** → **Enable**.
4. Leave malware alerts unchanged unless the option is offered and you want alerts only.
5. Do not enable auto-merge for these pull requests.

**Must stay unchanged:** secret scanning and all its sub-settings, push protection, Dependabot alerts, CodeQL default
setup and query suite, the default branch, and the open CodeQL alert.

## 11. Remaining risks and recommendations

1. **The two GitHub changes above are not yet made** (needs a maintainer).
2. **The CodeQL alert stays open** until you approve dismissal; it will keep the code-scanning count at 1.
3. **Not accessible here:** the last CodeQL scan time and commit, the malware-alert setting's availability, and the
   exact UI labels for disabling a preset. Confirm on GitHub.
4. **Default branch = feature branch (F-26):** Dependabot, code scanning and the new ruleset all describe
   `feature/rentmate-conversion`; `main` has no protection until F-26.
5. **Advisories outside GitHub's reviewed database** (like Vite's GHSA-p4f5 before publication) are invisible to
   Dependabot and `npm audit`; the policy guard's advisory list covers known ones.

## 12. Production-readiness blockers

Not production ready. Open:

- independent penetration test and legal review (companionship terms, internal tokens, data protection);
- production configuration review (Render, Supabase, secrets, CORS, CSP hosts);
- real-device and network testing for calls and live streaming;
- founder decisions F-03 (production migrations after a backup), F-04/F-05, F-06 (LiveKit), F-08/F-09, F-14, F-20,
  F-25 (MFA rollout), F-26 (default branch), F-27;
- the GitHub steps in §10.

Unchanged and enforced: strictly 18+, no adult or sexual content or services, lawful non-sexual companionship only,
internal non-transferable tokens, no withdrawals, payouts, cryptocurrency, payments or subscriptions, and no recording
without explicit consent (default: none).
