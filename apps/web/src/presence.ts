import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Marks the signed-in user as active now (drives "Online" for other people).
 * The query must be awaited: Supabase only sends a request when its result is
 * awaited, so the old `void supabase.from(...)...` never reached the database.
 * Returns the error message, or null on success; failures are logged, not hidden.
 */
export async function touchLastSeen(
  client: Pick<SupabaseClient, "from">,
  userId: string,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const { error } = await client
      .from("profiles")
      .update({ last_seen_at: now.toISOString() })
      .eq("id", userId);
    if (error) {
      console.error("Could not update online status", error);
      return error.message;
    }
    return null;
  } catch (e) {
    console.error("Could not update online status", e);
    return e instanceof Error ? e.message : String(e);
  }
}
