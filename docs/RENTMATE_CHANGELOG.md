# RentMate — Changelog

## 2026-11-18 — Phase 0 and Phase 1 (branch `rentmate-migration`, not deployed)

### Phase 0 — audit

- Audited Soulmate-AI (monorepo, Supabase project `soulmate-ai`, Render services, LiveKit adapter) and the RentMate
  starter repo (README only — nothing to merge).
- Production DB: 12 migrations applied, RLS on all public tables; PR #9 and live migrations not applied.
- Gap analysis and roadmap: `RENTMATE_FEATURE_MATRIX.md`. Founder decisions: `FOUNDER_APPROVALS.md`.
- Blocker: GitHub reports the repository owner account as suspended.

### Integration (`e97a367`)

- `rentmate-migration` created from `main` and merged with PR #9 (full dating experience) and SOULMATE LIVE 1–3
  (foundation, creator portal, admin console). Conflicts resolved by keeping both sides.

### Phase 1 — brand (`2abd05c`)

- RentMate name, tagline "Meet. Connect. Experience.", RM monogram (component, favicon, headers).
- Design system: black/charcoal, champagne gold, white type (replaced the same day by light/dark monochrome, below).
- Landing page: Online / Physical / Hybrid pillars with honest availability, 18+ and no-sexual-services rule.
- Legal pages re-themed; API info name "RentMate API" (service id unchanged).
- Tests: brand tests added; e2e title updated.

### Theme change (founder request: no gold, light and dark)

- Gold removed. Monochrome design system with a light theme (default) and a dark theme.
- Follows the device setting; members can pick System / Light / Dark on the landing page and in Profile → Appearance.
  The choice is saved on the device and applied before first paint (no flash); legal pages follow it too.
- RM monogram and favicon invert with the theme.
- Tests: light/dark token and no-gold checks, theme switch tests (incl. blocked storage); browser check of both themes.

### No adult content + GitHub policy guard

- Founder decision: RentMate supports no porn or adult/sexually explicit content, in any country.
- Migration `20261118090000_no_adult_content` (additive, deletes nothing): adult category kept but permanently
  unavailable; no country can enable adult content; creators, streams and private sessions reject adult or unknown
  categories. New DB test `no_adult_content.sql` (16 checks); live tests updated to the stricter rule.
- App: the adult category is no longer offered; admin country settings show it as not supported.
- `scripts/policy-check.mjs` (`npm run test:policy`) added to `npm run check` and CI: blocks secrets, `.env` files,
  media files, oversized files and adult wording.
