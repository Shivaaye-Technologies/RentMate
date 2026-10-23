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

const normalize = (s: string) => s.trim().toLowerCase();

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

/** Ranks candidates for a user, dropping zero scores, highest first. */
export function rankMatches(user: MatchProfile, candidates: MatchProfile[], limit = 20): ScoredMatch[] {
  return candidates
    .map((c) => compatibility(user, c))
    .filter((m) => m.score > 0)
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
    .slice(0, limit);
}
