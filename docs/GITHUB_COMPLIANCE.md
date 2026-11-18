# GitHub Terms and Acceptable Use — How RentMate Complies

Checked 2026-11-18 against the GitHub Terms of Service and Acceptable Use Policies. This is an engineering
checklist, not legal advice.

## Audit of the repository (branch `rentmate-migration`)

| GitHub rule                                       | Finding                                                                                                                                                                           | Status |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| No sexually obscene or sexually themed content    | No images, videos or sexual text. Code only. Policy text in the app forbids sexual services.                                                                                      | OK     |
| No exploitation or abuse content, incl. of minors | None. App enforces 18+ in code and database.                                                                                                                                      | OK     |
| No secrets or credentials                         | No real keys or tokens. Only `.env.example` (names, no values). Token-like strings in `tools/aihub/test` are fake fixtures used to prove redaction (`ghp_ShouldNeverBeLogged` …). | OK     |
| Privacy: no third-party personal data             | Only `.test` / `.invalid` email addresses; demo profiles are fictional and labelled; no real user data.                                                                           | OK     |
| No misinformation / deceptive content             | Landing page labels unbuilt features "In development"; demo data labelled fictional.                                                                                              | OK     |
| No spam or excessive automated bulk activity      | About a dozen PRs in a month, CI on push only, no bulk issues/comments/stars/follows.                                                                                             | OK     |
| No inauthentic accounts or interactions           | See "Accounts" below — **needs the owner's attention**.                                                                                                                           | CHECK  |
| Large files / bandwidth                           | Largest tracked file ~190 KB (`package-lock.json`); no binaries or media.                                                                                                         | OK     |

## Accounts (important)

GitHub's Terms say one person may hold **only one free personal account** (plus at most one machine account used
only for automation). If `souravsingh80000-design` and `rentmate970-hue` are both free personal accounts owned by the
same person, that breaks the Terms and can lead to suspension.

Compliant set-up:

1. Keep **one** personal account.
2. Create a free **organization** (for example "RentMate") owned by that personal account. Organizations are not
   personal accounts, so this is allowed.
3. Transfer the repositories into the organization and install the Claude GitHub App on the organization.
4. Do not create extra accounts to work around a suspension; appeal through GitHub Support instead.

## Rules we follow from now on

- Never commit secrets, `.env` files, real user data, or real people's photos. Test data uses `.test`/`.invalid`.
- Never commit sexual imagery or sexual text. Adult-content features (if ever approved, F-07) are flags and policy
  checks only; no explicit media is ever stored in the repository.
- Keep GitHub activity human-scale: few, meaningful PRs; no bulk issues, comments, stars, follows or forks; no
  scripted account creation; respect API rate limits.
- Use the Claude GitHub App or the owner's own credentials only; never shared logins.
- Do not scrape or mirror third-party content into the repository.
