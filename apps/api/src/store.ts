import type { ProfileStore } from "./app.js";
import type { MatchProfile } from "./matching.js";
import type { ProfileInput } from "./validation.js";

/**
 * In-memory store for local development and tests only.
 * Data is lost on restart. Replace with a Supabase-backed store for production.
 */
export class MemoryProfileStore implements ProfileStore {
  private profiles = new Map<string, MatchProfile>();

  async upsertProfile(userId: string, p: ProfileInput): Promise<void> {
    this.profiles.set(userId, {
      id: userId,
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
    return [...this.profiles.values()].filter((p) => p.id !== userId);
  }
}
