import type { ProfileStore } from "./app.js";
import { excludeSeen, type MatchProfile } from "./matching.js";
import type { ProfileInput } from "./validation.js";

/**
 * In-memory store for local development and tests only.
 * Data is lost on restart. Production uses SupabaseProfileStore.
 */
export class MemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, MatchProfile>();
  private seen = new Map<string, Set<string>>();

  async upsertProfile(userId: string, p: ProfileInput): Promise<void> {
    this.profiles.set(userId, {
      id: userId,
      displayName: p.displayName,
      bio: p.bio,
      age: p.age,
      interests: p.interests,
      lookingFor: p.lookingFor,
      ageMin: p.ageMin,
      ageMax: p.ageMax,
    });
  }

  async getProfile(userId: string): Promise<MatchProfile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async listCandidates(userId: string): Promise<MatchProfile[]> {
    const others = [...this.profiles.values()].filter((p) => p.id !== userId);
    return excludeSeen(others, this.seen.get(userId) ?? []);
  }

  /** Records a like or pass, mirroring the likes/passes tables. */
  markSeen(userId: string, otherId: string): void {
    const set = this.seen.get(userId) ?? new Set<string>();
    set.add(otherId);
    this.seen.set(userId, set);
  }
}
