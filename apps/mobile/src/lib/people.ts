/**
 * People as the Android screens show them: one shape for Discover (API) and for likes, matches and chats
 * (public.profiles_by_ids), the facts listed on a profile card, interest-based Vibes, and a small in-memory cache so
 * opening a profile from Discover needs no second request. Distances are the coarse buckets the database returns;
 * nobody's exact location is ever available here.
 */
import {
  allPhotos,
  CHILDREN_LABELS,
  detailsFromRow,
  EDUCATION_LABELS,
  EXERCISE_LABELS,
  GENDER_LABELS,
  heightLabel,
  INTEREST_CATEGORIES,
  interestKey,
  isNew,
  LOOKING_FOR_LABELS,
  SMOKING_LABELS,
  type DetailFields,
  type LookingFor,
  type PersonRow,
} from "./shared";

export type Person = {
  id: string;
  displayName: string;
  age: number;
  bio: string;
  interests: string[];
  sharedInterests: string[];
  lookingFor: LookingFor;
  photoPath: string | null;
  photos: string[];
  verified: boolean;
  online: boolean;
  distanceKm: number | null;
  joinedAt: string | null;
  details: DetailFields;
};

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const lookingFor = (v: unknown): LookingFor =>
  v === "relationship" || v === "friendship" || v === "casual" ? v : "friendship";

/** From GET /api/v1/matches (camelCase). Tolerates older responses without details or photos. */
export function personFromApi(raw: Record<string, unknown>): Person {
  const main = typeof raw.photoPath === "string" ? raw.photoPath : null;
  return {
    id: String(raw.id),
    displayName: typeof raw.displayName === "string" ? raw.displayName : "",
    age: Number(raw.age) || 18,
    bio: typeof raw.bio === "string" ? raw.bio : "",
    interests: strings(raw.interests),
    sharedInterests: strings(raw.sharedInterests),
    lookingFor: lookingFor(raw.lookingFor),
    photoPath: main,
    photos: strings(raw.photos).filter((p) => p !== main),
    verified: raw.verified === true,
    online: raw.online === true,
    distanceKm: typeof raw.distanceKm === "number" ? raw.distanceKm : null,
    joinedAt: typeof raw.joinedAt === "string" ? raw.joinedAt : null,
    details: detailsFromRow((raw.details ?? null) as Parameters<typeof detailsFromRow>[0]),
  };
}

/** From public.profiles_by_ids / discover_profiles (snake_case rows). */
export function personFromRow(row: PersonRow): Person {
  return {
    id: row.id,
    displayName: row.display_name,
    age: row.age,
    bio: row.bio ?? "",
    interests: row.interests ?? [],
    sharedInterests: [],
    lookingFor: lookingFor(row.looking_for),
    photoPath: row.photo_path ?? null,
    photos: (row.photos ?? []).filter((p) => p !== row.photo_path),
    verified: row.verified ?? false,
    online: row.online ?? false,
    distanceKm: row.distance_km ?? null,
    joinedAt: row.created_at ?? null,
    details: detailsFromRow(row as unknown as Parameters<typeof detailsFromRow>[0]),
  };
}

/** Every photo path, main photo first. */
export const photoList = (p: Pick<Person, "photoPath" | "photos">) =>
  allPhotos({ photo_path: p.photoPath, photos: p.photos });

/** "9 km away" from the database's coarse bucket. */
export function distanceText(km: number | null): string | null {
  if (km === null || !Number.isFinite(km)) return null;
  if (km < 1) return "Less than 1 km away";
  return `${Math.round(km)} km away`;
}

export const activityText = (p: Pick<Person, "online">) => (p.online ? "Active now" : null);

export type Fact = { glyph: string; text: string };

/** Facts for the profile card, only for what the person filled in (never invented). */
export function factsFor(p: Person): Fact[] {
  const d = p.details;
  const out: Fact[] = [];
  if (d.city) out.push({ glyph: "🏠", text: d.city });
  const dist = distanceText(p.distanceKm);
  if (dist) out.push({ glyph: "📍", text: dist });
  if (d.gender) out.push({ glyph: "👤", text: GENDER_LABELS[d.gender] });
  if (d.height_cm) out.push({ glyph: "📏", text: heightLabel(d.height_cm) });
  if (d.job) out.push({ glyph: "💼", text: d.job });
  if (d.education) out.push({ glyph: "🎓", text: EDUCATION_LABELS[d.education] });
  if (d.exercise) out.push({ glyph: "👟", text: `Exercise: ${EXERCISE_LABELS[d.exercise].toLowerCase()}` });
  if (d.smoking) out.push({ glyph: "🚭", text: SMOKING_LABELS[d.smoking] });
  if (d.children) out.push({ glyph: "🍼", text: CHILDREN_LABELS[d.children] });
  return out;
}

export const lookingForText = (p: Pick<Person, "lookingFor">) => LOOKING_FOR_LABELS[p.lookingFor];

// ---------- Vibes ----------

export type VibeTone = "sky" | "lilac" | "coral" | "periwinkle" | "sand" | "mint";
export type Vibe = { key: string; title: string; why: string; tone: VibeTone; art: string; people: Person[] };

const GROUPS: { key: string; title: string; category: string[]; tone: VibeTone; art: string }[] = [
  { key: "cinema", title: "Cinephiles", category: ["Movies and TV"], tone: "sky", art: "🎬🍿🎞️" },
  { key: "food", title: "Food lovers", category: ["Food and drinks"], tone: "periwinkle", art: "🍕🥘☕" },
  { key: "sport", title: "Sport zone", category: ["Sport and fitness"], tone: "coral", art: "🏏🎾👟" },
  { key: "art", title: "Art lovers", category: ["Art and creativity"], tone: "sky", art: "🎨📷🏺" },
  { key: "music", title: "Music fans", category: ["Music"], tone: "lilac", art: "🎧🎸🎤" },
  { key: "explore", title: "Explorers", category: ["Travel", "Outdoors"], tone: "mint", art: "🧭⛰️🗺️" },
];

const keysFor = (names: string[]) =>
  new Set(
    INTEREST_CATEGORIES.filter((c) => names.includes(c.name)).flatMap((c) =>
      c.items.map((i) => interestKey(i)),
    ),
  );

/**
 * Vibe cards from the people you can actually see. "Why" lines only cite your real interests or city. Cards with no
 * people are left out, so nothing is shown that leads nowhere.
 */
export function buildVibes(
  people: Person[],
  me: { interests: string[]; city: string | null },
  now = Date.now(),
): Vibe[] {
  const out: Vibe[] = [];
  const city = me.city?.trim() || null;
  if (city) {
    const locals = people.filter((p) => p.details.city?.trim().toLowerCase() === city.toLowerCase());
    out.push({
      key: "local",
      title: "They live in your city",
      why: `Because you live in ${city}`,
      tone: "lilac",
      art: "🔑🏙️🪑",
      people: locals,
    });
  }
  const nearby = people.filter((p) => p.distanceKm !== null && p.distanceKm <= 10);
  out.push({
    key: "nearby",
    title: "Close to you",
    why: "Within about 10 km",
    tone: "lilac",
    art: "🚲🚇🛵",
    people: nearby,
  });
  out.push({
    key: "new",
    title: "New faces",
    why: "Joined in the last 7 days",
    tone: "sand",
    art: "✨👋🌱",
    people: people.filter((p) => isNew(p.joinedAt, now)),
  });
  for (const g of GROUPS) {
    const set = keysFor(g.category);
    const mine = me.interests.find((i) => set.has(interestKey(i)));
    out.push({
      key: g.key,
      title: g.title,
      why: mine ? `Because you like: ${mine}` : `Members into ${g.category.join(" and ").toLowerCase()}`,
      tone: g.tone,
      art: g.art,
      people: people.filter((p) => p.interests.some((i) => set.has(interestKey(i)))),
    });
  }
  return out.filter((v) => v.people.length > 0);
}

/** Why Vibes is empty, from real data only: an empty feed, missing profile details, or no overlap. */
export function vibesEmptyReason(
  feedCount: number,
  me: { interests: string[]; city: string | null },
): { kind: "no-feed" | "no-details" | "no-overlap"; text: string } {
  if (feedCount === 0)
    return {
      kind: "no-feed",
      text: "Nobody is in your Discover feed right now, so there is no one to group into Vibes. Try wider preferences or check back later.",
    };
  const missing = [me.interests.length === 0 ? "hobbies" : null, me.city?.trim() ? null : "your city"].filter(
    Boolean,
  );
  if (missing.length)
    return {
      kind: "no-details",
      text: `Add ${missing.join(" and ")} to your profile so Vibes can group people around what you share.`,
    };
  return {
    kind: "no-overlap",
    text: "Nobody in your feed shares these vibes yet. Check back as more people join.",
  };
}

// ---------- Cache ----------

const cache = new Map<string, Person>();
export function rememberPeople(list: Person[]) {
  for (const p of list) cache.set(p.id, p);
}
export const cachedPerson = (id: string) => cache.get(id) ?? null;
export const cachedPeople = () => [...cache.values()];
