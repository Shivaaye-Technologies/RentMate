# Google Play Billing — sandbox runbook

What is built (server and database), what is not, and the exact steps to switch the sandbox on in **staging**.
Live purchases stay impossible: `financial_flags.purchases_off` and `billing_settings.live_billing_off` are check
constraints, so only a reviewed migration can lift them.

## How a purchase is credited

1. The app starts a Play Billing purchase with `obfuscatedAccountId = sha256("rentmate:" + userId)` (hex). _Not built
   yet in the app — see "Not built"._
2. The app sends `{ kind, productId, purchaseToken }` to `POST /api/v1/billing/google/purchases` (signed-in member).
3. The API asks Google (`purchases.products.get` / `purchases.subscriptionsv2.get`) with the server-only service
   account. A token that is not this member's (account id mismatch or missing) is refused with 403.
4. The API calls `billing_record_play_purchase` with the `play_billing` integration secret. The database credits only
   when: the billing sandbox is on, the product is enabled, Google marked it a **test** purchase (`purchaseType = 0`),
   and the member is a tester account. Quantities and prices come from `token_package_catalog` and are snapshotted.
   Idempotent per SHA-256 of the purchase token; a token presented by another account is refused and logged.
5. Only after the database recorded it does the API consume (token packs) or acknowledge (subscriptions) with Google.
   Refused purchases stay unacknowledged, so Google refunds them automatically after 3 days.

Refunds/voids (RTDN `voidedPurchaseNotification`) post a compensating `purchase_reversal` entry for what is left in
the wallet; a shortfall is recorded as `revoked_shortfall` and logged (`purchase_reversal_shortfall`) for review. The
balance never goes negative. Subscription notifications always re-fetch the state from Google; revocation removes the
entitlement and a revoked subscription is never reactivated by a replay. Notifications never credit anything.

## Files

| Area      | File                                                                                |
| --------- | ----------------------------------------------------------------------------------- |
| Migration | `supabase/migrations/20261126100000_play_billing_purchases.sql`                     |
| DB tests  | `supabase/tests/play_billing_purchases.sql` (41 checks; also in rollback rehearsal) |
| Rollback  | `docs/rollback/20261126_play_billing_purchases.rollback.sql` (refuses if used)      |
| API       | `apps/api/src/billing/{googlePlay,store,routes}.ts`, wired in `app.ts`/`server.ts`  |
| API tests | `apps/api/test/billing.test.ts` (Google responses mocked; no network)               |

## Staging enablement (founder / operator steps)

1. Play Console: create products `rentmate_tokens_50`, `rentmate_tokens_100`, `rentmate_tokens_250`,
   `rentmate_tokens_500` (one-time, consumable) and subscription `rentmate_monthly`. Add license testers.
2. Google Cloud: create a service account, grant it the Play Console "View financial data" and "Manage orders"
   permissions for this app, create a JSON key. Put the JSON **only** in the API host's secret store as
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. Never commit it or paste it into chat.
3. Generate secrets on your machine: `openssl rand -base64 48` → `BILLING_DB_SECRET`; `openssl rand -hex 32` →
   `GOOGLE_PLAY_RTDN_TOKEN`. Set both plus `GOOGLE_PLAY_PACKAGE_NAME=com.shivaayetechnologies.rentmate` on the staging
   API service.
4. Staging database (SQL editor, as owner): `select private.set_integration_secret('play_billing', '<BILLING_DB_SECRET>');`
5. Pub/Sub: create a topic, grant `google-play-developer-notifications@system.gserviceaccount.com` the Publisher role,
   set it as the RTDN topic in Play Console, and add a push subscription to
   `https://<staging-api>/api/v1/billing/google/rtdn?token=<GOOGLE_PLAY_RTDN_TOKEN>`. Send a test notification.
6. As an admin in the app/database: `select public.admin_set_billing_sandbox(true);` and
   `select public.admin_set_store_product_enabled('rentmate_tokens_50', true);` (per product). Mark test members with
   `profiles.is_tester = true`.

## Not built (launch blockers for payments)

- **App purchase flow**: the Android app has no Play Billing library yet (wallet is read-only). Needs a native billing
  module compatible with Expo SDK 58 (e.g. `expo-iap`), the `obfuscatedAccountId` above, and a call to the purchase
  route. Adding it needs an APK rebuild and device testing.
- Effective-dated GST/tax and invoice records; maker-checker approval for catalog price changes (the
  `financial_config_versions` table exists; package prices are still edited by migration).
- Live enablement: legal/tax approval, Play policy review, a migration lifting the two constraints. Not to be done
  without explicit founder approval.
- Creator payouts, withdrawals, transfers and cash redemption remain off and are not part of this work.
