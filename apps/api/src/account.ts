import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Account deletion, done on the server so that closing the browser cannot leave photos behind (P2-05). */
export interface AccountDeleter {
  /** Removes every file in the user's photo folder, then deletes the account. Safe to repeat. */
  deleteAccount(userId: string): Promise<{ photosRemoved: number }>;
}

export type AccountDeletionStage = "photos" | "account";

export class AccountDeletionError extends Error {
  constructor(
    readonly stage: AccountDeletionStage,
    message: string,
  ) {
    super(message);
    this.name = "AccountDeletionError";
  }
}

const BUCKET = "photos";
const PAGE = 100;
/** Upper bound on list/remove rounds (6 photos per profile today; this allows 2,000 files). */
const MAX_ROUNDS = 20;

/**
 * Uses the member's own session (publishable key + their access token), never a privileged key: Storage's
 * "photos delete own folder" policy lets a member remove only their own files, and the database's
 * delete_my_account refuses while any file remains, so the order below is enforced on the server.
 */
export class SupabaseAccountDeleter implements AccountDeleter {
  private readonly db: SupabaseClient;

  constructor(url: string, publishableKey: string, accessToken: string, fetchFn?: typeof fetch) {
    this.db = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` }, ...(fetchFn ? { fetch: fetchFn } : {}) },
    });
  }

  private async listOwn(userId: string): Promise<string[]> {
    const { data, error } = await this.db.storage.from(BUCKET).list(userId, { limit: PAGE, offset: 0 });
    if (error) throw new AccountDeletionError("photos", "Couldn't list your photos.");
    // Folders come back with a null id; photos live directly in the user's folder.
    return (data ?? []).filter((f) => f.id !== null && f.name).map((f) => `${userId}/${f.name}`);
  }

  async deleteAccount(userId: string): Promise<{ photosRemoved: number }> {
    let removed = 0;
    for (let round = 0; ; round++) {
      const names = await this.listOwn(userId);
      if (names.length === 0) break;
      if (round >= MAX_ROUNDS)
        throw new AccountDeletionError("photos", "Too many photos to delete in one go.");
      const { error } = await this.db.storage.from(BUCKET).remove(names);
      if (error) throw new AccountDeletionError("photos", "Couldn't delete your photos.");
      removed += names.length;
    }
    const { error } = await this.db.rpc("delete_my_account");
    if (error) {
      // P0001: a photo appeared after the folder was emptied (for example an upload from another device).
      throw new AccountDeletionError(
        "account",
        error.code === "P0001"
          ? "New photos were added while deleting. Please try again."
          : "Couldn't delete your account.",
      );
    }
    return { photosRemoved: removed };
  }
}
