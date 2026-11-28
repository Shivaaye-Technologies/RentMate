/**
 * The signed-in member's own profile row. Members may read only the public profile columns of `profiles` directly
 * (column grants keep coordinates, notification and safety fields private), so `select("*")` or private columns
 * like `city` and `show_me` are refused with "permission denied". The owner's full row comes from get_my_profile().
 */
import { dbFailure } from "./diagnostics";

type RpcClient = {
  rpc(
    fn: "get_my_profile",
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export class ProfileLoadError extends Error {}

/** Resolves to the row, or null when the member has not created a profile yet. Throws on any database error. */
export async function loadMyProfile<T = Record<string, unknown>>(client: RpcClient): Promise<T | null> {
  const { data, error } = await client.rpc("get_my_profile");
  if (error) {
    dbFailure("get_my_profile", error);
    throw new ProfileLoadError("We couldn't load your profile. Check your connection and try again.");
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return (rows[0] as T | undefined) ?? null;
}
