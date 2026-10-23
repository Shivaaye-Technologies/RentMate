import { canonicalInterest, interestKey } from "./interests";
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

/**
 * Another person, from public.discover_profiles() / public.profiles_by_ids().
 * The database never returns other people's coordinates or last-seen times,
 * only a coarse distance bucket and an online flag.
 */
export interface PersonRow {
  id: string;
  display_name: string;
  age: number;
  bio: string;
  interests: string[] | null;
  looking_for: LookingFor;
  photo_path: string | null;
  verified: boolean;
  created_at: string;
  distance_km: number | null;
  online: boolean;
}

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

/** Removes duplicates by standard spelling, keeping the first. */
export function dedupeInterests(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = interestKey(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
  // Standard spellings ("hike" -> "Hiking") so people's interests line up.
  const interests = dedupeInterests(parseInterests(d.interests).map(canonicalInterest));
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

/** Demo profile portraits ship with the website (public/demo/avatars). */
const DEMO_PHOTO = /^demo\/avatars\/\d{3}\.svg$/;

/** Site URL for a demo portrait path, or null for any other path (normal photos are private). */
export function demoPhotoUrl(path: string | null | undefined, base = "/"): string | null {
  if (!path || !DEMO_PHOTO.test(path)) return null;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

/** Profile fields each onboarding step asks for (errors are shown per step). */
export const STEP_FIELDS: Record<"basics" | "goals" | "interests" | "about", (keyof ProfileDraft)[]> = {
  basics: ["displayName", "age"],
  goals: ["lookingFor", "ageMin", "ageMax"],
  interests: ["interests"],
  about: ["bio"],
};

/** Validation errors for just these fields (the full check runs before saving). */
export function stepErrors(d: ProfileDraft, fields: (keyof ProfileDraft)[]): DraftErrors {
  const result = validateProfile(d);
  if (result.ok) return {};
  const out: DraftErrors = {};
  for (const f of fields) if (result.errors[f]) out[f] = result.errors[f];
  return out;
}

export interface StrengthItem {
  key: "basics" | "photo" | "bio" | "interests" | "location";
  label: string;
  done: boolean;
  hint: string;
}

/** How complete a profile is. Only real fields you can fill in yourself. */
export function profileStrength(
  p: Pick<ProfileRow, "display_name" | "age" | "bio" | "interests" | "photo_path" | "lat" | "lng">,
): {
  score: number;
  total: number;
  items: StrengthItem[];
} {
  const items: StrengthItem[] = [
    { key: "basics", label: "Name and age", done: !!p.display_name && p.age >= 18, hint: "" },
    {
      key: "photo",
      label: "A photo",
      done: !!p.photo_path,
      hint: "Profiles with a photo get far more likes.",
    },
    {
      key: "bio",
      label: "A short bio",
      done: (p.bio ?? "").trim().length >= 40,
      hint: "A couple of sentences gives people something to reply to.",
    },
    {
      key: "interests",
      label: "3 or more interests",
      done: (p.interests ?? []).length >= 3,
      hint: "Shared interests decide who you see first.",
    },
    {
      key: "location",
      label: "Approximate location",
      done: p.lat != null && p.lng != null,
      hint: "Shows distance (about 1 km). Your exact location is never shared.",
    },
  ];
  return { score: items.filter((i) => i.done).length, total: items.length, items };
}

/** Starters for the bio, so a blank box is less daunting. */
export const BIO_PROMPTS = [
  "A perfect weekend for me is ",
  "I'm happiest when ",
  "Ask me about ",
  "Looking for someone who ",
] as const;
