# Demo profiles (testing only)

100 fictional profiles (50 female, 50 male, ages 18–45) for testing Discover, the card stack,
likes, matching and chat. **Only tester accounts can see them.** Ordinary users never see demo
profiles anywhere: not in Discover, not by id, not in the table, and they cannot like them.

## What makes them safe

- Every person is invented. Names, bios and details are generated; portraits are illustrations
  ("Personas" by Draftbit, CC BY 4.0), not photos of real people.
- `profiles.is_demo` marks them; `profiles.is_tester` marks who may see them. Users cannot set
  either column (outside the column grants). Enforced in RLS (restrictive policies) and in the
  discovery functions. Covered by `supabase/tests/demo_isolation.sql`.
- Demo accounts have no password and an undeliverable `@demo.soulmate.invalid` email, so nobody
  can sign in as them.
- In the app, testers see a yellow **DEMO** label on every demo profile, and the tenth automatic
  chat reply says it is a demo profile.

## Behaviour (so flows can be tested end to end)

- A tester's like is returned about 3 times in 4 (always for a Super Like), creating a match.
- Messaging a demo match gets an instant short reply, up to 10 per conversation.
- About a quarter of demo profiles show as online at any time (rotates every 10 minutes).

## Commands (run in the Supabase SQL Editor as the database owner; each needs approval)

| Step                                                        | File                                              |
| ----------------------------------------------------------- | ------------------------------------------------- |
| 1. Apply the migration                                      | `supabase/migrations/*_demo_profiles_testers.sql` |
| 2. Seed / refresh the 100 profiles (safe to repeat)         | `supabase/seed/demo_profiles.sql`                 |
| 3. Make an account a tester (edit the email first)          | `supabase/seed/grant_tester.sql`                  |
| Remove all demo profiles and their likes, matches, messages | `supabase/seed/demo_cleanup.sql`                  |

## Regenerating (different mix or city)

```sh
node scripts/demo/generate-demo-profiles.mjs --female 50 --male 50 --lat 28.61 --lng 77.21 --radius-km 15
```

Default centre is New Delhi. The script rewrites `supabase/seed/demo_profiles.sql` and
`apps/web/public/demo/avatars/*.svg` deterministically; run step 2 again afterwards.

## Before launch

Run `demo_cleanup.sql`, or keep the profiles: real users cannot see them either way.
