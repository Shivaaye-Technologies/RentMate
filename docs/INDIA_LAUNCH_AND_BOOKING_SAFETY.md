# RentMate India rollout and booking safety specification

Status: proposed implementation baseline — not a legal opinion, payment-provider approval, or production enablement.
Target: Android-first India rollout. Initial expansion excludes Delhi and Bengaluru; both remain disabled in launch configuration until separately approved.

## 1. Non-negotiable product boundaries

- Adults 18+ only. Preserve the existing server-side age declaration/verification gates.
- Strictly platonic social discovery and public-venue meetups. No escorting, sexual services, nudity, pornography, or sexual solicitation.
- Public venues only. Do not accept hotels, private residences, or other private meeting locations as booking venues.
- Report, block, SOS, and essential safety tools remain free and available without tokens or subscription.
- Do not describe the product as therapy, crisis treatment, or a guaranteed personal-safety service.
- Creator streaming continues to use the existing Creator Studio age/identity verification, agreement, consent, and approval flow. No alternate approval path.

## 2. Separate ledgers and monetisation boundaries

Keep these domains separate in schema, APIs, admin permissions, and reconciliation:

1. Subscription entitlements: access rights only; no token balance or booking settlement stored here.
2. Viewer token wallet: app-only virtual units. Tokens are not cash, are not withdrawable, and cannot be transferred or converted to booking funds.
3. Creator earnings ledger: separate pending/approved/payable/paid/reversed accounting for eligible gifts. Redeemable payouts remain disabled until written legal/tax review, KYC/fraud controls, and provider approval.
4. Booking settlement: if enabled in a later phase, INR payment-provider settlement only. Never simulate escrow in RentMate's ordinary operating account and never convert viewer tokens into booking funds.

All ledger mutations must be append-only or represented by compensating entries. Keep immutable transaction snapshots of SKU, price, token quantity, commission, tax configuration version, and effective time. Admin pricing/tax changes are effective-dated, role-gated, maker-checker approved, and audited; never rewrite historical transactions.

## 3. Booking lifecycle

Proposed state machine:

`REQUESTED -> ACCEPTED -> READY_TO_MEET -> ARRIVED_BOTH -> SERVICE_STARTED -> COMPLETED`

Terminal/exception states: `CANCELLED`, `EXPIRED`, `DISPUTED`, `SAFETY_HOLD`.

Rules:
- Re-check both accounts' age/verification status, active blocks, suspensions, booking limits, and venue eligibility on request and again on acceptance/check-in.
- A block, suspension, safety report, or account restriction prevents new acceptance and can put an existing booking into a review/cancellation path.
- Arrival is not completion. A single party's OTP is not sufficient proof of mutual completion.
- Use booking-scoped, short-lived, single-use QR/OTP challenges. Store only a secure hash; bind challenge to booking, participant, action, and expiry; enforce attempt limits and idempotency.
- Require independent confirmation from both participants for arrival. Completion requires the explicit completion flow defined in approved terms; never infer it from GPS or elapsed time.
- GPS is optional risk context, not proof. Account for permission denial, spoofing, low accuracy, and privacy. Never expose precise live location to the other participant by default.
- Safety concerns freeze any future provider settlement and route to human review. No automatic release based only on one participant's claim.
- Cancellation, late arrival, no-show, refund, and dispute windows must be explicit in product terms and implemented consistently before money is accepted.

## 4. Autonomous operations with human controls

May be automated after tests:
- Booking reminders, expiry of unused OTP/QR challenges, stale-request expiry, duplicate-request prevention.
- Re-check of blocks/suspensions/venue status at each state transition.
- Rate limits, suspicious-attempt flags, ledger reconciliation reports, and retry queues with idempotency.
- City feature-flag evaluation and operational dashboards.

Must require a human or explicit authorized approval:
- Safety incidents, disputed arrival/completion, fraud decisions with material impact, refunds outside deterministic policy, creator payouts, chargebacks, legal/tax changes, and any emergency-stop reset.
- Automation must fail closed if policy/configuration is missing, stale, or contradictory. Keep an immutable audit trail and a manual override with reason and actor.

## 5. City rollout configuration

- Central, server-authoritative city allowlist/denylist with effective dates and audit history.
- Initial all-India expansion: Delhi and Bengaluru disabled; only explicitly approved pilot cities enabled.
- Never rely on client-side city filtering as the access control. Every discovery, booking, venue, and settlement API must check the server-side rollout policy.
- City configuration changes require maker-checker approval and a rollback path.
- Add a per-city kill switch for bookings and a global kill switch for all bookings.

## 6. Android application requirements

Before enabling booking flows:
- Add a Booking Safety screen explaining public-place-only meetups, verification, OTP/QR steps, cancellation/dispute handling, and emergency options.
- Add accessible booking status, expiry countdown, and clear action confirmations; never display a success state before the API confirms it.
- Add Report, Block, and SOS entry points from booking details and live interactions; all remain free.
- Show privacy permission prompts only when needed; provide a non-GPS fallback.
- Handle offline, retry, duplicate taps, expired codes, account restriction, and API outage states safely.
- Keep payment, creator cash-out, and booking settlement UI hidden/disabled while backend legal/provider gates are false.
- Preserve Android secure session storage, deep links, permission minimization, and no cleartext traffic.

## 7. Release gates

1. Database/API state-machine tests: invalid transitions, race conditions, replayed OTPs, expiry, rate limits, idempotency, block/suspension changes, and audit records.
2. Security review: RLS, authorization, challenge hashing, enumeration resistance, location privacy, webhook authenticity, and secrets.
3. Android tests: typecheck, unit tests, Expo config, native config, Android bundle, and real-device testing for permissions, deep links, background/resume, and poor networks.
4. Operational rehearsal: incident escalation, manual dispute resolution, reconciliation, backups, and kill switches.
5. Written India legal/tax review and written payment-provider approval for the exact booking/creator settlement model before any real-money feature is enabled.
6. Store policy review against the actual shipped app and payment flows.

## 8. Implementation order

- P0: audit current booking/companionship schema, API, RLS, Android screens, and existing safety/report/block/SOS paths. Do not duplicate existing controls.
- P1: implement city rollout policy and booking state machine server-side, with migration tests.
- P2: implement hashed OTP/QR challenges, dual confirmation, expiry, replay protection, and dispute/safety holds.
- P3: integrate Android booking and safety screens with server-authoritative transitions.
- P4: add autonomous reminders/expiry/reconciliation and human escalation.
- P5: complete legal/provider gates, pilot checklist, and staged city enablement.

No production money movement is enabled by this specification.