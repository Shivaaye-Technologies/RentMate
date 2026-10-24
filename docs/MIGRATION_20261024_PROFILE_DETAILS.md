# Migration `20261024090000_profile_details`

Status: **not applied to production.** Apply only after the owner approves.

## What it does

Additive only. Nothing existing is changed or deleted.

| Change                                                     | Details                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New optional profile columns                               | `gender`, `show_me`, `height_cm`, `job`, `education`, `exercise`, `smoking`, `children`, `city`, `neighbourhoods` (≤5), `favourite_places` (≤10), `prompts` (≤3 `{q,a}`), `photos` (≤6, own folder only), `hidden`, `notify_prefs`, `safety_intro_at`, `welcome_seen_at`            |
| New checks on existing columns                             | `interests` ≤ 10 items of ≤ 30 characters; `photo_path` must be in the owner's storage folder (demo portraits exempt). Production data was checked first: real profiles have at most 6 interests, the longest is 15 characters, and every real photo path is in its owner's folder. |
| Column grants                                              | Owners can write the new columns. Other people still cannot read the table's private columns (location, last seen, `show_me`, `hidden`, `notify_prefs`).                                                                                                                            |
| `private.people` / `discover_profiles` / `profiles_by_ids` | Recreated with the new public fields. A profile with `hidden = true` is left out of other people's Discover; existing likes and matches can still see it.                                                                                                                           |
| `public.match_reads`                                       | One read marker per person per match (for unread counts). RLS: own rows only, own matches only.                                                                                                                                                                                     |
| `public.my_blocked_users()`                                | Lists the people you blocked so you can unblock them.                                                                                                                                                                                                                               |

Matching is otherwise unchanged. `gender` and `show_me` are stored and shown, but **do not filter Discover** until that is separately approved.

## Order of operations (important)

The new website writes the new columns, so **apply the migration before the website is deployed**:

1. Owner approves the migration.
2. Apply `supabase/migrations/20261024090000_profile_details.sql` (Supabase SQL editor or `supabase db push`). Record it under version `20261024090000`.
3. Run the checks in `supabase/tests/profile_details.sql` against a branch or rely on the local PGlite run (`npm run test:db`).
4. Merge the pull request. Render and Vercel then deploy the website and API.
5. Check `GET /health`, sign in, open Profile, save a field.

If the website is deployed first, saving the new fields fails with "column does not exist" until the migration is applied. Nothing is lost, but onboarding cannot finish.

## Rollback

Run as one transaction. This removes the new data (cities, prompts, extra photos, read markers). Extra photo **files** stay in Storage until removed.

```sql
begin;
drop function public.my_blocked_users();
drop function private.my_blocked();
drop table public.match_reads;

drop function public.discover_profiles(int);
drop function public.profiles_by_ids(uuid[]);
drop function private.people(uuid[], int);
-- Recreate the previous versions: copy the "create or replace function private.people"
-- block from 20261023165729_demo_mode_public.sql, then the two public wrappers and
-- their grants from 20261023101225_safety_profile_functions_delete_account.sql.

alter table public.profiles
  drop constraint photos_own_folder,
  drop constraint photo_path_own_folder,
  drop constraint interests_limit,
  drop column gender, drop column show_me, drop column height_cm, drop column job,
  drop column education, drop column exercise, drop column smoking, drop column children,
  drop column city, drop column neighbourhoods, drop column favourite_places,
  drop column prompts, drop column photos, drop column hidden, drop column notify_prefs,
  drop column safety_intro_at, drop column welcome_seen_at;

drop function private.short_texts(text[], int, int);
drop function private.valid_prompts(jsonb);
drop function private.own_photo_paths(uuid, text[]);
drop function private.valid_notify_prefs(jsonb);
commit;
```

Then revert the website to the previous release so it stops writing the new columns.
