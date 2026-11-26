# Claude Code — RentMate Complete Launch Execution Brief

**Canonical repository:** `Shivaaye-Technologies/RentMate`  
**Execution branch:** create a new branch from the latest agreed integration base; never work directly on `main` or overwrite another agent's branch.  
**Priority:** deliver a reliable Android internal-testing APK and a launch-ready release candidate as quickly as safely possible.

This is the founder's consolidated execution brief. Read this file and the linked project specifications before changing code. Do not stop after producing an audit or plan: implement the work in small, tested commits and open pull requests. Do not merge, deploy production, apply production migrations, or enable live payments without explicit approval.

## 1. Start with repository and project discovery

1. Inspect all branches, open/closed PRs, GitHub Actions, CI status, recent commits and current default/deployment branches.
2. Read `README.md`, all `docs/RENTMATE*`, `docs/INDIA_LAUNCH_AND_BOOKING_SAFETY.md`, `docs/FOUNDER_APPROVALS.md`, `docs/ANDROID_COMPANIONSHIP_SOCIAL_ROADMAP.md`, token/subscription/creator-economy specifications, and all relevant migrations/tests.
3. Inspect the original Soulmate-AI-derived authentication, signup, email verification, password reset, session persistence and onboarding implementation. Treat that as the reference structure for RentMate's signup experience. Preserve working flows; adapt copy and product fields for RentMate rather than rebuilding auth unnecessarily.
4. Inspect actual Android screens and API/database capabilities. Identify mismatches between web, API and mobile. Build a feature matrix with each item marked implemented/tested, partial, missing, blocked or not approved.
5. Review PRs #11, #12, #14 and #15 and avoid conflicting work. Do not silently retarget or merge them. Coordinate branches and cherry-pick only after checking ancestry and conflicts.

## 2. Product scope — complete RentMate

Bring the Android app to parity with the approved RentMate functionality, reusing the existing Soulmate-AI structure and established theme/layout where appropriate:

- Email signup/sign-in, email verification, password reset, secure session persistence, 18+ gate and onboarding/profile completion.
- Discovery, profile details, likes/passes, matching, ordinary one-to-one chat and notifications.
- Companionship/booking discovery and creator/service listing flows with approval and verification.
- Booking creation, availability, accept/reject, reschedule, cancellation, expiry, booking detail/status, reminders, check-in and completion.
- A dedicated booking-linked chat for exactly the two booking participants, separated from ordinary match chat. Include booking system events, updates, reporting and blocking. Enforce authorization in API and RLS; never rely on UI hiding.
- LiveKit voice/video calls and live rooms, with robust call lifecycle, permissions, reconnect, timeout, teardown, background/resume and safe failure behavior.
- Wallet, subscription entitlements, token package catalogue, transaction history, booking token holds/refunds, creator pending earnings and platform commission ledger.
- Safety center, report, block, SOS, support, moderation and account controls. Safety tools remain free.
- Admin controls, audit trails, feature flags, operational kill switches and reconciliation views required by the actual implemented product.

No feature should be represented as live if its backend, authorization, provider and operational path is not complete. Avoid dead buttons and fake success states.

## 3. Booking payment model — founder decision 2026-11-26

Founder selected **Option A: members may spend RentMate tokens on approved bookings**. Implement this model as sandbox/test functionality first.

### Ledgers and accounting
Keep separate, append-only, server-authoritative ledgers for:
1. Member token wallet and token purchase credits.
2. Booking-specific token holds.
3. Refunds/reversals.
4. Creator pending booking earnings.
5. Platform commission.
6. Subscription entitlements (access rights only; not a wallet or settlement ledger).

Never mix these balances. Tokens are internal, non-transferable, non-withdrawable, non-redeemable app units. Do not convert tokens to INR or imply creators can cash out. Creator cash payouts/redemption remain disabled unless separately approved.

### Booking transaction requirements
- Calculate quote server-side from approved listing and current price; never trust client-supplied amounts.
- Validate member/creator age and identity/verification, listing approval, availability, active blocks/suspensions, city rollout, venue eligibility and booking limits at request and acceptance.
- Atomically create booking/payment attempt, snapshot quote and policy versions, reserve exact token amount and write ledger entries.
- Use idempotency keys, database transactions, row/advisory locking or equivalent concurrency control; prove concurrent attempts cannot double-spend.
- Hold tokens while awaiting acceptance and through the defined booking lifecycle.
- Rejection, expiry and eligible cancellation must release/refund by compensating ledger entries. Do not mutate historical entries.
- Successful completion requires the documented two-party confirmation and safety checks. Only then consume the hold and allocate creator share and platform commission to separate ledgers.
- Freeze settlement for disputes, safety reports, account restrictions or suspected fraud. Human review for exceptional refunds and disputes.
- Version and snapshot price, token quantity, creator share, commission, cancellation/refund policy and tax configuration. Historical records never change when admin pricing changes.
- No token-to-cash conversion, member-to-member transfer, cash withdrawal or creator payout.

### Booking chat
- Dedicated booking conversation scoped to booking ID and exactly the two authorized participants.
- Chat remains accessible for the documented pre-booking, active and post-booking support period.
- Strong RLS and server authorization, tests against cross-booking access, block/report controls, audit and privacy-aware retention.
- Ordinary match chat stays a separate domain.
- Text and booking system events first; media only with private storage, file validation, expiring URLs and moderation.

## 4. Payments and subscriptions — sandbox first

1. Inventory target distribution channels and current store policies. For Google Play Android distribution, apply the current Play Billing requirements for digital subscriptions and virtual currency. Do not route digital goods through an external checkout unless the specific policy/program explicitly permits it. Distinguish physical services from digital items.
2. Implement provider adapter boundaries, server-created purchase/order IDs, signed purchase verification, server-side receipt/token validation, authenticated webhooks, replay protection, idempotency, refunds/revocations, subscription renewal/expiry/grace handling and reconciliation.
3. Keep private keys and provider secrets server-side only. Never put service-role keys, payment secrets or LiveKit secrets in Expo public variables or the APK.
4. Build a sandbox/test path with clearly marked test products and test users. Do not charge real cards or activate live products.
5. Admin must have role-gated, audited, effective-dated controls for packages, prices, quantities, promotions, subscription terms, commission and tax configuration. Maker-checker approval for sensitive changes. Preserve immutable historical transaction snapshots.
6. Do not hardcode GST/tax rates; make them configurable only after India jurisdiction-specific professional review.
7. Keep all live payment, token purchase, booking token spend, creator redemption and payout flags fail-closed until written legal/tax, provider, store, KYC/fraud and founder launch approvals are recorded.

Existing token package planning values, if still current in source, must be verified against founder decisions and current tests before implementation. Do not invent or silently change prices, token quantities, subscriptions, limits or commission.

## 5. Safety, trust and compliance — hard requirements

- Adults 18+ only.
- Platonic companionship/social discovery only. No pornography, nudity, sexual solicitation, escorting or sexual services.
- Public venues only; no hotels or private residences.
- Free report, block and SOS; never gate safety behind tokens or subscriptions.
- No therapy/crisis-treatment claims.
- Creator/companion identity and age verification, agreements, consent and admin approval must not be bypassed.
- Booking state machine, hashed short-lived single-use OTP/QR, dual confirmation, attempt limits, replay protection, dispute and safety holds.
- City rollout is server-authoritative. Preserve currently specified excluded cities/allowlist; do not widen it without founder approval.
- Privacy/data minimization, retention and deletion rules must be documented and tested.
- No production financial enablement until written India legal/tax review, payment provider approval, app-store policy review, KYC/fraud controls and published refund/cancellation terms are complete.

## 6. Android signup and UX

- Follow the Soulmate-AI-derived signup/login/onboarding architecture and visual flow already in the repository. Do not replace with a different auth system without a compelling, documented reason.
- Ensure first-time user can install APK, sign up, verify email, sign in, complete profile/onboarding and reach the app.
- Add working booking, booking chat, wallet, subscription, token hold/refund, safety and call screens.
- All API loading/error/empty/offline states must be real. Do not display success before server confirmation.
- Check Android back navigation, keyboard/screen fit, accessibility, deep links, notification permissions, camera/microphone prompts, call interruptions, background/resume and low network.
- Keep permissions minimal; no location/contact permission unless a specific approved feature needs it.

## 7. Testing and release engineering

Run and fix all relevant:
- Format/lint/typecheck.
- API and web unit/integration tests.
- Mobile unit tests and React Native tests.
- Disposable PGlite/database migration and RLS suites.
- Rollback rehearsal.
- Auth/signup/onboarding end-to-end tests.
- Booking state machine, booking-chat isolation, wallet/hold/refund, double-spend/concurrency, commission and reconciliation tests.
- Payment sandbox purchase/webhook/subscription/refund tests.
- LiveKit/call lifecycle tests.
- Expo public config, native permission checks, Android bundle and APK build.
- Dependency/security/secret scans.

Never run unreviewed migrations against production. Use disposable database instances for migration tests. Never expose secrets in logs or artifacts.

### APK
- Resolve the Android SDK/API 37 workflow issue without downgrading `compileSdkVersion` simply to make CI pass. Confirm supported SDK package availability from the runner and use a compatible build image/SDK installation.
- Build a debug/internal-testing APK in GitHub Actions or another approved build environment. EAS quota was previously exhausted; check current quota rather than assuming.
- Verify package ID `com.shivaayetechnologies.rentmate`, app config, manifest permissions and no prohibited location/contacts/overlay permissions.
- Upload APK as a workflow artifact and provide the exact artifact/run link.
- Install on a physical Android device and test signup, email confirmation, onboarding, discovery, chat, booking, booking chat, wallet sandbox, call, permissions and app resume.
- Do not call the APK release-ready until install and smoke tests pass.

## 8. Deployment and launch gates

- Keep production Supabase, Render, payment providers, DNS and store listings untouched until explicitly approved.
- Confirm which branch/service is production-connected before any deployment.
- Prepare migrations, backup/restore and rollback plans; do not apply production migrations without explicit approval.
- Produce privacy policy, terms, community guidelines, booking terms, token/subscription terms, cancellation/refund policy, safety policy and support contact content for professional review.
- Complete store listing, screenshots, age/content declarations, data safety disclosures and test-track release checklist truthfully.
- No launch claims until all launch gates are satisfied.

## 9. Reference repositories

Use selectively, not as dependencies by default:
- https://github.com/cporter202/API-mega-list — API discovery; vet each provider for licensing, privacy, cost, uptime, terms and security.
- https://github.com/anomalyco/sst — infrastructure patterns only; do not migrate from Supabase/Render without a justified architecture proposal and approval.
- https://github.com/public-apis/public-apis — API discovery and prototypes; verify official documentation and production terms.
- Soulmate-AI-derived code already in this repository is the signup/onboarding reference.

## 10. Working protocol and definition of done

- Work independently in a new feature branch from the agreed current integration base.
- Make small coherent commits; never force-push over another agent's work.
- Do not create parallel implementations or duplicate migrations.
- Open/update draft PRs with exact changed files, migrations, tests and known risks. Keep PRs unmerged pending founder approval.
- If credentials, vendor accounts, legal review or a physical device are needed, complete all independent work and list the exact external blocker. Never fabricate credentials or claim external approvals.
- Report progress with completed items, commit/PR links, CI status, test counts, APK artifact link, remaining blockers and exact founder actions.
- Continue until all code and sandbox work is complete. Do not stop after planning.
- **Definition of done for testing APK:** installable artifact exists, CI green, package/permissions verified, signup and onboarding work, booking/chat/wallet sandbox flows pass, no secret leakage, and physical-device smoke test checklist is documented.
- **Definition of done for public launch:** additionally all legal/tax/provider/store/KYC/privacy/support approvals are recorded, production migrations/backups/release are explicitly approved, live financial flags are enabled only through authorized approval, and store review is complete.

Begin now with repository audit, then implement the highest-priority missing work. Deliver the testing APK as soon as the safe internal-testing gates pass; do not wait for live-money approval to build a non-production test APK.
