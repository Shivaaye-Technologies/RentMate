# RentMate — Phase 3 proposals (for founder review)

Status: **proposals only. Nothing in this document is implemented, enabled, purchased or deployed.** Each section
ends with the decision needed from the founder. Written 2026-11-20 on `feature/rentmate-conversion`.

Approved and implemented in Phase 3 (see `RENTMATE_FULL_AUDIT_REPORT.md`): P2-04 photo privacy, P2-05 server-side
photo deletion, P2-03 preparation (self-declared date of birth + 18+ confirmation). Everything below is awaiting
approval.

Standing rules that every proposal keeps: 18+ only; no adult, sexual or escort content; companionship is lawful,
non-sexual and in public/social settings; tokens stay internal, non-transferable and non-redeemable; no payouts,
withdrawals, cash or crypto; payments stay disabled.

---

## P2-01 — Expanded prohibited-content filter (proposal + test cases)

**Today.** `private.prohibited_text()` (`20261118100000_policy_hardening.sql:12-24`) lower-cases the text and runs
one regular expression of whole words. It misses spacing, digit/symbol swaps (`s3x`, `e$c0rt`), repeated letters,
and phrases built from ordinary words ("happy ending massage", "nude photos").

**Proposed approach (new migration; the old function is replaced via `create or replace` in a new file, never by
editing the applied one):**

1. **Normalise before matching** (pure SQL function `private.normalise_for_policy(text)`):
   - lower-case, `unaccent`-style folding where available;
   - map common substitutions: `0→o 1→i/l 3→e 4→a 5→s 7→t @→a $→s !→i`;
   - collapse runs of 3+ identical letters to 2 (`seeexy` → `seexy` is still caught by a `se+x` pattern);
   - also test a copy with spaces, dots, dashes and underscores removed, so `s.e.x` and `e s c o r t` are caught.
2. **Two outcomes instead of one:**
   - **Refuse** (as today: the write fails with the existing policy message) for unambiguous terms.
   - **Hold for review** for wording that is usually innocent but sometimes a euphemism (e.g. "massage", "body
     rub", "stay overnight", "private room"). The write succeeds but the row is flagged into the existing
     moderation queue and is not shown to others until a moderator clears it. This avoids blocking legitimate
     members ("I'm a sports massage therapist") while still catching solicitation.
3. **Term categories (draft for your review — the actual word list is NOT finalised):**

   | Category                          | Outcome                | Examples of the kind of term (illustrative, not the list)    |
   | --------------------------------- | ---------------------- | ------------------------------------------------------------ |
   | A. Explicit/pornographic material | Refuse                 | porn, nudes, explicit photos/videos, OnlyFans-type links     |
   | B. Sexual services / solicitation | Refuse                 | escort, sex work, "happy ending", paid intimacy phrasing     |
   | C. Sexual-content exchange        | Refuse                 | sexting, "send pics", nude photo requests                    |
   | D. Ambiguous euphemisms           | Hold for review        | massage, body rub, overnight, "private meeting", "no limits" |
   | E. Off-platform payment / cash    | Hold for review        | UPI ID, "cash only", phone-number-for-payment patterns       |
   | F. Minors-related wording         | Refuse + flag to admin | any wording implying someone under 18                        |

4. **Multilingual (decision needed):** the current list is English only. Hindi/Hinglish transliterations are the
   most likely gap for an India launch. I can draft a Hinglish category list for you to review; I will not invent
   one without your approval.

**Proposed test cases** (would become `supabase/tests/content_filter.sql`, every case one check):

| #   | Text                                                                             | Expected                                              |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | "happy ending massage"                                                           | Refuse (B)                                            |
| 2   | "send nude photos"                                                               | Refuse (C)                                            |
| 3   | "s3x for money"                                                                  | Refuse (B, digit swap)                                |
| 4   | "e$c0rt service"                                                                 | Refuse (B, symbol swap)                               |
| 5   | "e s c o r t"                                                                    | Refuse (spacing)                                      |
| 6   | "p.o.r.n"                                                                        | Refuse (punctuation)                                  |
| 7   | "sexxxting"                                                                      | Refuse (repeated letters)                             |
| 8   | "I offer massage, DM me"                                                         | Hold for review (D)                                   |
| 9   | "Pay me cash only, UPI here"                                                     | Hold for review (E)                                   |
| 10  | "Sussex", "Essex", "Middlesex"                                                   | Allow (place names)                                   |
| 11  | "I'm a sports massage therapist"                                                 | Hold for review, not refuse                           |
| 12  | "Let's visit the Escorial palace"                                                | Allow                                                 |
| 13  | "Scunthorpe", "class", "assistant", "analysis"                                   | Allow (substring traps)                               |
| 14  | "sexuality and gender studies student"                                           | Allow (decision: allow academic use?)                 |
| 15  | "Coffee and a museum walk on Sunday"                                             | Allow                                                 |
| 16  | Empty / null text                                                                | Allow                                                 |
| 17  | Same refused text in a profile bio, chat message, listing title and booking note | Refuse in all four tables                             |
| 18  | A moderator clearing a held row                                                  | Row becomes visible; audit log records who cleared it |

**Decisions needed:** approve the categories A–F and the refuse/hold split; review the actual term list I draft
next; decide on Hinglish coverage and on case 14.

---

## P2-02 — Permitted public meeting venues (proposal; not implemented)

**Today.** The public-place check (`20261119090000_marketplace.sql:114-121`, `:317`) only refuses text that looks
like a street address. "Hotel room 304", "my place" or "Airbnb" pass.

**Proposed model:** members pick a **venue category** from a fixed list (stored as a constrained `venue_category`
column on bookings/meeting points) plus a free-text venue name that still goes through the address check and the
content filter. Bookings without an allowed category are refused by the database.

**Proposed allowed categories (for your approval):**

| Category                                                     | Notes                           |
| ------------------------------------------------------------ | ------------------------------- |
| Café / coffee shop                                           |                                 |
| Restaurant / food court                                      |                                 |
| Shopping mall (common areas)                                 |                                 |
| Public park / garden / beach promenade                       | Daylight hours only? (decision) |
| Museum / gallery / heritage site                             |                                 |
| Cinema / theatre / concert / comedy show                     |                                 |
| Library / bookstore                                          |                                 |
| Sports venue / stadium / gym class / sports activity         | Spectating or group activity    |
| Public event / festival / exhibition / fair                  |                                 |
| Tourist attraction / city walk                               |                                 |
| Co-working space / study café (common areas)                 |                                 |
| Wedding / family function / office event (as a social guest) | Decision: allow?                |

**Proposed excluded (always refused):** hotels and lodging of any kind (including hotel lobbies — decision), homes
and private residences, Airbnb/rentals/PGs/hostels, private rooms or cabins (including "private dining rooms"),
vehicles as a meeting place, spas, massage or "wellness" parlours, nightclubs' private areas.

**Founder decisions:** bars/pubs/nightclubs (allow, allow before a set hour, or exclude?); late-night meetings
(cut-off time?); hotel lobbies/cafés inside hotels (public, but adjacent to rooms); day trips outside the city.

**Tests to add once approved:** every allowed category accepted; every excluded category refused; free-text
"hotel room"/"my flat"/"Airbnb" refused even under an allowed category; existing bookings untouched (additive).

---

## P2-06 — Render `Permissions-Policy` and location sharing (explanation before any change)

**Today.** `render.yaml:78` sends `geolocation=()`, which blocks location for every origin, including RentMate's
own pages. So "Share approximate location" in Settings always fails in production.

**The proposed change** is one token: `geolocation=()` → `geolocation=(self)`.

**Security and privacy consequences:**

- **Who could ask for location:** only pages served from RentMate's own web origin. Third-party scripts in iframes,
  embedded content and other sites still cannot use it. RentMate loads no third-party iframes today.
- **The browser still asks the member.** `(self)` permits RentMate to _request_; the member must still accept the
  browser's permission prompt, can deny it, and can revoke it in site settings. Nothing is collected silently.
- **When it is used:** only when the member presses "Share approximate location" (`Settings.tsx:153`). No page
  calls geolocation on load.
- **Precision:** the browser returns a precise position to the member's device. The app rounds it to about 1 km on
  the device before sending (`Settings.tsx:162`), **and** the database column is `numeric(5,2)`
  (`20261022211449_photos_location_superlikes_meet.sql:8`), so even a modified client cannot store more than 2
  decimals (~1.1 km). Other members only ever see a distance bucket (`private.distance_bucket`), never coordinates.
- **Residual risk:** a 1 km cell can still narrow down where someone lives in a sparse area, and repeated distance
  readings from different places could be used to triangulate. Mitigations already present: bucketed distances;
  recommended addition: a minimum distance shown (e.g. "under 2 km" instead of "1 km") and rate-limiting how often a
  member's own location can change.
- **No effect on** the Content-Security-Policy, framing protection (`frame-ancestors`), camera/microphone rules or
  any other header.
- **Legal:** precise location is personal data under the DPDP Act; the privacy notice should state that only an
  approximate location is stored, on request, and can be removed at any time.

**Decision needed:** approve `geolocation=(self)` (one-line `render.yaml` change, plus an e2e check that the header
allows only `self`), or keep location off and remove the button.

---

## P2-07 — API hosting alternatives (no upgrade made)

**Problem.** The API runs on Render's free plan. Free services sleep after inactivity, so the first request after
a quiet period is slow and background clean-up (e.g. removing ended live rooms) is delayed.

Prices as published on 2026-11-20 (check before buying; taxes extra):

| Option                                 | Monthly cost        | Notes                                                                                                         |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Render Free (today)                    | $0                  | Sleeps when idle; 512 MB. Fine for testing only.                                                              |
| Render Starter                         | $7                  | Always on; 512 MB, shared CPU. Smallest fix for the sleeping problem.                                         |
| Render Standard                        | $25                 | Always on; 1 CPU / 2 GB. Headroom for live rooms and more members.                                            |
| Render Pro                             | $85                 | 2 CPU / 4 GB. Not needed at launch scale.                                                                     |
| Render workspace "Pro" plan            | +$25                | Team features; not required for the service itself.                                                           |
| Railway Hobby                          | $5 incl. $5 usage   | Usage-based ($20 per vCPU-month, $10 per GB-month); a small always-on API usually fits near $5–10.            |
| Railway Pro                            | $20 incl. $20 usage | Team features.                                                                                                |
| Keep free + external "keep-alive" ping | $0                  | Works around sleeping but is against the spirit of free plans and unreliable; not recommended for production. |

Supabase (database/auth) is separate: the Free plan pauses inactive projects; **Pro is $25/month** and is also
needed for leaked-password protection (see P2-08) and daily backups.

**Recommendation (not actioned):** for a public launch, Render Starter ($7) at minimum, Render Standard ($25) if live
rooms are enabled, plus Supabase Pro ($25). Minimum launch total ≈ **$32/month**; comfortable ≈ **$50/month**.

**Decision needed:** which option, and when. I will not change plans or billing.

---

## P2-08 — Supabase Auth configuration and server-side password rules (proposal)

**Problem.** Auth settings live only in the Supabase dashboard (not versioned), and the 10-character password
minimum is enforced only in the browser (`apps/web/src/auth.ts:93`). Anyone calling the Auth API directly can set a
6-character password (Supabase's default minimum).

**Proposed dashboard settings (Authentication → Providers/Policies; to be applied by you or with your approval):**

| Setting                                         | Proposed value                                                      | Plan needed           |
| ----------------------------------------------- | ------------------------------------------------------------------- | --------------------- |
| Minimum password length                         | 10 (matches the app)                                                | Free                  |
| Password requirements                           | Lower + upper case + digits                                         | Free                  |
| Leaked-password protection (HaveIBeenPwned)     | On                                                                  | **Pro**               |
| Confirm email                                   | On                                                                  | Free                  |
| Secure email change (confirm both addresses)    | On                                                                  | Free                  |
| Site URL / Redirect URLs                        | Only the production web origin and the staging origin; no wildcards | Free                  |
| Auth rate limits (sign-up, sign-in, OTP, email) | Keep defaults or lower; record values                               | Free                  |
| MFA (TOTP)                                      | Enabled; already required for admins in the app                     | Free                  |
| Session: inactivity timeout / single session    | Decision (Pro feature for some options)                             | Pro for some          |
| Anonymous sign-ins                              | Off                                                                 | Free                  |
| Custom SMTP                                     | Recommended before launch (default sender is heavily rate-limited)  | Free + email provider |

**Making it reviewable:** add `docs/RENTMATE_AUTH_SETTINGS.md` (or a `supabase/config.toml` used with the Supabase
CLI) recording every value, so a change shows up in a PR. The dashboard remains the source of truth unless you adopt
the CLI.

**Server-side check in the API:** none is needed if the dashboard minimum is set, because sign-up goes straight to
Supabase Auth. If you want defence in depth, an optional Supabase "password verification" Auth Hook can refuse weak
passwords server-side (requires a Postgres function; Pro/Team availability to be confirmed).

**Staging test after the settings are applied:** call the Auth API directly (no browser) with a 6-character
password and expect a refusal; a breached password (e.g. a known-leaked one) refused when leaked-password protection
is on; email confirmation required before sign-in; a redirect to a non-allowlisted URL refused.

**Decision needed:** approve the values; decide on Supabase Pro.

---

## P2-03 follow-up — age-verification provider options (none selected)

What was implemented (`0369f63`) is a **self-declaration**: a date of birth and an "I am 18 or older" checkbox.
**It is not age or identity verification** — anyone can type a false date — and it is labelled `self_declared` in
the database. The `require_age_attestation` switch is **off**, and public launch is **not** enabled.

Options for real verification (prices as published; most need a sales quote; **nothing selected or activated**):

| Provider                                                       | Method                                                                              | Published starting price               | India fit                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| DigiLocker via a partner (Cashfree, IDfy, Setu, Signzy, Digio) | Government-issued document via consented DigiLocker share (DOB from Aadhaar/PAN/DL) | Not published; per-verification quotes | Strong; must follow Aadhaar rules (no storing Aadhaar numbers; masked data only) |
| HyperVerge                                                     | ID document + selfie liveness; India-focused                                        | Tiered, free trial                     | Strong                                                                           |
| Veriff                                                         | ID document + selfie                                                                | From ~$49/month                        | Good                                                                             |
| Persona                                                        | ID document + selfie, configurable flows                                            | From ~$250/month                       | Good                                                                             |
| Ondato                                                         | ID + liveness                                                                       | From ~$0.11 per check                  | Moderate                                                                         |
| Token of Trust                                                 | ID + age checks                                                                     | ~$25/month + $0.50 per check           | Moderate                                                                         |
| Jumio / Onfido (Entrust) / Incode / Trulioo                    | Enterprise ID + liveness                                                            | Custom pricing                         | Good, higher cost                                                                |
| Facial age estimation (e.g. Yoti, Privately)                   | Estimates age from a selfie, no document                                            | Per-check, quote                       | Useful as a first gate; not proof                                                |

**Privacy design for whichever is chosen:** store only "verified 18+: yes/no, provider, date, reference id"; never
store document images or ID numbers in RentMate; delete the reference with the account (as the attestation already
is); record consent; DPDP Act notice and a data-processing agreement with the provider.

**Decision needed:** shortlist 1–2 providers for a quote; decide whether verification is required before sign-up,
before the first booking, or for companions only. I will not sign up for, pay for or activate any provider.
