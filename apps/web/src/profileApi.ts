import type { ProfileRow } from "./profile";
import { supabase } from "./supabase";

/** True when the database doesn't have a column yet (migration not applied). */
export function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /could not find the '.*' column|column .* does not exist/i.test(err.message ?? "")
  );
}

/** Message for a failed profile save that people can act on. */
export function saveErrorMessage(err: { code?: string; message?: string }): string {
  if (isMissingColumn(err)) {
    return "This part of your profile can't be saved yet because a database update is still pending. Your other details are safe.";
  }
  if (err.code === "23514")
    return "One of the values isn't allowed. Check the highlighted fields and try again.";
  if (/row-level security/i.test(err.message ?? "")) return "You can only change your own profile.";
  return `Could not save: ${err.message ?? "unknown error"}`;
}

export type ProfilePatch = Partial<Omit<ProfileRow, "id" | "created_at" | "verified" | "last_seen_at">>;

/** Saves some of your own profile fields. RLS only allows your own row. */
export async function saveProfileFields(userId: string, patch: ProfilePatch): Promise<void> {
  const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
  if (error) throw new Error(saveErrorMessage(error));
}
