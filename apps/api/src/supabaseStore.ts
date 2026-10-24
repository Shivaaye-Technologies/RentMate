import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ProfileStore } from "./app.js";
import type { MatchProfile } from "./matching.js";
import type { ProfileInput } from "./validation.js";

/** Row from public.get_my_profile() (your own profile, all columns). */
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

/**
 * Row from public.discover_profiles() / profiles_by_ids(). Other people never
 * come with coordinates or last-seen times: the database returns a coarse
 * distance bucket and an online flag instead.
 */
export interface PersonRow {
  id: string;
  display_name: string;
  age: number;
  bio: string;
  interests: string[] | null;
  looking_for: MatchProfile["lookingFor"];
  age_min: number;
  age_max: number;
  photo_path: string | null;
  verified: boolean;
  created_at: string;
  distance_km: number | null;
  online: boolean;
  /** Optional details (migration 20261024090000); absent before it is applied. */
  photos?: string[] | null;
  gender?: string | null;
  height_cm?: number | null;
  job?: string | null;
  education?: string | null;
  exercise?: string | null;
  smoking?: string | null;
  children?: string | null;
  city?: string | null;
  neighbourhoods?: string[] | null;
  favourite_places?: string[] | null;
  prompts?: unknown;
}

/** Public detail fields copied to the API response as they are. */
export const DETAIL_KEYS = [
  "gender",
  "height_cm",
  "job",
  "education",
  "exercise",
  "smoking",
  "children",
  "city",
  "neighbourhoods",
  "favourite_places",
  "prompts",
] as const;

export function detailsOf(r: PersonRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of DETAIL_KEYS) if (r[k] !== undefined) out[k] = r[k];
  return out;
}

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

export function personToMatchProfile(r: PersonRow): MatchProfile {
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
    joinedAt: r.created_at,
    verified: r.verified ?? false,
    distanceKm: r.distance_km,
    online: r.online,
    details: detailsOf(r),
    photos: Array.isArray(r.photos) ? r.photos : [],
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
 * every read and write is checked by the database's RLS policies and functions;
 * the API never uses a privileged key.
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

  async getProfile(): Promise<MatchProfile | null> {
    const { data, error } = await this.db.rpc("get_my_profile").maybeSingle();
    if (error) throw new Error(`Loading profile failed: ${error.message}`);
    return data ? toMatchProfile(data as ProfileRow) : null;
  }

  /** The database already excludes you, people you liked or passed, and blocks. */
  async listCandidates(): Promise<MatchProfile[]> {
    const { data, error } = await this.db.rpc("discover_profiles", { p_limit: CANDIDATE_LIMIT });
    if (error) throw new Error(`Loading candidates failed: ${error.message}`);
    return ((data ?? []) as PersonRow[]).map(personToMatchProfile);
  }
}
