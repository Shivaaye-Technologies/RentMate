import { interestKey } from "./interests.js";

export interface MatchProfile {
  id: string;
  displayName?: string;
  bio?: string;
  photoPath?: string | null;
  lat?: number | null;
  lng?: number | null;
  lastSeenAt?: string;
  joinedAt?: string;
  verified?: boolean;
  /** Precomputed by the database for other people (coarse bucket). */
  distanceKm?: number | null;
  /** Precomputed by the database for other people. */
  online?: boolean;
  /** Optional public profile details, passed through unchanged (never used for eligibility). */
  details?: Record<string, unknown> | null;
  /** Extra photo paths, passed through unchanged. */
  photos?: string[];
  age: number;
  interests: string[];
  lookingFor: "relationship" | "friendship" | "casual";
  ageMin: number;
  ageMax: number;
}

export interface ScoredMatch {
  id: string;
  score: number;
  sharedInterests: string[];
}

/** Case-insensitive, with common spellings resolved ("hike" = "Hiking"). Ranking only. */
const normalize = (s: string) => interestKey(s);

/** True when each person falls inside the other's preferred age range. */
export function isMutualAgeFit(a: MatchProfile, b: MatchProfile): boolean {
  return a.age >= b.ageMin && a.age <= b.ageMax && b.age >= a.ageMin && b.age <= a.ageMax;
}

/**
 * Compatibility score from 0 to 100.
 * - 60 points: interest overlap (Jaccard similarity)
 * - 40 points: same relationship goal
 * Returns 0 when the pair is not a mutual age fit.
 */
export function compatibility(a: MatchProfile, b: MatchProfile): ScoredMatch {
  if (a.id === b.id || !isMutualAgeFit(a, b)) {
    return { id: b.id, score: 0, sharedInterests: [] };
  }
  const setA = new Set(a.interests.map(normalize));
  const setB = new Set(b.interests.map(normalize));
  const shared = [...setA].filter((i) => setB.has(i));
  const union = new Set([...setA, ...setB]).size;
  const interestScore = union === 0 ? 0 : (shared.length / union) * 60;
  const goalScore = a.lookingFor === b.lookingFor ? 40 : 0;
  return {
    id: b.id,
    score: Math.round(interestScore + goalScore),
    sharedInterests: shared.sort(),
  };
}

type Point = { lat?: number | null; lng?: number | null };

/** Great-circle distance in km, or null when either location is unknown. */
export function distanceKm(a: Point, b: Point): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Distance shown to users: whole km, never below 1 (locations are only ~1 km precise). */
export function displayDistanceKm(a: Point, b: Point): number | null {
  const d = distanceKm(a, b);
  return d == null ? null : Math.max(1, Math.round(d));
}

export const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export function isOnline(lastSeenAt: string | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) && now - t <= ONLINE_WINDOW_MS;
}

/** Removes candidates the user already liked or passed on. */
export function excludeSeen<T extends { id: string }>(candidates: T[], seenIds: Iterable<string>): T[] {
  const seen = new Set(seenIds);
  return candidates.filter((c) => !seen.has(c.id));
}

/**
 * Who may appear in Discover: anyone else whose age fits both people's
 * preferred ranges. The score only orders people; a score of 0 (no shared
 * interests and a different goal) must not hide someone, or a small
 * community shows an empty Discover even though eligible people exist.
 */
export function isEligible(user: MatchProfile, candidate: MatchProfile): boolean {
  return user.id !== candidate.id && isMutualAgeFit(user, candidate);
}

export const DEFAULT_MATCH_LIMIT = 100;

/** Ranks eligible candidates for a user, highest score first. */
export function rankMatches(
  user: MatchProfile,
  candidates: MatchProfile[],
  limit = DEFAULT_MATCH_LIMIT,
): ScoredMatch[] {
  return candidates
    .filter((c) => isEligible(user, c))
    .map((c) => compatibility(user, c))
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
    .slice(0, limit);
}

/** Why Discover may be empty: how many people exist and how many fit age preferences. */
export interface DiscoverSummary {
  /** People not yet liked, passed or blocked. */
  candidates: number;
  /** Of those, how many are outside your age range or you are outside theirs. */
  outsideAgeRange: number;
}

export function summarize(user: MatchProfile, candidates: MatchProfile[]): DiscoverSummary {
  const others = candidates.filter((c) => c.id !== user.id);
  return {
    candidates: others.length,
    outsideAgeRange: others.filter((c) => !isMutualAgeFit(user, c)).length,
  };
}
