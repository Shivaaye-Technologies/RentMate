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
- Dark design system: black/charcoal, champagne gold, white type; Cormorant Garamond display font.
- Landing page: Online / Physical / Hybrid pillars with honest availability, 18+ and no-sexual-services rule.
- Legal pages re-themed; API info name "RentMate API" (service id unchanged).
- Tests: brand tests added; e2e title updated.
