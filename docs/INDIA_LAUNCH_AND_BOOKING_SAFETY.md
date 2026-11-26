# RentMate India rollout and booking safety specification

Status: founder-selected product design for implementation and sandbox testing; not a legal opinion, payment-provider approval, production enablement, or authorization to collect live money.
Target: Android-first India rollout. Initial expansion excludes Delhi and Bengaluru; both remain disabled in launch configuration until separately approved.

## 1. Non-negotiable product boundaries

- Adults 18+ only. Preserve the existing server-side age declaration/verification gates.
- Strictly platonic social discovery and public-venue meetups. No escorting, sexual services, nudity, pornography, or sexual solicitation.
- Public venues only. Do not accept hotels, private residences, or other private meeting locations as booking venues.
- Report, block, SOS, and essential safety tools remain free and available without tokens or subscription.
- Do not describe the product as therapy, crisis treatment, or a guaranteed personal-safety service.
- Creator streaming continues to use the existing Creator Studio age/identity verification, agreement, consent, and approval flow. No alternate approval path.
- Token-funded booking is a product feature selection for implementation/testing only. It does not override the legal, provider, store, tax, verification, or rollout gates below.

## 2. Separate ledgers and token-funded booking model

Keep these domains separate in schema, APIs, admin permissions, and reconciliation:

1. **Subscription entitlements:** access rights only. Subscription status must not be treated as a wallet balance, booking payment, or creator earning.
2. **Member token wallet:** app-only virtual units purchased through an approved in-app billing flow or otherwise legitimately credited. Tokens are non-transferable between members, non-withdrawable, non-redeemable for cash, and cannot be converted to INR or used outside RentMate.
3. **Booking token holds:** when a member confirms a token-priced booking, atomically reserve the quoted token amount from the member's available balance into a booking-specific hold. A hold is not a completed payment or creator earning. Enforce one hold per booking/payment attempt with idempotency and prevent double-spend.
4. **Creator booking earnings ledger:** after the booking reaches the approved completion state, allocate the creator's share as a separate, append-only pending creator-earnings entry, denominated in tokens/units and linked to the booking, pricing snapshot, and commission calculation. This ledger is not the member wallet; creators cannot transfer, withdraw, redeem, or cash out these entries. Payout/redemption remains disabled pending separate written legal, tax, KYC/fraud, store and provider approval.
5. **Platform commission ledger:** record the platform's commission separately from the creator share, with booking ID, gross token amount, commission rule/version, creator share, and effective time. Never derive historical entries from today's commission setting.
6. **Refund/reversal ledger:** refunds and corrections are append-only compensating entries. Never edit or delete the original wallet, hold, creator-earning, or commission transaction.
7. **Optional INR booking payments:** not part of this token-funded booking selection. Do not add a second booking payment method or silently convert token value into INR. Any future INR checkout requires a separately approved product decision and provider/legal review.

All ledger mutations must be server-authoritative, append-only or represented by compensating entries, transactional, idempotent, and concurrency-safe. Keep immutable snapshots of token price/package, token quantity, booking quote, creator share, platform commission, cancellation/refund policy version, tax configuration version (where legally reviewed), and effective time. Admin pricing/tax/commission changes are effective-dated, role-gated, maker-checker approved, and audited; never rewrite historical transactions.

### Booking payment and settlement rules

- The server calculates the booking price from the active approved service listing and availability. Never trust a client-supplied amount, creator share, commission, or wallet balance.
- Before creating a hold, re-check member and creator eligibility, 18+ status, required identity/age verification, listing approval, active blocks/suspensions, booking city rollout, venue eligibility, schedule overlap, and booking policy.
- In one database transaction: create the booking/payment attempt, snapshot the quote and policy versions, reserve the exact token amount, and write the matching append-only ledger entries. If any step fails, the entire transaction rolls back.
- The member sees the booking as awaiting creator acceptance while tokens are held. If the creator rejects, the request expires, the member cancels within the allowed window, or the booking is cancelled under the published policy, release/refund the hold through a compensating ledger entry.
- On successful dual-party completion and after the dispute/safety checks, consume the hold and allocate the creator share and platform commission to their separate ledgers. Do not allocate earnings merely because a booking was accepted, a timer elapsed, or one party claims completion.
- If either party reports a safety issue, a block/suspension is applied, or a dispute is opened, freeze settlement and route it to human review. Do not automatically release creator earnings.
- Define cancellation, late arrival, no-show, expiry, partial/full refund, dispute windows and support escalation in user-facing terms before any live booking token spend is enabled.
- A refund returns the eligible token amount to the member wallet using a new compensating transaction. It does not mint cash, create a cash-equivalent payout, or debit unrelated members.
- Token-funded bookings do not create a promise of cash compensation to creators. Any future creator cash payout is a separate regulated financial product and remains disabled.

## 3. Booking lifecycle

Proposed state machine:

`REQUESTED -> TOKEN_HELD -> ACCEPTED -> READY_TO_MEET -> ARRIVED_BOTH -> SERVICE_STARTED -> COMPLETED`

Terminal/exception states: `REJECTED`, `CANCELLED`, `EXPIRED`, `REFUNDED`, `DISPUTED`, `SAFETY_HOLD`.

Rules:
- Re-check both accounts' age/verification status, active blocks, suspensions, booking limits, and venue eligibility on request and again on acceptance/check-in.
- A block, suspension, safety report, or account restriction prevents new acceptance and can put an existing booking into a review/cancellation path.
- Arrival is not completion. A single party's OTP is not sufficient proof of mutual completion.
- Use booking-scoped, short-lived, single-use QR/OTP challenges. Store only a secure hash; bind challenge to booking, participant, action, and expiry; enforce attempt limits and idempotency.
- Require independent confirmation from both participants for arrival. Completion requires the explicit completion flow defined in approved terms; never infer it from GPS or elapsed time.
- GPS is optional risk context, not proof. Account for permission denial, spoofing, low accuracy, and privacy. Never expose precise live location to the other participant by default.
- Safety concerns freeze any pending creator allocation and route to human review. No automatic release based only on one participant's claim.
- Cancellation, late arrival, no-show, refund, and dispute windows must be explicit in product terms and implemented consistently before token spending is enabled for real users.

## 4. Booking-linked chat and safety

- Each booking has a participant-scoped conversation linked by booking ID, available to the booking member and the assigned creator/companion only.
- Booking chat opens when the booking request is created and remains available for the documented pre-booking, active-booking, and post-booking support period. Define retention and evidence-preservation rules consistently with privacy and legal review.
- Enforce participant authorization server-side and with database row-level security. Never expose one booking's messages to another booking, unrelated matches, or other creators.
- Keep ordinary match chat separate; do not silently merge booking conversations into dating matches or grant access based only on a profile ID.
- Booking chat supports text, booking status/system events, venue and schedule updates, and report/block actions. Any media attachments must use private storage, strict type/size checks, short-lived access URLs, and moderation controls.
- Report, block and SOS remain free. Blocking prevents new booking requests and routes existing bookings to a safe cancellation/review flow without exposing private details.
- Retain only the minimum records required for support, safety investigations, disputes and applicable law; document retention, access controls, deletion exceptions and audit access.

## 5. Autonomous operations with human controls

May be automated after tests:
- Booking reminders, expiry of unused OTP/QR challenges, stale-request expiry, duplicate-request prevention.
- Re-check of blocks/suspensions/venue status at each state transition.
- Rate limits, suspicious-attempt flags, ledger reconciliation reports, and retry queues with idempotency.
- City feature-flag evaluation and operational dashboards.
- Deterministic release/refund of token holds only when a published policy condition is unambiguously met and the database transaction can be completed atomically.

Must require a human or explicit authorized approval:
- Safety incidents, disputed arrival/completion, fraud decisions with material impact, refunds outside deterministic policy, creator cash payouts, chargebacks, legal/tax changes, commission changes, and any emergency-stop reset.
- Automation must fail closed if policy/configuration is missing, stale, or contradictory. Keep an immutable audit trail and a manual override with reason and actor.

## 6. City rollout configuration

- Central, server-authoritative city allowlist/denylist with effective dates and audit history.
- Initial all-India expansion: Delhi and Bengaluru disabled; only explicitly approved pilot cities enabled.
- Never rely on client-side city filtering as the access control. Every discovery, booking, venue, and settlement API must check the server-side rollout policy.
- City configuration changes require maker-checker approval and a rollback path.
- Add a per-city kill switch for bookings and a global kill switch for all bookings.

## 7. Android application requirements

Before enabling booking flows:
- Add a Booking Safety screen explaining public-place-only meetups, verification, token hold/release/refund, OTP/QR steps, cancellation/dispute handling, and emergency options.
- Add accessible booking status, token quote and hold status, expiry countdown, and clear action confirmations; never display a success state before the API confirms it.
- Add booking-specific chat with participant-only authorization, booking status events, report/block/SOS entry points, and safe handling of account restrictions.
- Add Report, Block, and SOS entry points from booking details and live interactions; all remain free.
- Show privacy permission prompts only when needed; provide a non-GPS fallback.
- Handle offline, retry, duplicate taps, expired codes, account restriction, and API outage states safely. Never retry a token debit with a new idempotency key after an uncertain response.
- Show token balance, booking quote, exact held amount, refund eligibility and ledger history clearly. Do not describe tokens as cash or imply creator cash payouts.
- Keep live billing, creator cash-out, and booking token spend disabled while backend legal/provider/store gates are false. Sandbox purchases and test-token flows must be clearly marked as test-only.
- Preserve Android secure session storage, deep links, permission minimization, and no cleartext traffic.

## 8. Release gates

1. Database/API state-machine tests: invalid transitions, race conditions, replayed OTPs, expiry, rate limits, idempotency, concurrent wallet spend, duplicate booking attempts, partial transaction rollback, refunds, cancellation, dispute freezes, commission snapshots, and booking-chat isolation/RLS.
2. Security review: RLS, authorization, challenge hashing, enumeration resistance, location privacy, billing signature/webhook authenticity, replay protection, reconciliation, and secrets.
3. Android tests: typecheck, unit tests, Expo config, native config, Android bundle, and real-device testing for signup/login, email confirmation, onboarding, booking, booking-linked chat, wallet, payment sandbox, permissions, deep links, background/resume, and poor networks.
4. Operational rehearsal: incident escalation, manual dispute resolution, token hold/refund reconciliation, backups, and kill switches.
5. Written India legal/tax review and written payment-provider and app-store approval for the exact token sale, token-funded booking, creator-earnings and any future payout model before any live real-money feature is enabled.
6. Store policy review against the actual shipped app and payment flows. Digital token purchases in Play-distributed Android builds must use the billing method required by current Google Play policy; do not assume an external gateway is permitted for digital goods.
7. Physical Android device smoke test and a signed internal testing APK before broader rollout.

## 9. Implementation order

- P0: audit current booking/companionship schema, API, RLS, Android screens, wallet, payment registry, and existing safety/report/block/SOS paths. Do not duplicate existing controls.
- P1: implement city rollout policy and booking state machine server-side, with migration tests.
- P2: implement transactional token holds, single-use hashed OTP/QR challenges, dual confirmation, expiry, replay protection, refunds, and dispute/safety holds.
- P3: implement booking-scoped chat and strict participant-only message access.
- P4: implement separate creator pending-earnings and platform commission ledgers with immutable booking/commission snapshots; keep redemption and payouts disabled.
- P5: connect Android signup/onboarding, bookings, booking chat, wallet and billing sandbox to server-authoritative APIs.
- P6: add autonomous reminders/expiry/reconciliation and human escalation.
- P7: complete legal/provider/store gates, pilot checklist, signed testing APK, and staged city enablement.

No production money movement, live token sales, creator redemption, or creator cash payout is enabled by this specification.
