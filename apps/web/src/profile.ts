export type LookingFor = "relationship" | "friendship" | "casual";

/** "I'm here for" labels. */
export const LOOKING_FOR_LABELS: Record<LookingFor, string> = {
  relationship: "A relationship",
  friendship: "Friendship",
  casual: "Nothing serious",
};

/** Row shape of public.profiles that the web app reads. */
export interface ProfileRow {
  id: string;
  display_name: string;
  age: number;
  bio: string;
  interests: string[];
  looking_for: LookingFor;
  age_min: number;
  age_max: number;
  photo_path?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  last_seen_at?: string;
  created_at?: string;
  verified?: boolean;
}

export const PROFILE_COLUMNS =
  "id, display_name, age, bio, interests, looking_for, age_min, age_max, photo_path, lat, lng, last_seen_at, created_at, verified";

/** The columns a user is allowed to write (matches the database column grants). */
export type EditableProfile = Pick<
  ProfileRow,
  "display_name" | "age" | "bio" | "interests" | "looking_for" | "age_min" | "age_max"
>;

/** Form state: numbers are strings while the user types. */
export interface ProfileDraft {
  displayName: string;
  age: string;
  bio: string;
  interests: string;
  lookingFor: LookingFor;
  ageMin: string;
  ageMax: string;
}

export type DraftErrors = Partial<Record<keyof ProfileDraft, string>>;

export const MAX_INTERESTS = 15;

/** Splits "Hiking, music,  hiking" into ["Hiking", "music"] (trimmed, case-insensitive dedupe). */
export function parseInterests(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const item = raw.trim().slice(0, 30);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** Mirrors the API's zod rules and the database constraints, including 18+. */
export function validateProfile(
  d: ProfileDraft,
): { ok: true; row: EditableProfile } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const name = d.displayName.trim();
  const age = toInt(d.age);
  const ageMin = toInt(d.ageMin);
  const ageMax = toInt(d.ageMax);
  const interests = parseInterests(d.interests);
  const bio = d.bio.trim();

  if (name.length < 2 || name.length > 40) errors.displayName = "Use 2 to 40 characters.";
  if (Number.isNaN(age)) errors.age = "Enter your age as a number.";
  else if (age < 18) errors.age = "You must be 18 or older to join.";
  else if (age > 100) errors.age = "Enter a real age.";
  if (bio.length > 500) errors.bio = "Keep your bio under 500 characters.";
  if (interests.length > MAX_INTERESTS) errors.interests = `Pick up to ${MAX_INTERESTS} interests.`;
  if (Number.isNaN(ageMin) || ageMin < 18 || ageMin > 100) errors.ageMin = "18 to 100.";
  if (Number.isNaN(ageMax) || ageMax < 18 || ageMax > 100) errors.ageMax = "18 to 100.";
  if (!errors.ageMin && !errors.ageMax && ageMin > ageMax) errors.ageMax = "Must be at least the minimum.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    row: {
      display_name: name,
      age,
      bio,
      interests,
      looking_for: d.lookingFor,
      age_min: ageMin,
      age_max: ageMax,
    },
  };
}

export function draftFromRow(row: ProfileRow | null): ProfileDraft {
  if (!row) {
    return {
      displayName: "",
      age: "",
      bio: "",
      interests: "",
      lookingFor: "relationship",
      ageMin: "21",
      ageMax: "35",
    };
  }
  return {
    displayName: row.display_name,
    age: String(row.age),
    bio: row.bio,
    interests: row.interests.join(", "),
    lookingFor: row.looking_for,
    ageMin: String(row.age_min),
    ageMax: String(row.age_max),
  };
}

/** Matches store the pair ordered (user_a < user_b); returns the other person. */
export function otherUserId(match: { user_a: string; user_b: string }, me: string): string {
  return match.user_a === me ? match.user_b : match.user_a;
}

/** Same ordering the database uses for the matches table. */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Stable hue from an id so each person keeps the same placeholder color. */
export function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** Round a coordinate to 2 decimals (about 1 km) before it ever leaves the device. */
export function coarse(n: number): number {
  return Math.round(n * 100) / 100;
}

type Point = { lat?: number | string | null; lng?: number | string | null };

/** Whole-km distance (minimum 1), or null when a location is unknown. Matches the API. */
export function distanceKm(a: Point, b: Point): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const [lat1, lng1, lat2, lng2] = [a.lat, a.lng, b.lat, b.lng].map(Number);
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.max(1, Math.round(2 * 6371 * Math.asin(Math.sqrt(h))));
}

export const ONLINE_WINDOW_MS = 10 * 60 * 1000;

export function isOnline(lastSeenAt: string | undefined | null, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  return Number.isFinite(t) && now - t <= ONLINE_WINDOW_MS;
}

/** Joined within the last 7 days. */
export function isNew(joinedAt: string | undefined | null, now = Date.now()): boolean {
  if (!joinedAt) return false;
  const t = Date.parse(joinedAt);
  return Number.isFinite(t) && now - t <= 7 * 24 * 60 * 60 * 1000;
}

/** "Your story began on 6 February". */
export function storyDate(iso: string, locale?: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long" });
}
