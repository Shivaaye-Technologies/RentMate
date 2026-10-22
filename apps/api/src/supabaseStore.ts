import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProfileStore } from "./app.js";
import { excludeSeen, type MatchProfile } from "./matching.js";
import type { ProfileInput } from "./validation.js";

export interface ProfileRow {
  id: string;
  display_name: string;
  age: number;
  bio: string;
  interests: string[];
  looking_for: MatchProfile["lookingFor"];
  age_min: number;
  age_max: number;
  photo_path?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  last_seen_at?: string;
  created_at?: string;
  verified?: boolean;
}

const COLUMNS =
  "id, display_name, age, bio, interests, looking_for, age_min, age_max, photo_path, lat, lng, last_seen_at, created_at, verified";

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
const CANDIDATE_LIMIT = 500;

export function toMatchProfile(r: ProfileRow): MatchProfile {
  return {
    id: r.id,
    displayName: r.display_name,
    bio: r.bio,
    age: r.age,
    interests: r.interests ?? [],
    lookingFor: r.looking_for,
    ageMin: r.age_min,
    ageMax: r.age_max,
    photoPath: r.photo_path ?? null,
    lat: num(r.lat),
    lng: num(r.lng),
    lastSeenAt: r.last_seen_at,
    joinedAt: r.created_at,
    verified: r.verified ?? false,
  };
}

export function toProfileRow(userId: string, p: ProfileInput): ProfileRow {
  return {
    id: userId,
    display_name: p.displayName,
    age: p.age,
    bio: p.bio,
    interests: p.interests,
    looking_for: p.lookingFor,
    age_min: p.ageMin,
    age_max: p.ageMax,
  };
}

/**
 * Profile store backed by Supabase. It queries with the caller's own JWT, so
 * every read and write is checked by the database's RLS policies; the API never
 * uses a privileged key.
 */
export class SupabaseProfileStore implements ProfileStore {
  private db: SupabaseClient;

  constructor(url: string, publishableKey: string, accessToken: string) {
    this.db = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  async upsertProfile(userId: string, p: ProfileInput): Promise<void> {
    const { error } = await this.db.from("profiles").upsert(toProfileRow(userId, p));
    if (error) throw new Error(`Saving profile failed: ${error.message}`);
  }

  async getProfile(userId: string): Promise<MatchProfile | null> {
    const { data, error } = await this.db.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
    if (error) throw new Error(`Loading profile failed: ${error.message}`);
    return data ? toMatchProfile(data as ProfileRow) : null;
  }

  async listCandidates(userId: string): Promise<MatchProfile[]> {
    const [profiles, likes, passes] = await Promise.all([
      this.db.from("profiles").select(COLUMNS).neq("id", userId).limit(CANDIDATE_LIMIT),
      this.db.from("likes").select("liked_id").eq("liker_id", userId),
      this.db.from("passes").select("passed_id").eq("passer_id", userId),
    ]);
    const failed = profiles.error ?? likes.error ?? passes.error;
    if (failed) throw new Error(`Loading candidates failed: ${failed.message}`);

    const seen = [
      ...(likes.data ?? []).map((l: { liked_id: string }) => l.liked_id),
      ...(passes.data ?? []).map((p: { passed_id: string }) => p.passed_id),
    ];
    return excludeSeen(((profiles.data ?? []) as ProfileRow[]).map(toMatchProfile), seen);
  }
}
