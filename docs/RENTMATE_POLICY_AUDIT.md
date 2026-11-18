# RentMate — Post-Implementation Security and Policy Audit

Date: 2026-11-18 · Branch: `rentmate-migration` · Auditor: Claude (engineering self-audit with adversarial tests;
**not** an independent legal or penetration-test review).

**Permanent policy (applies everywhere, in every country):**

- Pornography: not supported.
- Sexually explicit content and adult entertainment: not supported.
- Sexual services, escorting and sexual solicitation: not supported.

**Verdict: NOT YET FULLY COMPLIANT.** Every pathway that exists today was inspected and tested. The database
blocks adult categories, adult country policies, and adult/solicitation wording in all member-written text that
other people see. Three pathways remain open and cannot be closed by code alone (photo moderation, member
suspension, chat evidence retention — section 7). Two surfaces are not built yet (group rooms, physical listings),
so they can't be verified until they exist. Nothing here is deployed; production is unchanged.

## 1. Policy compliance matrix

| Pathway                                | Exists? | Enforcement (database unless noted)                                                                                        | Tested by                        | Status                  |
| -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------- |
| Country policies                       | Yes     | `no_adult_content` check: adult can't be enabled in any country, by anyone (owner, admin RPC, member)                      | no_adult_content, policy_audit   | ENFORCED, TESTED        |
| Content categories                     | Yes     | `explicit_never_available` check; members have SELECT only; adult row kept but unavailable                                 | no_adult_content, policy_audit   | ENFORCED, TESTED        |
| Streaming providers                    | Yes     | Trigger: no adult category in `permitted_categories` (owner and admin RPC)                                                 | policy_audit                     | ENFORCED, TESTED        |
| Creator applications                   | Yes     | Trigger on `categories` (adult or unknown refused); stage name and bio screened                                            | no_adult_content, policy_audit   | ENFORCED, TESTED        |
| Public live streams                    | Yes     | Category trigger; title screened; members can't change category; policy functions refuse explicit; list filters; RLS hides | live_foundation, policy_audit    | ENFORCED, TESTED        |
| Private video/audio sessions           | Yes     | Category trigger; `live_session_check` refuses explicit                                                                    | no_adult_content, policy_audit   | ENFORCED, TESTED        |
| Group rooms                            | No      | Not built (co-performer streams up to 4 people are covered as streams)                                                     | —                                | NOT APPLICABLE YET      |
| Chat messages                          | Yes     | Keyword screening on insert/update (text only; chat has no media)                                                          | policy_audit                     | PARTIAL (keyword-based) |
| Super Like notes                       | Yes     | Keyword screening                                                                                                          | policy_audit                     | PARTIAL (keyword-based) |
| Profile text (name, bio, job, prompts) | Yes     | Keyword screening                                                                                                          | policy_audit                     | PARTIAL (keyword-based) |
| Profile photos (only upload path)      | Yes     | Private bucket, own-folder writes, type/size limits, reporting. **No automated image moderation**                          | rls_flow (storage)               | **GAP** (F-18)          |
| Live chat / comments / reactions       | No      | Not built                                                                                                                  | —                                | NOT APPLICABLE YET      |
| Physical listings                      | No      | Not built; design requires category allow-list, no free-text category, screened text, public venues only                   | —                                | NOT APPLICABLE YET      |
| Reporting                              | Yes     | New reasons `sexual_content`, `sexual_solicitation` (member and live); live ones are urgent                                | policy_audit, web tests          | ENFORCED, TESTED        |
| Creator suspension and appeals         | Yes     | `admin_review_creator`, `creator_appeals`, `admin_decide_appeal`; suspension ends live activity; all logged                | live_foundation, policy_audit    | ENFORCED, TESTED        |
| Member suspension                      | No      | Members can be reported and blocked, but there is no member suspension                                                     | —                                | **GAP** (F-19)          |
| Evidence retention                     | Partly  | Reports and audit log survive account deletion; reporter/reported ids become null; chat messages are deleted with accounts | policy_audit                     | **GAP** (F-20)          |
| Repository content (GitHub rules)      | Yes     | `scripts/policy-check.mjs` in `npm run check` and CI                                                                       | self-test 52/52, corpus, attacks | ENFORCED, TESTED        |

## 2. Database migration safety report

| Migration                            | Applied to production? | Destructive? | Notes                                                                                                                                                              |
| ------------------------------------ | ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 12 migrations up to `20261023165729` | Yes                    | —            | Unchanged. Verified with `list_migrations` on 2026-11-18.                                                                                                          |
| `20261024090000_profile_details`     | No                     | No           | PR #9.                                                                                                                                                             |
| `20261101090000_live_foundation`     | No                     | No           | Rollback SQL tested (`RENTMATE_ROLLBACK_PLAN.md`).                                                                                                                 |
| `20261118090000_no_adult_content`    | No                     | No           | Adds column, checks, triggers. Only data change: sets `available=false` on explicit categories and `explicit_allowed=false` on any country rows (a policy flag).   |
| `20261118100000_policy_hardening`    | No                     | No           | Adds screening triggers, provider trigger, report reasons (superset — every existing report stays valid), updated priority function. No rows deleted or rewritten. |

**Duplicate/held migration.** `20261118120000_no_adult_content.sql` was written at 17:57:07 IST by **this Claude
session** in an earlier, abandoned attempt at the same request (session log line 906). Earlier I said I hadn't written
it; that was wrong. It is **destructive** (deletes the adult category, rewrites `creators.categories` and
`live_providers.permitted_categories`). It was never committed, never in any bundle, and never applied
(production has 12 migrations). It is now kept only as a non-executable record at
`docs/held-migrations/20261118120000_no_adult_content.HELD.sql.txt` (sha256 `73d6295c…7107` of the original), with a
"do not apply" header. Supabase tooling only reads `supabase/migrations/*.sql`, so it cannot run.

**Accidental execution is now blocked by the guard.** For migrations from `20261118000000` on, CI fails on
`delete from`, `truncate`, `drop table/column/schema`, `disable trigger`, `disable row level security`, dropping any
no-adult trigger or constraint, or setting `available`/`explicit_allowed` to true. Duplicate migration versions or
names, and badly named files, also fail. Tested: a planted destructive migration and a planted duplicate were both
caught.

**Who can still bypass in principle:** the Postgres owner/superuser (Supabase dashboard SQL) could drop a constraint.
That is a governance control, not code: changes must go through a reviewed migration (which the guard blocks), and
dashboard SQL access should be limited to the founder (F-21).

## 3. Content moderation coverage report

- **Detection:** keyword screening of member-written public text and chat against a list of adult and solicitation
  terms (`private.prohibited_text` in `20261118100000_policy_hardening.sql`). Blocked text gets a plain-language
  message; nothing is stored. Place names such as Essex or Sussex pass (tested).
- **Limits:** keywords miss misspellings, other languages (Hindi or Hinglish wording), images and coded language.
  "Escort" as a verb is also blocked (rare false positive, accepted).
- **Reporting:** members can now report sexual content and sexual solicitation (two new reasons). Live reports with
  these reasons are marked urgent and reach the moderator queue first (tested).
- **Moderation:** moderators terminate streams/sessions (record kept), resolve reports, suspend creators, decide
  appeals; every action goes to the append-only audit log (tested).
- **Historical records:** legacy adult records inserted with triggers off stay intact, but are unlistable,
  unwatchable, unjoinable, can't broadcast, are hidden from other members, and can be terminated by moderators.

## 4. Security test results (run 2026-11-18, all in this session)

| Suite                                      | Result                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Policy guard (self-test + 366 files)       | 52/52 self-test, 366 files clean, 16 reviewed `policy-guard: allow` lines (refusal tests)       |
| Format, lint, typecheck, build             | pass                                                                                            |
| API (vitest + supertest)                   | 79 / 79                                                                                         |
| Web (vitest)                               | 146 / 146                                                                                       |
| DB `rls_flow`                              | 53 / 53                                                                                         |
| DB `demo_isolation` / `demo_mode`          | 21 / 21 · 13 / 13                                                                               |
| DB `discover_activity` / `profile_details` | 10 / 10 · 29 / 29                                                                               |
| DB `live_foundation`                       | 47 / 47                                                                                         |
| DB `no_adult_content`                      | 16 / 16                                                                                         |
| DB `policy_audit` (new, adversarial)       | 36 / 36                                                                                         |
| Hook guards / aihub                        | 21 / 21 · 32 passed, 0 failed                                                                   |
| Browser smoke (e2e)                        | pass, 0 failures                                                                                |
| Mutation checks                            | Without `no_adult_content`: 2 test files fail. Without `policy_hardening`: `policy_audit` fails |

Not tested: real devices, production database (no migrations applied), real LiveKit rooms, real image moderation.

## 5. Repository guard test results

- Adversarial corpus of 31 cases against the **old** guard: 4 false negatives (adult terms placed after "no" or
  "without", a leetspeak spelling, an offer of paid sexual activity) and 1 false positive (a French town name).
  Against the **new** guard: 0 and 0.
- Self-test now 52 cases (secrets, renamed media by file signature, SVG scripts, adult wording, prohibitions,
  allow-marker scope, destructive and duplicate migrations). One real bug was found and fixed during the audit: the
  rule for removing no-adult triggers missed names like `creators_no_adult_content`.
- Simulated attack on a copy of the repo (renamed JPEG, destructive migration, duplicate migration name, adult text):
  all 4 caught, exit 1.
- `npm run check` with a planted violation: exit 1. CI runs the guard as its first step on every pull request and
  push to `main`.
- Full history scan (918 objects, 623 blobs, all local branches): no real secrets, media or adult wording. Two older
  versions of `tools/aihub/test/aihub.test.sh` contain **fake** token-shaped fixtures (the example key from AWS's own documentation and a patterned
  Supabase-style placeholder); they are already on `main` and the current file doesn't contain them.
- Known limits: the guard reads words, not meaning; it can't judge images (so it bans all media files); it scans
  the working tree in CI, not past history (history was scanned once, manually, for this audit).

## 6. Commits, backup and GitHub

- 18 commits on `rentmate-migration` not on `origin/main` (9 from today's RentMate work, 9 from PR #9 and the live
  branches that were pushed before the suspension), all with Claude attribution trailers. This audit adds one more
  commit.
- Backup bundle verified: `git bundle verify` okay, head `88b0bd5` equals local, a clone from the bundle has the
  identical commit list.
- **Push failure (verified 2026-11-18 12:46 UTC):** `git push` → 403 "Claude doesn't have GitHub access…";
  GitHub API → "Sorry. Your account was suspended". Correction to an earlier statement: anonymous GitHub _web pages_
  return 403 for every account from this environment (including github.com/anthropics), so they are not evidence.
  Anonymous _git_ reads work, and `souravsingh80000-design/Hunterexch` now asks for a login, so the suspension is
  hiding that account's other repositories too.

### GitHub recovery and publishing plan

1. Sign in as `souravsingh80000-design`, read GitHub's suspension email or banner, and appeal via
   support.github.com (Account suspended). Don't create another account to get around it.
2. If GitHub cites more than one free account per person: keep one personal account. If `rentmate970-hue` is a second
   free personal account of yours, ask GitHub Support how to resolve it, then use one account.
3. Create a free organization (e.g. RentMate) under the single personal account, transfer repositories into it, and
   install the Claude GitHub App on that organization (github.com/apps/claude/installations/select_target), or
   reconnect GitHub at claude.ai/customize/connectors.
4. Then: push `rentmate-migration`, open one PR per phase, let CI (including the guard) run, and merge only with
   your approval. Repoint Render to the new repository location only with your approval.

## 7. Remaining risks and founder approvals

| ID   | Item                                                                                                                       | Risk     |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| F-01 | GitHub account suspended; appeal and choose the compliant account/organization structure                                   | High     |
| F-18 | Image moderation for profile photos (vendor such as an explicit-image detection API; cost and privacy review)              | High     |
| F-19 | Member suspension and appeals (today only creators can be suspended)                                                       | High     |
| F-20 | Evidence retention: keep reported chat and reporter/reported ids for a set period after account deletion (DPDP Act review) | Medium   |
| F-21 | Limit Supabase dashboard/SQL access to the founder; any constraint change only via reviewed migration                      | Medium   |
| F-22 | Multilingual screening (Hindi/Hinglish wording) and a reviewed term list owned by Trust & Safety                           | Medium   |
| F-03 | Apply `20261024090000`, `20261101090000`, `20261118090000`, `20261118100000` to production after backup                    | Approval |
| F-13 | Legal review before building physical companionship listings                                                               | Approval |

An independent penetration test and legal review are still required before launch.
