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

/** Why Discover may be empty (from the API). */
export interface DiscoverSummary {
  /** People you have not liked, passed or blocked yet. */
  candidates: number;
  /** Of those, people outside your age range (or you are outside theirs). */
  outsideAgeRange: number;
}

export interface DiscoverResult {
  people: Person[];
  summary: DiscoverSummary | null;
}

/** A Discover failure with a message people can act on. `status` is null when the server was unreachable. */
export class DiscoverError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "DiscoverError";
  }
}

/** Ranked people to discover, from the API's matching engine. Never hides a failure. */
export async function fetchDiscover(
  token: string,
  fetchFn: typeof fetch = fetch,
  base = apiBaseUrl(),
): Promise<DiscoverResult> {
  let res: Response;
  try {
    res = await fetchFn(`${base}/api/v1/matches`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new DiscoverError(
      "Can't reach the SOULMATE.AI server. Check your internet connection and try again.",
      null,
    );
  }
  const body = (await res.json().catch(() => null)) as {
    matches?: unknown;
    summary?: DiscoverSummary;
    error?: string;
  } | null;
  if (res.status === 401) {
    throw new DiscoverError("Your session has expired. Please sign in again.", 401);
  }
  if (!res.ok) {
    const detail = body?.error ? `${body.error}` : "The server could not load profiles";
    throw new DiscoverError(`${detail} (error ${res.status}). Please try again.`, res.status);
  }
  if (!body || !Array.isArray(body.matches)) {
    throw new DiscoverError("The server sent an unexpected response. Please try again.", res.status);
  }
  return { people: body.matches as Person[], summary: body.summary ?? null };
}

export interface EmptyState {
  title: string;
  body: string;
  /** Offer a shortcut to the profile (age range) settings. */
  editProfile: boolean;
}

/** Explains an empty Discover using the real reason. */
export function discoverEmptyState(summary: DiscoverSummary | null): EmptyState {
  const outside = summary?.outsideAgeRange ?? 0;
  const eligible = (summary?.candidates ?? 0) - outside;
  if (eligible > 0) {
    return {
      title: "You're all caught up",
      body: "You've seen everyone who fits your preferences for now. New people appear here as they join.",
      editProfile: false,
    };
  }
  if (outside > 0) {
    return {
      title: "No one in your age range yet",
      body: `${outside} ${outside === 1 ? "person is" : "people are"} outside your age range, or you're outside theirs. Widen your age range to see more people.`,
      editProfile: true,
    };
  }
  return {
    title: "No new people yet",
    body: "SOULMATE.AI is just getting started near you. New members appear here as they join, so check back soon.",
    editProfile: false,
  };
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
