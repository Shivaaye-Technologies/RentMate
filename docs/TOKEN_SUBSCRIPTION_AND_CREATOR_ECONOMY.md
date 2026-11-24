# RentMate Token, Subscription, Calls, Gifts and Booking Economy

Status: founder-provided product proposal captured for implementation. This document does not enable real-money collection, creator redemption, or booking settlement. All money-moving capabilities remain disabled until legal, tax, payment-provider and Google Play gates are satisfied.

## 1. Product access tiers

### Free member
- 15 likes per rolling 24 hours.
- 15 dislikes/passes per rolling 24 hours.
- 3 rewinds per rolling 24 hours.
- Chat is available without a token charge, subject to match/conversation rules and abuse limits.
- Voice calls: 1 token per connected second.
- Video calls: 5 tokens per connected second.
- Live-room viewing is available subject to room capacity and moderation.
- May send approved virtual gifts using tokens.
- Booking requires the booking-token amount displayed by the listing creator and confirmed by the buyer.

### Monthly subscriber
- Unlimited likes and dislikes, subject to anti-abuse and safety limits.
- Unlimited rewinds.
- View who liked them.
- Unlimited in-app messages, subject to safety controls.
- Unlimited voice calls with no token deduction.
- Video calls remain token-metered at 5 tokens per connected second.
- Live-room viewing and gifting remain available; gifts still consume tokens.
- Booking still requires the creator's displayed booking-token price. Subscription does not include booking tokens or waive booking requirements.

Subscriptions and token balances are separate products and ledgers. Subscription expiry removes subscriber entitlements but never changes token balances or historical transactions.

## 2. Token purchase and pricing configuration

- Token packages are discrete, server-defined SKUs, not client-calculated prices.
- Hard purchase cap: a member may buy at most 500 tokens in one purchase transaction. No SKU, bonus, retry, split checkout or client request may bypass the 500-token per-transaction cap. The wallet may retain an existing balance; this cap limits each purchase, not the total wallet balance. Any cumulative daily/monthly purchase limit is a separate future policy decision.
- Each SKU snapshots INR price, token quantity, bonus quantity, effective date, tax configuration version, store product ID, and eligibility.
- No client can mint, edit, transfer or cash-redeem tokens.
- Package prices and token quantities must be displayed before purchase and match the billing provider's price. Enforce the 500-token maximum on both API and database/provider order validation, not only in the Android UI.
- Pricing is configurable by an authorized admin with maker-checker approval and immutable audit history.
- Founder-approved pricing curve: small packs start at ₹20 per token; larger packs receive progressively lower per-token prices, reaching ₹15 at the maximum 500-token tier.
- Illustrative tier schedule for admin configuration review (not live/purchasable SKUs): 50 tokens ₹1,000 (₹20/token); 100 tokens ₹1,800 (₹18/token); 250 tokens ₹4,250 (₹17/token); 500 tokens ₹7,500 (₹15/token). No package or single purchase may exceed 500 tokens. Exact package quantities, tax display, bonus tokens and final totals require admin approval and store/provider validation before publication.
- The published per-token price must be mathematically consistent with the SKU total and clearly disclosed. Do not advertise a bonus as a price discount or calculate the effective rate ambiguously.
- Historical purchases retain their original price and quantity; later changes never rewrite prior records.

## 3. Creator-controlled booking price

- Any eligible approved creator, regardless of gender, may set a booking price from 500 to 1,000 tokens per approved booking/service slot.
- The buyer sees the creator, service, public venue, time, token amount and applicable terms before confirming.
- The server validates the configured range and snapshots the accepted token price on the booking.
- No gender-based price, fee, eligibility, or payout discrimination is introduced.
- Booking token spending is separate from subscription and live-gift spending.
- Token deductions, creator payable accounting, refunds and disputes must use separate append-only ledgers and idempotent server-side operations.
- Booking tokens must not be represented as INR escrow. Any INR settlement or creator redemption requires separate provider-supported settlement and written legal/tax approval.

## 4. Live virtual gifts

- Only approved, non-explicit gift SKUs may be sent.
- Each gift SKU has an admin-controlled token price, display asset, availability and effective date.
- Sending a gift debits the viewer token wallet exactly once; duplicate retries cannot double-charge.
- Creator earnings are recorded in a separate creator-payable ledger, not as transferable viewer tokens.
- Proposed creator economics from the founder: ₹6–₹7 equivalent per eligible gift token, subject to a finalized commission, tax and settlement model.
- Earnings remain pending until moderation, fraud, chargeback and eligibility checks complete.
- Cash redemption/payout remains disabled until written legal/tax review, KYC, payment-provider approval, and Play policy classification are complete.
- No gift may unlock nudity, sexual content, prohibited content, or unapproved creator privileges.

## 5. Call metering

- Free member voice: 1 token per connected second.
- Free member video: 5 tokens per connected second.
- Subscriber voice: unlimited, no token debit.
- Subscriber video: 5 tokens per connected second.
- Charge only the verified overlap when both participants are connected, using signed LiveKit webhook presence; never use the device clock as the billing source.
- Ringing, unanswered, declined, failed-before-connect and disconnected time are not billable.
- Check balance before connecting and end or downgrade safely when the balance is exhausted. Notify both participants before the call begins and while approaching the balance limit.
- Use a unique call settlement key; retries and webhook replays cannot charge twice.
- The call screen must show the applicable rate before a call is placed.

## 6. Safety and fairness

- The same product rules apply to male and female users. No gender-specific price or token charge.
- Free chat, report, block, SOS and essential safety controls are not token-gated.
- Free allowance limits are rolling 24-hour server-side limits; subscription entitlements bypass only the specified product limits, never abuse/safety limits.
- All likes, dislikes, rewinds, messages, calls, gifts and booking state changes are authenticated and server-authoritative.
- No client clock or client-provided price can determine entitlement or charges.
- Adult-only, strictly platonic positioning; no escorting, sexual services, pornography or nudity.
- Creator streaming retains the existing Creator Studio identity/age verification, agreement, consent and approval gates.

## 7. Required backend design

- subscription_entitlements: provider purchase identity, plan, start/end, status, source, verification timestamps; no client writes.
- token_packages and immutable purchase snapshots: admin-managed SKUs and store identifiers.
- token_ledger: extend only through reviewed migration and server functions for approved gift/call/booking reasons; append-only.
- gift_catalog and gift_events: fixed approved gift SKUs, idempotent viewer debit, stream/creator references.
- creator_earnings_ledger: pending/approved/payable/paid/reversed entries; never merge with viewer token balance.
- booking price: server-validated 500–1,000 token range and immutable booking price snapshot.
- metering_rates: 1 token/sec free voice, 5 tokens/sec free video, 5 tokens/sec subscriber video, subscriber voice exempt; effective-dated config.
- member_entitlements: one server-authoritative function used by API/RPCs and Android UI.
- Admin config changes: role checks, maker-checker, audit trail, effective dates, immutable history.
- Financial flags remain off for token purchases, booking settlement, creator cash redemption and payouts until approvals.

## 8. Android work

- Wallet: real balance, recent ledger, subscription status and clear separate tabs/sections. Show only packages of 500 tokens or fewer; reject any purchase request above 500 tokens server-side.
- Subscription: plan comparison, purchase/restore status, expiry and entitlement refresh.
- Discover: remaining free likes/dislikes/rewinds; subscriber-only liked-you view; rewind action.
- Chat: free chat for all, subscriber unlimited messaging entitlement, server-side anti-spam.
- Call: rate and estimated balance disclosure; free/subscriber voice rules; video metering; connected-time status and low-balance warning.
- Live: gift catalogue, token cost confirmation, send progress, receipt and creator-facing gift events.
- Booking: creator-set token price (500–1,000), buyer confirmation, token availability, booking state and dispute/safety actions.
- Hide purchase/redemption/settlement controls when the corresponding server and provider flags are disabled. Never show a fake successful purchase.

## 9. Release gates

1. Confirm the final token package price schedule and exact INR per-token economics.
2. Legal/tax review of virtual currency, creator rewards, booking marketplace and payout model in India.
3. Google Play classification and billing integration for subscriptions, token packs and digital gifts. Review any applicable India alternative-billing programme before use.
4. Payment provider approval for any INR marketplace settlement; do not hold customer money in RentMate's ordinary operating account.
5. SQL/API tests for replay, race, balance exhaustion, entitlement expiry, refunds, chargebacks, and webhook verification.
6. Android typecheck, unit tests, bundle, native checks, EAS production build and real-device verification.

## 10. Founder pricing decision and remaining gates

Founder decisions (2026-11-24): small token packs start at ₹20 per token; larger packs receive progressive volume discounts, reaching ₹15 per token at the 500-token tier. A single purchase transaction is capped at 500 tokens maximum. The illustrative tier schedule in section 2 is a planning baseline only. Before any SKU becomes purchasable, approve exact quantities and totals, tax treatment/display, store product IDs, refunds and provider classification. Creator earnings (₹6–₹7 per eligible gift token and ₹8–₹10 per booking token) must be finalized as INR payable amounts, not token transfers, and remain disabled pending approvals.
