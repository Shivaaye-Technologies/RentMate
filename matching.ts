export interface MatchProfile {
  id: string;
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

/** Ranks candidates for a user, dropping zero scores, highest first. */
export function rankMatches(user: MatchProfile, candidates: MatchProfile[], limit = 20): ScoredMatch[] {
  return candidates
    .map((c) => compatibility(user, c))
    .filter((m) => m.score > 0)
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))
    .slice(0, limit);
}
