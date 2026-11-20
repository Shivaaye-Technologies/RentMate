import type { ProfileRow } from "./profile";
import { saveProfileFields as saveFields, supabaseProfileDb } from "./shared/profileData";
import { supabase } from "./supabase";

// The rules live in the shared data layer (also used by the Android app); this binds them to the web client.
export { isMissingColumn, saveErrorMessage } from "./shared/profileData";

export type ProfilePatch = Partial<Omit<ProfileRow, "id" | "created_at" | "verified" | "last_seen_at">>;

/** Saves some of your own profile fields. RLS only allows your own row. */
export async function saveProfileFields(userId: string, patch: ProfilePatch): Promise<void> {
  await saveFields(supabaseProfileDb(supabase), userId, patch);
}
