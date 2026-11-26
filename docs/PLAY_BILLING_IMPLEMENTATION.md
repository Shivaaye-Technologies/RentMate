# RentMate Play Billing and Payment Platform Implementation Contract

Status: implementation target for sandbox/internal testing. This document does not authorize live charges, live token sales, booking settlement, creator redemption, or payouts.

## 1. Product classification

- **RentMate digital subscription:** Google Play subscription product for Play-distributed Android builds, unless a documented, enrolled alternative billing programme applies. Release gate: Play Console product, backend verification, renewal/revocation handling.
- **RentMate token package:** Google Play one-time digital product for Play-distributed Android builds, unless a documented, enrolled alternative billing programme applies. Release gate: product configuration, backend purchase verification, one-time purchase lifecycle.
- **Token spend on approved RentMate booking:** Internal token ledger operation; no INR conversion and no cash settlement. Release gate: founder-selected sandbox implementation; live spend remains gated by legal, tax, store and provider approvals.
- **Physical-world service payment:** Separate classification and payment flow; do not conflate with digital token purchase. Release gate: product/legal review and approved provider.
- **Creator earnings:** Internal pending token-denominated accounting only. Release gate: no cash-out, redemption or transfer enabled.

The Android app must not offer an external checkout for digital tokens or subscriptions merely because an external gateway is convenient. Any alternative billing route requires a documented current Google Play programme, enrolment and compliance review for the exact product and region.

## 2. Android purchase lifecycle

Use a native in-app purchase library compatible with the project's exact Expo SDK 58 / React Native 0.88.1 toolchain. Expo's current IAP guidance identifies `expo-iap` as an option for custom development builds; Expo Go is not sufficient. Before adding it, verify the current release's Expo Modules, Kotlin, Gradle, Android Billing Library and config-plugin compatibility against SDK 58. Do not copy Kotlin settings from a different Expo SDK without validating the complete toolchain.

Client responsibilities:

- Query products from the store; do not hardcode prices as authoritative.
- Display store-returned localized price, currency and billing period.
- Start the native Play purchase flow only for an authenticated member.
- Attach an opaque, server-issued account correlation identifier where supported; never attach personal data.
- Handle purchased, pending, cancelled, failed, restored and unknown states distinctly.
- Send the purchase token and product identifier to the authenticated server over TLS.
- Do not grant tokens or subscription features from client state, local receipts, screenshots, callbacks or client clocks.
- Complete/acknowledge/consume purchases only according to the verified server result and the store's required lifecycle.
- On app start/resume, query owned purchases and reconcile with the backend.
- Never log purchase tokens or sensitive receipt data.

## 3. Server purchase verification

Create a provider-neutral purchase domain with a Google Play adapter. The API must:

1. Authenticate the member and rate-limit purchase verification.
2. Validate strict request schema, product allowlist, package name and expected product type.
3. Verify the purchase token with the Google Play Developer API using a server-only service account credential.
4. Confirm package name, product ID/base plan/offer, purchase state, quantity, account binding, purchase time and relevant order identity.
5. Reject pending, cancelled, refunded, revoked, already-consumed or mismatched purchases as appropriate.
6. Bind each store purchase token to exactly one internal member and unique transaction record. Prevent cross-account reuse and replay.
7. Use a DB transaction and unique constraints/idempotency to grant the exact catalog entitlement at most once.
8. Preserve raw provider identifiers securely and minimize sensitive receipt retention.
9. Acknowledge/consume only after backend verification and durable entitlement grant, using a retry-safe worker/outbox.
10. Return the authoritative entitlement/wallet snapshot. Client must refresh from server.

A repeated verification request for the same verified purchase must return the prior result without granting tokens or extending subscription twice. A token associated with a different member must be rejected and escalated for review.

## 4. Data model and ledger boundaries

Use separate records/tables (or existing equivalent) for:

- Store products/catalogue and effective-dated admin price configuration.
- Purchase attempts/orders and store purchase token fingerprints.
- Verified one-time purchases.
- Subscription purchase identity and current entitlement projection.
- Immutable wallet ledger entries.
- Booking token holds and compensating refund/reversal entries.
- Creator pending-earnings and platform-commission ledgers.

Do not duplicate an existing table or ledger. Audit the current schema before writing migrations. Store purchase token values encrypted or otherwise protected at rest if they must be retained; never expose them through client-readable RLS. Store a one-way fingerprint for uniqueness and log correlation where possible.

Never mutate historical purchase, token or commission rows. Corrections use append-only compensating records. A wallet credit must reference one verified provider transaction and one idempotency key. A subscription entitlement must be derived from verified store state, not a client-selected plan or admin UI toggle.

## 5. Subscription state and Google notifications

Implement a subscription state projection that can represent at minimum:
- pending purchase (no entitlement)
- active
- grace period (only if confirmed by verified Play state and product policy)
- account hold / paused / suspended
- cancelled but active until expiry
- expired
- revoked / refunded

Receive Google Play Real-time Developer Notifications through a secure Pub/Sub push or pull consumer. Treat the notification as a signal, not as authoritative complete purchase state. Fetch the latest purchase/subscription state from the Google Play Developer API before changing entitlements. Deduplicate Pub/Sub message IDs and store event processing state. Handle out-of-order and repeated messages safely.

For one-time token purchases, process purchase lifecycle notifications and voided/refund events. A refund or revocation must create an auditable compensating ledger operation and prevent the refunded purchase from granting tokens again. If the purchased tokens have already been spent, do not silently drive wallet balance negative; apply the documented debt/fraud/manual-review policy and preserve full audit history.

## 6. External gateway adapter — later credential stage

Define a provider interface for a future external gateway, but do not enable it now. Adapter contract must cover:

- Create order with server-generated amount/currency/reference.
- Verify provider signature over the exact documented payload.
- Verify webhook signature and timestamp/replay window.
- Fetch authoritative payment status server-to-server.
- Idempotent success/failure/refund/reversal events.
- Refund request/status and reconciliation.
- Health/configuration status without revealing secrets.

Never trust the client to set amount, currency, order status, token quantity, subscription status, creator share or commission. Never accept a screenshot or browser redirect as proof of payment. Secrets stay in server environment variables/secret manager and are excluded from logs, mobile bundles and source control.

Gateway credentials will be supplied by the founder later through secure deployment configuration. Do not ask for or commit credentials in GitHub.

## 7. Admin pricing and audit

Admin controls must be role-gated and use maker-checker approval for high-impact changes:

- Store product ID and product type mapping.
- Internal token quantity and bonus.
- Effective date/time and expiry.
- Subscription entitlement mapping and duration derived from store product.
- Booking token quote rules and creator/platform split.
- Tax configuration only after jurisdiction-specific professional review.

Store snapshots on every purchase and booking. Do not rewrite past transactions when current prices, packages, tax settings or commission rules change. Never hardcode a presumed GST rate.

## 8. Required test matrix

- Valid one-time purchase credits exact quantity once.
- Replayed token grants no additional credit.
- Purchase token cannot be reused by another member.
- Product/package mismatch rejected.
- Pending purchase grants nothing.
- Cancelled/failed purchase grants nothing.
- Refund/voided purchase is reconciled and audited.
- Already-consumed/refunded/revoked token is not credited.
- Duplicate and out-of-order RTDN messages are safe.
- Subscription renewal extends only after verified Play state.
- Cancellation preserves access only through verified expiry.
- Grace period, hold, pause, revoke and expiry match verified state.
- Acknowledge/consume retry is safe and cannot double-credit.
- Provider outage does not grant entitlement and supports retry.
- Client cannot write wallet, purchase or entitlement rows through RLS.
- Purchase tokens/secrets do not appear in logs, analytics, crash reports or APK.
- Price/package changes do not alter historical purchase snapshots.
- Booking hold/refund ledger remains separate from purchase credit and subscription entitlement.
- All payment paths fail closed if product/provider config or verification credentials are missing.

Use mocked Google API responses for deterministic CI, plus Google Play license testers/internal test track for end-to-end verification. Do not use live charges during implementation.

## 9. Release gates

Before internal testing:

- Native IAP dependency and config plugin pass SDK 58 clean prebuild and Android build.
- Google Play test products and license testers are configured in Play Console.
- Backend sandbox/test verification is exercised with store test purchases.
- APK package ID and signing are verified.
- CI, security scans, RLS and purchase lifecycle tests pass.

Before public launch:

- Play Console products, billing setup, tax/banking/business verification and store review are complete.
- Google Play Billing policy and any applicable India alternative billing programme are reviewed for the actual product and region.
- India legal/tax review, refund/cancellation terms, privacy disclosures, support and fraud processes are approved.
- Production service account and Pub/Sub permissions are configured server-side.
- Founder explicitly approves production migration and financial activation.

No live money movement is enabled by this document.
