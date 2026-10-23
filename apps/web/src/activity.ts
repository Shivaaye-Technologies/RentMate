import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Your own Discover activity, read with your own session. Row Level Security
 * only lets you read your own likes and passes (and likes sent to you), so
 * these numbers can never include anyone else's private activity.
 */
export interface Activity {
  /** People you liked who have not liked you back yet. */
  awaitingReply: number;
  /** People you passed (hidden from Discover until you review them). */
  passed: number;
}

type Db = Pick<SupabaseClient, "from">;

export async function loadActivity(db: Db, me: string): Promise<Activity> {
  const [sent, received, passes] = await Promise.all([
    db.from("likes").select("liked_id").eq("liker_id", me),
    db.from("likes").select("liker_id").eq("liked_id", me),
    db.from("passes").select("passed_id", { count: "exact", head: true }).eq("passer_id", me),
  ]);
  const error = sent.error ?? received.error ?? passes.error;
  if (error) throw new Error(`Could not load your activity: ${error.message}`);
  const likedYou = new Set(((received.data ?? []) as { liker_id: string }[]).map((r) => r.liker_id));
  const awaitingReply = ((sent.data ?? []) as { liked_id: string }[]).filter(
    (r) => !likedYou.has(r.liked_id),
  ).length;
  return { awaitingReply, passed: passes.count ?? 0 };
}

/**
 * Brings back everyone you passed, so they appear in Discover again. Deletes
 * only rows where you are the passer: the filter below and the database policy
 * "passes delete own" (passer_id = your user id) both enforce it.
 */
export async function clearMyPasses(db: Db, me: string): Promise<number> {
  const { error, count } = await db.from("passes").delete({ count: "exact" }).eq("passer_id", me);
  if (error) throw new Error(`Could not bring back passed profiles: ${error.message}`);
  return count ?? 0;
}
