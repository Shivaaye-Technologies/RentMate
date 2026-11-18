# Demo profiles and Demo Mode

160 fictional profiles (ages 18–45): the original 100 plus 60 released over time (5 a day from
24 Oct 2026). They appear in two places only:

1. **Demo Mode** (`/#demo`), open to everyone from the landing page ("Try Demo Mode, no sign-up")
   and to members from their profile tab ("Explore Demo Mode"). A yellow banner on every screen
   says that every profile, like, match and message is fictional and simulated.
2. **Tester accounts** (`profiles.is_tester`), which also see them in the real app, labelled.

Ordinary members never see demo profiles in real Discover, Likes, Chats or by id, and cannot like
them. Demo profiles never appear as genuine members anywhere.

## What makes them safe

- Every person is invented. Names, bios and details are generated; portraits are illustrations
  ("Personas" by Draftbit, CC BY 4.0), not photos of real people.
- `profiles.is_demo` marks them. Users cannot set `is_demo`, `is_tester` or `demo_visible_from`
  (outside the column grants).
- `public.demo_mode_profiles()` is the only way visitors reach profile data. It returns **only**
  released demo profiles and only card fields (no coordinates, no last-seen times). Visitors still
  cannot read the `profiles` table, call real discovery or write anything.
- Demo Mode likes, matches and chats are **simulated in the visitor's browser** (`apps/web/src/demoMode/sim.ts`).
  Every record is marked `simulated: true` and stored only in this browser under
  `soulmate-demo-mode-v1`; nothing is written to `likes`, `matches` or `messages`, so no real member
  can see, receive or be represented by them. "Start over" resets it.
- Cards show a **Fictional** label; likes say "Simulated like"; matches say "Simulated: demo profiles
  are fictional…"; every reply says "Simulated reply", and the tenth says it is a demo profile.
- Demo accounts have no password and an undeliverable `@demo.soulmate.invalid` email.
- Tests: `supabase/tests/demo_mode.sql`, `demo_isolation.sql` (run by `npm run test:db`),
  `apps/web/src/demoMode/*.test.ts`.

## Simulated behaviour in Demo Mode (deterministic per browser)

- About a quarter of profiles "like you"; a third of those are there at once and the rest arrive
  over the first 30 minutes.
- Liking someone who liked you is a match; a Super Like always matches; otherwise about 45% match.
- A match sends an opener; each message you send gets a scripted reply after ~1.5 s, up to 10.
- About a quarter show as online at any moment (rotates every 10 minutes).

## Tester accounts (real app)

A tester's like is returned about 3 times in 4 (always for a Super Like) and messages get
automatic replies; these do use the real tables, marked by the demo profile on one side.

## Commands (Supabase SQL Editor, as the database owner; each needs approval)

| Step                                                          | File                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1. Apply migrations                                           | `supabase/migrations/*_demo_profiles_testers.sql`, `*_demo_mode_public.sql` |
| 2. Seed / refresh profiles (safe to repeat; never duplicates) | `supabase/seed/demo_profiles.sql`                                           |
| Make an account a tester (edit the email first)               | `supabase/seed/grant_tester.sql`                                            |
| Remove demo profiles above `--count`                          | `supabase/seed/demo_trim.sql`                                               |
| Remove all demo profiles and their likes, matches, messages   | `supabase/seed/demo_cleanup.sql`                                            |

## Generating more profiles

```sh
node scripts/demo/generate-demo-profiles.mjs --count 160 --per-day 5 --start 2026-10-24 --female-share 0.5
```

- The first 100 never change (a test pins their checksum). Profiles after that are appended one by
  one, each from its own seed, so a larger `--count` adds new people without changing or
  duplicating existing ones. Names, bios, ids and portraits stay unique.
- `--per-day` and `--start` set when each new profile appears (`demo_visible_from`); nothing needs
  to run on a schedule.
- `--count` is capped at 500. Other options: `--lat`, `--lng`, `--radius-km` (default New Delhi,
  15 km), `--seed`.
- The script rewrites `supabase/seed/demo_profiles.sql`, `supabase/seed/demo_trim.sql` and
  `apps/web/public/demo/avatars/*.svg`. Commit them, deploy the web app (for the portraits), then run
  the seed.

## Before launch

Demo Mode is designed to stay on. To remove it, run `demo_cleanup.sql` (Demo Mode then shows an
empty list) and remove the entry links.
