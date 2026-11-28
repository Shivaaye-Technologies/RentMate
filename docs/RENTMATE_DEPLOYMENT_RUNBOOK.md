# RentMate — staging deployment runbook

**Staging only.** Never point any of this at production. Never run production migrations, and never turn on live
purchases, cash conversion, withdrawals or payouts. Generate secrets on your own machine and paste them only into
the host's secret store or the Supabase SQL editor, never into chat or into the repository.

## 1. Database (Supabase staging project)

1. Take a backup (Dashboard → Database → Backups), or confirm point-in-time recovery is on.
2. Apply the migrations in filename order. The ones added on this branch:
   - `20261126090000_booking_token_holds.sql`
   - `20261126100000_play_billing_purchases.sql`
   - `20261126110000_admin_role_tiers.sql`
   - `20261126120000_booking_expiry_job.sql`
   - `20261126130000_revoke_anon_social_reads.sql`

   Use `supabase db push` against the staging project ref, or paste each file into the SQL editor in order.

3. Rollback scripts are in `docs/rollback/`, each named after its migration. Each one refuses to run if running it
   would lose accounting records. The scripts are rehearsed in `npm run test:rollback`.
4. Integration secrets (SQL editor, run as the owner). Generate each value with `openssl rand -base64 48`:
   ```sql
   select private.set_integration_secret('play_billing', '<BILLING_DB_SECRET>');
   select private.set_integration_secret('booking_jobs', '<BOOKING_JOBS_DB_SECRET>');
   -- LiveKit, if testing calls or live rooms:
   select private.set_integration_secret('livekit_webhook', '<LIVE_WEBHOOK_DB_SECRET>');
   ```
5. The first super admin (SQL editor): `insert into private.user_roles (user_id, role) values ('<uuid>', 'super_admin');`.
   Turn admin MFA on first (`docs/RENTMATE_ADMIN_MFA.md`).
6. Testers and sandboxes, as an admin:
   - `update public.profiles set is_tester = true where id in (...)` (SQL editor);
   - `select public.admin_set_booking_token_sandbox(true);`
   - `select public.admin_set_billing_sandbox(true);`
   - `select public.admin_set_store_product_enabled('rentmate_tokens_50', true);` (once per product).
7. Auth: add the redirect URLs `rentmate://auth/callback` and `rentmate://auth/reset`, and set up the Google provider.

## 2. API (Render staging service)

Set these environment variables. The service fails closed: a missing feature setting makes that feature answer 503,
or leaves its job off.

| Variable                                                                         | Purpose                                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`                                              | Staging project (publishable key only)                    |
| `CORS_ORIGINS`                                                                   | Staging web origin                                        |
| `GOOGLE_PLAY_PACKAGE_NAME`                                                       | `com.shivaayetechnologies.rentmate`                       |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`                                               | Service-account key (secret)                              |
| `BILLING_DB_SECRET`                                                              | Same as the `play_billing` integration secret             |
| `GOOGLE_PLAY_RTDN_TOKEN`                                                         | `openssl rand -hex 32`, also used in the Pub/Sub push URL |
| `BOOKING_JOBS_DB_SECRET`                                                         | Same as `booking_jobs`; starts the expiry job             |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVE_WEBHOOK_DB_SECRET` | Optional: calls and live rooms                            |

Check: `GET /health` answers 200, and `GET /ready` answers 200 once Supabase is reachable.

## 3. Google Play (sandbox)

Follow `docs/PLAY_BILLING_SANDBOX_RUNBOOK.md`: create the products, license testers, service account and RTDN
Pub/Sub push to `https://<staging-api>/api/v1/billing/google/rtdn?token=<GOOGLE_PLAY_RTDN_TOKEN>`.

Play Billing only works for an app installed from Play, so upload a build to the **internal testing** track. That
needs a release-signed build (see `RENTMATE_REMAINING_TASKS.md`, P-5).

## 4. Android test build

See `docs/ANDROID_INTERNAL_TEST_CHECKLIST.md`. In short:

1. Set the Actions variables.
2. Run `android-device-apk.yml` on `feature/rentmate-testing-apk`.
3. Download the artifact and check its checksum.
4. Install it on test phones and run the smoke test.

## 5. Merge and release

PR → CI and CodeQL green → founder review → merge (founder only). Production needs its own approval: a backup,
production migrations, and the legal and policy review. None of it is covered by this runbook.
