import { isNew, type LookingFor, type PersonRow } from "./profile";

export type HealthState = "checking" | "online" | "offline";

/** Base URL of the API. Set VITE_API_URL at build time; defaults to local dev. */
export function apiBaseUrl(envUrl: string | undefined = import.meta.env.VITE_API_URL): string {
  const url = (envUrl ?? "").trim() || "http://localhost:4000";
  return url.replace(/\/+$/, "");
}

export async function checkHealth(fetchFn: typeof fetch = fetch, base = apiBaseUrl()): Promise<HealthState> {
  try {
    const res = await fetchFn(`${base}/health`);
    if (!res.ok) return "offline";
    const body = (await res.json()) as { status?: string };
    return body.status === "ok" ? "online" : "offline";
  } catch {
    return "offline";
  }
}

/** A person shown in the app (from the API's ranking, or built from a profile row). */
export interface Person {
  id: string;
  score: number;
  sharedInterests: string[];
  displayName: string;
  age: number;
  bio: string;
  interests: string[];
  lookingFor: LookingFor;
  photoPath: string | null;
  verified: boolean;
  online: boolean;
  distanceKm: number | null;
  joinedAt: string | null;
}

/** Ranked people to discover, from the API's matching engine. */
export async function fetchRanked(
  token: string,
  fetchFn: typeof fetch = fetch,
  base = apiBaseUrl(),
): Promise<Person[]> {
  const res = await fetchFn(`${base}/api/v1/matches`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { matches?: Person[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.matches ?? [];
}

/** Builds a Person from a database row (used for Likes and Chats). */
export function personFromRow(row: PersonRow): Person {
  return {
    id: row.id,
    score: 0,
    sharedInterests: [],
    displayName: row.display_name,
    age: row.age,
    bio: row.bio,
    interests: row.interests ?? [],
    lookingFor: row.looking_for,
    photoPath: row.photo_path ?? null,
    verified: row.verified ?? false,
    online: row.online ?? false,
    distanceKm: row.distance_km ?? null,
    joinedAt: row.created_at ?? null,
  };
}

export type Filter = "all" | "new" | "verified" | "online";

/** Discover filters: quick filter plus "I'm here for" mood. */
export function filterPeople(people: Person[], filter: Filter, mood: LookingFor | "any", now = Date.now()) {
  return people.filter((p) => {
    if (mood !== "any" && p.lookingFor !== mood) return false;
    if (filter === "new") return isNew(p.joinedAt, now);
    if (filter === "verified") return p.verified;
    if (filter === "online") return p.online;
    return true;
  });
}
