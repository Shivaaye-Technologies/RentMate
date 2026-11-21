# RentMate Android — Dating, Companionship & Live Social Roadmap

Status: implementation plan opened on `feature/android-companionship-social`.
Target: Android staging only. No production deploy, merge, payment activation or store submission.

## Product promise

RentMate combines:

1. Dating and friendship discovery.
2. A two-sided, lawful non-sexual companionship marketplace where adults may offer or request time for public social activities.
3. Live social connection through moderated voice rooms, consensual video calls and community moments.

Positioning: "Nobody should have to feel alone." RentMate is a social connection product, not a mental-health treatment service. It must never promise to cure depression or replace professional support.

## User intents and roles

During onboarding, allow members to select any combination:

- Find companionship / someone to talk to.
- Offer companionship / make time available.
- Make friends.
- Date.
- Join online social rooms.

A member may both request and offer companionship. Gender must not determine marketplace eligibility.

## Companionship scope

Allowed listing categories:

- Conversation over coffee or a meal in a public venue.
- Public walks, sightseeing and city exploration.
- Events, museums, sports, music and other public activities.
- Shared hobbies and games in appropriate public settings.
- Online conversation by text, voice or video.

Listing data: title, category, description, languages, approximate service area, public meeting type, duration, availability, price display (feature disabled until legal/payment approval), host rules, cancellation policy, moderation state and reviews from verified completed bookings.

Booking states: requested → accepted/declined → confirmed (only when payment/legal rules permit) → completed/cancelled/disputed. Prevent overlapping accepted bookings. Never reveal a member's home address or precise live location.

## Happn-inspired discovery

- Photo-led profile cards, like/pass, mutual matches and preference filters.
- Nearby/recent-crossing discovery only with explicit mutual opt-in.
- Use approximate distance and privacy-preserving location; pause visibility at any time.
- Never expose exact coordinates or background tracking by default.

## TOKI-inspired social

- Browse themed live voice rooms; join as listener; request speaker status.
- Host/moderator mute, remove, end-room and report controls.
- Consensual private audio/video and small group video.
- Social moments/feed with reporting, blocking and content moderation.
- No recording by default; no recording without explicit informed consent.

## Android navigation target

Discover | Companions | Live | Likes | Chat | Profile

The first Android build currently contains auth, age-declaration gate, settings/account deletion and an early home placeholder. Do not label unbuilt screens as implemented. Existing API docs list GET /api/v1/matches and GET /api/v1/live/streams; marketplace listings and booking endpoints remain planned, not implemented.

## Existing foundations to reuse

- Supabase Auth and existing age-attestation gate.
- Existing profiles, matches, likes and messaging schema/RLS where available.
- Existing LiveKit provider, live policy and moderation foundation.
- Existing admin/reporting infrastructure.
- Existing non-transferable internal token ledger, with cash redemption, transfers, withdrawals and creator payouts disabled.

Do not create duplicate profile, match, wallet or live-room systems. Inspect current migrations and RLS before adding any table or endpoint.

## Safety and policy (non-negotiable)

- Strict 18+ access; self-declared age is not identity verification.
- No pornography, nudity, explicit sexual content, escorting, prostitution, sexual services, solicitation, trafficking, coercion or illegal activity.
- Companionship means lawful, non-sexual social time only.
- Public first meetings, consent, block/report, moderation, emergency exit and booking check-in/out.
- No therapeutic or clinical claims. Provide signposting to qualified support for users seeking mental-health care or reporting immediate danger.
- No payments, subscriptions, deposits, transfers, withdrawals, cash redemption, call charges or creator payouts until separately legally and provider approved.
- All location, camera and microphone access is optional and permission-based.

## Delivery gates

1. Android navigation and real profile onboarding/editing.
2. Discovery cards connected to authenticated API and match actions.
3. Companionship listing CRUD, review/moderation and booking API + database/RLS + overlap protection.
4. Live room browser and join/leave controls connected to existing API/LiveKit; disabled gracefully when provider is unconfigured.
5. Likes, chat, notifications and social moments.
6. Admin moderation and safety QA.
7. Typecheck, unit tests, Android export/build, clean install and physical-device tests.

Each delivery must include actual tests and a changelog. A placeholder UI is not a completed feature.
