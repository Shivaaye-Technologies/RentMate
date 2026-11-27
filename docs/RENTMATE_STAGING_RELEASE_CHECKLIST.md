# RentMate — staging release checklist

Owner key: **F** = founder or operator (credentials, consoles, legal). **E** = engineering. Tick a box only after
it is done and checked. Nothing here is a production step; production needs a separate, founder-approved plan.

## 1. Code and CI

- [ ] **F** Grant the `workflow` scope (`gh auth refresh -h github.com -s workflow`, then finish the device login in
      the browser), or push the local commit "fix(ci): build the release variant for the test APK" yourself. This fixes the APK workflow.
- [x] **E** CI green on PR #19 at `13aad35` (run 45909194104).
- [ ] **E** APK workflow green on the release-variant build; record the artifact link, run ID and SHA-256.
- [ ] **F** CodeQL: check the PR's code-scanning results in the GitHub UI (default setup).
- [ ] **F** Review PR #19 and decide on the merge. Do not merge without founder approval.

## 2. Supabase staging (never production)

- [ ] **F** Back up staging, then apply the migrations through `20261126170000`. The held gifts migration is not
      included.
- [ ] **F** Auth redirect URLs `rentmate://auth/callback` and `rentmate://auth/reset`; Google provider.
- [ ] **F** Integration secrets `booking_jobs` and `play_billing` (and `livekit_webhook` for live), long and random,
      set the same in the API host's secret store.
- [ ] **F** Grant the first `super_admin` from the SQL editor; turn on admin MFA before any other staff role.
- [ ] **F** Mark tester accounts (`is_tester`); switch on the booking and billing sandboxes; enable the products.

## 3. API and web on Render (staging)

- [ ] **F** Environment from `.env.example` (no secrets in the repository). `GET /health` returns OK.
- [ ] **F** Actions variables `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable key) and
      `EXPO_PUBLIC_API_URL` set to the staging values.

## 4. Google Play (sandbox only)

- [ ] **F** Play Console app; the products `rentmate_tokens_50/100/250/500` (consumable) and `rentmate_monthly`
      (subscription).
- [ ] **F** License testers; an internal testing track build. Play Billing works only for installs from Play.
- [ ] **F** Release (upload) keystore through EAS credentials or GitHub secrets. Current APKs are debug-signed.
- [ ] **F** A service account with order and financial permissions; its JSON stored only in the API host's
      secret store.
- [ ] **F** RTDN: a Pub/Sub topic, Publisher granted to Google Play's account, and a push subscription to
      `/api/v1/billing/google/rtdn?token=…`.
- [ ] **F** Keep live token sales off. They are locked by a database constraint; lifting it needs an approved
      migration.

## 5. Push notifications

- [ ] **F** A Firebase project and `google-services.json` for the staging package id, then E-1.

## 6. Devices

- [ ] **F** Install on 2+ phones and fill in `RENTMATE_ANDROID_DEVICE_TEST_REPORT.md`.

## 7. Legal, tax and policy (founder approval; not engineering decisions)

- [ ] **F** Terms of service, privacy policy and community guidelines published, with in-app links.
- [ ] **F** Google Play policies: dating, user-generated content, real-money and virtual currency, and the Data
      safety form.
- [ ] **F** India: GST registration and treatment of token sales; invoices; TDS on any future creator payouts;
      DPDP Act 2023 obligations (consent, grievance officer).
- [ ] **F** Creator and companion agreements, including any creator share for bookings or gifts. None is defined
      in code.
- [ ] **F** Gift rules: prices, share, moderation. Approving them unblocks the held gifts migration.
- [ ] **F** Safety: meeting-in-public guidance, emergency contacts and a moderation staffing plan.
- [ ] **F** A penetration test before any public launch.

## Locked until separately approved

Live payments, cash conversion or INR redemption, withdrawals, transfers between members, creator payouts and live
gifts. Each is locked off by a database constraint.
