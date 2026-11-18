# Founder Approvals

Nothing below is decided by engineering. Each item stays in its current state until the founder records a decision
here (date + decision + reference). Status date: 2026-11-18.

| ID   | Decision needed                                                                                               | Current state                           | Why it matters                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| F-01 | Restore GitHub access (account `souravsingh80000-design` reports "suspended") or name a new home for the repo | **BLOCKED**                             | No pushes, PRs or CI; Render cannot pull new code.                              |
| F-02 | Approve merging `rentmate-migration` (via PRs) into `main`                                                    | Not requested yet                       | `main` auto-deploys to production on Render.                                    |
| F-03 | Apply migrations `20261024090000_profile_details` and `20261101090000_live_foundation` to production          | Not applied                             | Needed before PR #9 and live features work in production. Back up first.        |
| F-04 | SMS provider for phone OTP (vendor, budget, DLT registration in India)                                        | Email auth only                         | Spends money; Indian SMS needs DLT templates.                                   |
| F-05 | Identity/age verification vendor and contract                                                                 | Admins record results manually          | Required for creators, companions and age assurance.                            |
| F-06 | LiveKit production plan and terms review                                                                      | Provider row `disabled`                 | Spec: integrate a provider only after written terms authorise our model.        |
| F-07 | Explicit/adult live content: keep disabled platform-wide for RentMate?                                        | Disabled everywhere (no clearance refs) | RentMate forbids sexual services; adult streams + paid meetups is high risk.    |
| F-08 | Free limits: 50 likes and 10 messages per rolling 24 h (spec) vs today's 300 likes/day, unlimited messages    | Today's limits unchanged                | 10 messages/day strongly restricts chat for members without tokens.             |
| F-09 | Token prices: bonus 100, voice 10/min, video 1/sec (= 60/min)                                                 | Not built                               | Video is 6× voice; with only the bonus, a member gets under 2 min of video.     |
| F-10 | Any token purchase / deposit, withdrawal, transfer, redemption, creator payout, payment collection            | **Disabled by design**                  | Needs Indian legal, tax (GST) and payment-provider approvals (RBI rules).       |
| F-11 | Booking commission (15% illustrative) and settlement                                                          | Not built; settlement disabled          | Financial activation.                                                           |
| F-12 | Gender-differentiated listing activation or pricing                                                           | Disabled pending legal review           | Discrimination and legal risk.                                                  |
| F-13 | Physical companionship launch: cities, legal opinion, insurance, safety partner                               | Not built                               | Paid in-person meetings carry trafficking and safety risk; legal review needed. |
| F-14 | Recording policy (consent, retention, deletion)                                                               | Recording not built                     | Consent of all participants required.                                           |
| F-15 | HostyCare/cPanel credentials or a decision to stay on Render only                                             | Not audited                             | Can't assess without access.                                                    |
| F-16 | Production deploy of any RentMate change                                                                      | Not requested                           | Always explicit.                                                                |
| F-17 | Supabase Auth settings (Site URL, redirect URLs, custom SMTP, leaked-password protection) — carried over      | Pending                                 | Email links currently point to localhost; built-in sender is rate-limited.      |

## Recorded decisions

| Date       | ID  | Decision                                                                                                   |
| ---------- | --- | ---------------------------------------------------------------------------------------------------------- |
| 2026-10-31 | —   | Live: LiveKit chosen; verification via provider; 4-PR delivery; explicit only outside India (pre-RentMate) |
