# RentMate — Earnings Platform Engineering Specification

Status: proposed engineering baseline for staging; not a production payment authorization.
Canonical repository: `Shivaaye-Technologies/RentMate`
Implementation branch: `feature/earnings-platform-foundation`
Date: 2026-11-22

## 1. Product and business rules captured

RentMate is an India-focused online services and creator platform for adults (18+) and lawful, non-sexual services. Pornography, nudity, escorting, sexual services and sexual solicitation are prohibited.

The founder's proposed commercial values are configuration inputs, not yet approved production payout instructions:

| Value | Proposed amount |
|---|---:|
| Customer token purchase price | INR 15–20 per token |
| Eligible livestream creator earning | INR 6.50 per eligible token |
| Eligible RentMate booked-service worker earning | INR 10.00 per eligible token |

The final interpretation of gross/net, GST, tax withholding, refunds, payment fees, commissions and settlement timing is supplied by the founder's lawyer, CA and banking/payment partners. Do not hard-code tax rates or assume these proposed values are net payouts.

## 2. Critical accounting distinction

Do not model a gift as a peer-to-peer token transfer.

Use separate accounting domains:

1. **Customer token liability ledger** — customer purchases/receives tokens and spends them on an eligible platform feature. The client cannot mint, edit, transfer or cash out tokens.
2. **Earner payable ledger** — an eligible server-verified event creates a payable amount denominated in INR paise for the approved creator or service provider. It is not a customer token balance.
3. **Settlement ledger** — approved payout requests, provider references, fees, configurable deductions, settlement status and reconciliation.
4. **Platform revenue ledger** — platform share and fees, kept separate from customer token liability and earner payables.

For a livestream gift, the server validates the live room, sender, recipient, gift catalogue item, moderation state, balance and idempotency key; debits/spends the customer's tokens once; and records the creator's configured INR earning as a separate payable. A replay cannot debit or credit twice.

For a booked service, earnings are created only from a server-side booking lifecycle after the required completion/acceptance and dispute-window rules are satisfied. A booking request, client-side button press or unverified webhook is not proof of completion or payment.

## 3. Proposed data model

Names are illustrative until matched to existing schema and migration conventions.

- `earning_rate_versions`: immutable, effective-dated rate snapshots; token price range, creator paise/token, service-worker paise/token, commission/deduction configuration, currency and authorizing admin.
- `earning_accounts`: earner identity, type (`studio_creator` or `service_provider`), onboarding/KYC state, payout verification state, risk status and eligibility.
- `gift_catalogue`: active gifts, token cost, display metadata and availability windows.
- `live_gift_events`: room, sender, recipient, gift, token debit, provider event reference, moderation state and unique idempotency key.
- `earner_payable_ledger`: append-only INR paise entries; source event, earner, rate version, gross amount, reversals and unique source/idempotency constraint.
- `booking_earning_events`: booking lifecycle evidence, service provider, completion/acceptance, dispute hold and earning calculation snapshot.
- `payout_requests`: requested amount, eligible balance, review state, reviewer, hold/rejection reason and immutable state transitions.
- `payout_attempts`: provider, idempotency key, external reference, request/response status metadata (never store credentials or full sensitive payloads).
- `settlement_reconciliation`: provider statement references, amount comparisons, mismatches and resolution.
- `risk_events`: structured, minimized fraud signals and actions; never store OTPs, passwords, access tokens or unnecessary identity documents in logs.

All money amounts are integer paise. All token quantities are integers. Rate snapshots are copied onto each earning event so future rate changes cannot rewrite historical earnings.

## 4. Authorization and ledger invariants

- Only trusted server-side functions can create customer-token debits/credits, payable entries or settlements.
- No mobile/web client can invoke a generic ledger-posting function with arbitrary user, amount, reason or actor.
- Every posting is idempotent and protected against concurrent requests with database uniqueness constraints and row locks.
- Ledger rows are append-only; corrections use compensating entries, never edits/deletes.
- Payable balance is derived from ledger entries and holds, not a client-supplied amount.
- A creator cannot earn from their own gift; sender/recipient must be eligible and not blocked/suspended as policy requires.
- Gift events must reference a real, authorized live session and valid participants.
- Service earnings require an eligible provider, accepted booking, completion evidence and no unresolved disqualifying dispute.
- Payout requests are bounded by verified available payable balance; concurrent requests cannot reserve the same funds.
- Provider callbacks must be authenticated, signature-verified, replay-safe and reconciled.
- Admin actions require least privilege, MFA, reason codes and audit records.
- Never expose service-role keys, payment secrets, webhook secrets or payout credentials in app bundles, logs or repository files.

## 5. Trust, verification and anti-abuse

- Phone OTP is an account access factor, not proof of legal identity or age.
- Enforce 18+ eligibility before discovery, booking, creator tools or live participation.
- Earners require an approved onboarding state and verified payout destination before payout eligibility.
- Detect OTP flooding, account farms, referral abuse, device/session anomalies, self-gifting, circular gifting, collusive booking, repeated cancellations, chargeback patterns and unusual earning velocity.
- Apply graduated controls: rate limit, step-up verification, temporary earning/payout hold, human review, appeal, then suspension/ban when substantiated.
- Do not automatically permanently ban solely from a probabilistic risk score.
- Preserve moderation/audit evidence under a defined retention policy; restrict access and log every staff access.

## 6. API and application surface

Proposed authenticated APIs (exact paths to follow existing router conventions):

- `GET /wallet`: customer token balance and recent ledger entries.
- `GET /earnings`: earner payable balance, holds, rate snapshot and history.
- `POST /live/gifts`: server validates and posts a gift atomically.
- `POST /bookings/:id/complete`: participant action/evidence routed through a booking state machine; never directly creates arbitrary payable.
- `POST /payouts`: creates a payout request only for an eligible earner with verified payout details.
- `GET /payouts`: own payout history.
- Admin-only endpoints for rate versions, review queues, holds, disputes, reconciliation and audit search.

Every route needs Zod validation, authentication, authorization, rate limits, request IDs, safe error messages and tests for horizontal privilege escalation.

## 7. Cloud reliability and operations

- Keep API and worker processes stateless; use managed database, managed object storage and managed queue/cache where needed.
- Add distinct liveness and readiness checks. Liveness confirms process health; readiness verifies required dependencies without exposing secrets.
- Add structured logs with request/correlation IDs, metrics, traces, error reporting and alert thresholds.
- Use bounded retries with exponential backoff and jitter; idempotency is mandatory before retrying writes.
- Use a durable queue/outbox for webhook processing, notifications, payout updates and cleanup jobs.
- Use database connection pooling and explicit per-request timeouts.
- Configure autoscaling only after load tests and database capacity limits are understood.
- Verify backups with restore drills, document RPO/RTO, and rehearse rollback.
- Do not use a developer phone or personal computer as a production server.
- Production deploys, production migrations, payment activation, payout activation and destructive operations require founder approval.

## 8. Delivery sequence and acceptance gates

### Phase A — staging foundation
- Reconfirm current branch, schema and migration history.
- Preserve the existing wallet as historical baseline; do not rewrite old migrations.
- Add rate-version and earning-account schema additively.
- Add tests for constraints, RLS, privileges, idempotency and concurrency.
- Keep purchase/payout provider adapters in sandbox/mock mode.

### Phase B — livestream gifts
- Gift catalogue and UI.
- Server-authorized gift endpoint.
- Atomic token spend plus earner payable accrual.
- Signed webhook deduplication and moderation checks.
- Tests: replay, concurrent gift, forged sender, forged recipient, self-gift, blocked/suspended user, stale room, insufficient balance and provider retry.

### Phase C — booking earnings
- Complete booking state machine and evidence.
- Dispute/cancellation/refund handling.
- Rate snapshot and payable accrual only after eligible completion.
- Tests for double completion, race conditions, cancellation and disputes.

### Phase D — payout operations
- KYC/payout verification adapter.
- Payout request, review, provider sandbox, callbacks and reconciliation.
- Configurable tax/fee/deduction fields; no assumed tax rates.
- Tests for duplicate payout, provider timeout, webhook replay, partial failure and reversal.

### Phase E — production readiness
- Independent security review and penetration test.
- Load and soak tests with documented targets.
- Backup restore and disaster recovery drill.
- Observability/alerting verified.
- Legal/provider credentials and founder approvals recorded.
- Production migration and deployment only after explicit approval.

## 9. Explicit non-goals for this engineering branch

- No production deployment or production database mutation.
- No live token purchase or real-money payout activation.
- No bypass of payment-provider onboarding, KYC or founder approval.
- No adult/sexual service features.
- No promise of zero downtime or unhackability; use measurable SLOs, resilience and incident response.

## 10. Current known baseline

The existing wallet migration `20261120100000_token_wallet.sql` is a foundation for a non-cash internal allowance. It currently locks purchases, deposits, member transfers, withdrawals, cash redemption and creator payouts off. Existing tests explicitly reject arbitrary client ledger writes and unapproved reason codes. This new design must be additive and must not silently remove those protections.

The current API has a basic `/health` liveness endpoint and per-IP API rate limiting. Deployment readiness documentation records that the API previously used a free plan with cold starts and that readiness checks, structured error tracking and production configuration checks remain necessary.

This document records an engineering design direction only. It is not a payment, tax, legal or production authorization.


## 11. Founder-confirmed manual payment and payout operations

The founder has specified that token deposits/purchases and creator withdrawals are to be operated manually from the admin portal. This is the required first delivery model; do not integrate automatic payment capture or automatic bank/crypto payouts in this phase.

### 11.1 Admin-managed payment methods

Only two customer token-purchase methods are in scope: **Card** and **UPI**. Do not show bank-transfer or crypto options in the member token-purchase UI.

Admins with dedicated finance-configuration permission can configure multiple active or paused payment channels:
- **Card gateway links:** one or more approved card payment gateway/provider accounts, each with a display name, provider identifier, merchant/account reference, hosted checkout URL or server-created checkout-session configuration, supported currency, environment (test/live), and active status. The member is redirected to the provider's hosted checkout. The platform must never collect, log, or store raw card numbers, CVV, PIN, or other card authentication secrets.
- **UPI:** multiple company-owned merchant UPI IDs/VPAs and linked merchant accounts, each with its own verified display name, provider/PSP, account reference, status, limits and reconciliation configuration. For every token-purchase order, generate a **fresh, unique, order-specific dynamic UPI QR** from the selected active company merchant account whenever its PSP/acquirer supports dynamic QR creation. The QR must be bound to that single order, exact server-calculated amount, merchant VPA/account, currency and unique order reference/expiry. Display the new QR to that buyer for that purchase only; do not reuse another buyer's QR or treat a static QR as a unique transaction QR. If the provider only supports static merchant QR, clearly label it as static and require the buyer's UTR/reference plus admin-side settlement verification; do not claim it is a newly generated dynamic QR. Never trust a client-edited amount or user-uploaded QR as the merchant's payment destination.

The admin portal is RentMate's **payment orchestration and reconciliation layer**, not a new card network, UPI PSP or acquiring bank. Card processing must be performed by an approved gateway/acquirer through its hosted checkout or compliant SDK/API. UPI dynamic QR issuance and automated confirmation must use an approved acquiring bank/PSP/provider integration that supports merchant dynamic QR, transaction status lookup and/or signed webhooks. A locally generated QR is only a payment instruction; it cannot confirm settlement. Do not build a homemade card processor or impersonate a PSP.

Admins must be able to self-manage multiple gateway and merchant-account connections from the portal without a developer editing code for routine onboarding: add a supported provider, enter merchant/account identifiers and credentials through a secure secret-entry flow, run a test connection, configure allowed payment methods/currencies, set limits and priority, activate/pause/disable it, rotate credentials, and remove it from new checkout routing. Provider integrations are versioned adapters; a provider not yet supported by an adapter cannot be made live merely by entering arbitrary details. Secret values are write-only after saving, encrypted server-side, never returned to the browser after submission, and never stored in plaintext database fields, mobile bundles or repository files. Removing a connection preserves historical transaction records and reconciliation evidence.

For UPI, support multiple company-owned or authorized merchant VPAs and PSP/acquirer accounts. On every token-purchase checkout, the server creates a unique pending order and asks the selected PSP/acquirer to generate a **fresh, order-specific dynamic UPI QR** bound to the exact amount, merchant account/VPA and unique order reference. Display that QR only for that checkout, with expiry and a clear order/amount summary. A new checkout gets a new QR/order reference. Route new orders across eligible configured UPI accounts using admin-configured priority, limits and health status; retain the exact account/provider snapshot on each order so later configuration changes cannot redirect an in-flight payment. If a provider supports only static QR, label it as a static/manual-verification fallback and require UTR plus admin verification; do not represent it as a fresh dynamic QR.

Only signed provider callbacks and/or server-to-server transaction-status verification can mark a UPI payment as settled. A screenshot, app redirect, client callback or QR scan is not settlement proof. If the PSP does not provide reliable confirmation, keep the request pending for manual merchant-account reconciliation before admin approval.

### 11.2 Customer token top-up request

1. The member selects a currently active method and sees its current version of instructions.
2. The member enters the requested amount and submits a transaction reference plus optional proof image. The server creates a pending request; it does not credit tokens.
3. The admin queue shows member, amount, method/version, reference, submission time and proof access under restricted permission.
4. A reviewer independently verifies settlement in the bank/provider/chain account. A screenshot or receipt alone is not proof of settlement.
5. On approval, one database transaction locks the request and member wallet, verifies pending status, records the verified received amount/currency and reviewer, creates one immutable payment-receipt record, and posts the corresponding token credit with a unique idempotency key.
6. Repeated approval, retries or duplicate transaction references cannot credit twice. Rejections require a reason and do not post tokens. Disputed/unclear payments remain on hold.
7. The member sees pending/approved/rejected status and a receipt/reference, but never sees admin-only notes or another member's data.

The token conversion rate is a versioned admin setting with effective dates. It is not editable per request by the client. The final amount credited is calculated server-side using the approved rate and explicit rounding rules.

For card checkout, create a server-side order with a unique reference and fixed amount, then create a hosted checkout session using the selected active gateway account. Verify the gateway's signed webhook (and, where needed, independently fetch the transaction status) before marking the payment as received. A browser redirect or success screen is not proof of payment. The initial manual operations mode may place verified gateway events into an admin review queue; only the authorized approval action issues tokens.

For each UPI checkout, create a pending order and payment attempt, select an active configured merchant account according to routing rules, and request a new dynamic QR from its supported PSP/acquirer API. Bind the exact amount, merchant VPA/account, expiry and unique order reference. Display the QR only in that member's matching pending order. Accept signed webhooks with signature validation, timestamp/replay checks and idempotent event processing, and use server-side status lookup where supported. A QR image is a payment instruction, not proof of payment. For static-QR fallback, collect UTR/reference and keep the order pending until an admin verifies the merchant account statement. Deduplicate by provider transaction ID or provider-scoped normalized UTR/reference; reconcile amount, currency, merchant account and order reference before approval. Route/fail over only for new attempts according to explicit admin rules; never silently change the destination for an already-issued QR. Expired, cancelled, mismatched or already-settled QR orders cannot be approved as a fresh payment.

### 11.3 Creator withdrawal request and manual release

1. An eligible creator requests a withdrawal up to the server-calculated available payable balance and chooses a verified payout destination.
2. The server reserves the amount so another request cannot reserve it again. The request enters pending review; it is not yet paid.
3. An authorized finance reviewer checks identity/payout verification, holds, disputes, fraud flags and available balance.
4. The admin manually sends the transfer outside RentMate.
5. A separate release action records the actual paid amount/currency, method, destination snapshot, external transaction reference, payment date and operator. Only then is the request marked released/paid and the settlement ledger posted.
6. If the transfer fails or is not sent, the admin records failure and releases the reservation through an audited transition. A paid request cannot be silently reopened; corrections use reversal/adjustment entries and a new reviewed action.
7. High-value or risk-flagged requests require a second authorized approver. The requester, creator, or same operator cannot self-approve their own request.

### 11.4 Admin roles and audit requirements

Separate permissions for:
- payment-method configuration;
- token top-up review and approval;
- token ledger adjustments;
- creator withdrawal review;
- manual payout release;
- rate configuration;
- audit/reconciliation read access.

A staff member may only receive the minimum permissions required. A person who configures payment instructions cannot approve their own configuration change. The creator/requester cannot approve their own withdrawal. Every state transition records actor, timestamp, reason, request ID, before/after state and correlation ID. Sensitive proof files use private storage and short-lived signed URLs; no public bucket links.

### 11.5 Required records and invariants

Additive schema should include payment-provider registry/adapters, encrypted-secret references, merchant-account configuration versions, card gateway configurations, UPI PSP/acquirer and merchant-VPA configurations, routing rules/health state, top-up orders/payment attempts, dynamic QR metadata and expiry, gateway checkout-session references, signed webhook inbox/deduplication records, verified payment receipts, withdrawal requests, payout release records and an append-only finance audit trail. Enforce uniqueness for provider-scoped gateway transaction IDs and normalized UPI UTR/reference values, while allowing documented provider-specific reference scope. Store all fiat amounts as integer minor units (INR paise); never use floating-point arithmetic for money.

A top-up approval and token ledger credit must commit atomically. A payout release and payable/settlement posting must commit atomically. Neither action may be performed by direct client table writes. The API must expose purpose-specific functions, not a generic arbitrary-amount ledger endpoint.

### 11.6 Current staging database discovery

On 2026-11-22, the connected Supabase project `RentMate-Staging-Mumbai` (`mmopqsqvoenqaedlakyc`, Mumbai) was confirmed active/healthy, but its public schema returned zero tables and its migration history returned zero entries. Therefore this project is currently an empty staging database. Do not apply a feature migration to it until the complete canonical migration chain has been reviewed and the staging bootstrap plan is prepared. No database writes were performed during this discovery.


## 12. Implementation progress — 2026-11-22

The first code slice is committed on `feature/earnings-platform-foundation`:
- `supabase/migrations/20261122100000_payment_account_registry.sql` adds an admin-only registry for multiple card and UPI merchant account metadata, routing priority, INR limits, environment, VPA and pause/disable status.
- `apps/web/src/market/PaymentAccounts.tsx` adds the admin payment-account management screen.
- `apps/web/src/market/MarketAdmin.tsx` exposes the screen only to the `admin` role.

This is deliberately a **configuration registry, not a completed live payment integration**. No credential-entry or secret-vault flow, provider connectivity test, hosted card checkout, dynamic UPI QR API, webhook verification, payment reconciliation, token-credit approval queue or payout release is implemented by this slice. Accounts remain drafts and cannot be activated from the UI. Do not describe a provider as connected or accept live payments until those later layers are implemented and tested. The migration has not been applied to staging or production.
