import type { Person } from "../api";
import { EMPTY_DETAILS } from "../details";
import { supabase } from "../supabase";

/** Row returned by public.demo_mode_profiles(): only fictional demo profiles. */
interface DemoRow {
  id: string;
  display_name: string;
  age: number;
  bio: string;
  interests: string[] | null;
  looking_for: Person["lookingFor"];
  photo_path: string | null;
  verified: boolean;
  created_at: string;
  distance_km: number | null;
  online: boolean;
}

export function personFromDemoRow(r: DemoRow): Person {
  return {
    id: r.id,
    score: 0,
    sharedInterests: [],
    displayName: r.display_name,
    age: r.age,
    bio: r.bio,
    interests: r.interests ?? [],
    lookingFor: r.looking_for,
    photoPath: r.photo_path,
    verified: r.verified,
    online: r.online,
    distanceKm: r.distance_km,
    joinedAt: r.created_at,
    details: EMPTY_DETAILS,
    photos: [],
  };
}

/**
 * Loads the fictional demo profiles for Demo Mode. Works signed in or not.
 * The database function returns demo profiles only, never real members.
 */
export async function loadDemoPeople(
  rpc: (
    fn: "demo_mode_profiles",
    args: { p_limit: number },
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }> = (fn, args) => supabase.rpc(fn, args),
): Promise<Person[]> {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await rpc("demo_mode_profiles", { p_limit: 500 });
  } catch {
    throw new Error("Can't reach SOULMATE.AI right now. Check your connection and try again.");
  }
  if (result.error) throw new Error(`Could not load demo profiles: ${result.error.message}`);
  if (!Array.isArray(result.data)) throw new Error("Could not load demo profiles: unexpected response.");
  return (result.data as DemoRow[]).map(personFromDemoRow);
}
