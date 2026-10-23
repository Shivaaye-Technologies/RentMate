// Standard interests and common spellings. This file is duplicated byte-for-byte
// in apps/api/src and apps/web/src (a test checks they match): the website shows
// these as tap-to-pick chips, and the API uses the aliases when comparing
// interests, so "hike" and "Hiking" count as the same interest. Aliases only
// affect ranking (shared interests); they never change who is eligible.

export const STANDARD_INTERESTS = [
  "Art",
  "Baking",
  "Board games",
  "Books",
  "Cats",
  "Coffee",
  "Cooking",
  "Cricket",
  "Cycling",
  "Dancing",
  "Dogs",
  "Fashion",
  "Fitness",
  "Football",
  "Gaming",
  "Gardening",
  "Hiking",
  "Live music",
  "Movies",
  "Music",
  "Photography",
  "Poetry",
  "Road trips",
  "Running",
  "Stand-up comedy",
  "Startups",
  "Street food",
  "Swimming",
  "Tech",
  "Travel",
  "Yoga",
  "Anime",
] as const;

/** Lower-case spellings people type, mapped to a standard interest. */
export const INTEREST_ALIASES: Readonly<Record<string, string>> = {
  hike: "Hiking",
  hikes: "Hiking",
  trekking: "Hiking",
  trek: "Hiking",
  treks: "Hiking",
  travelling: "Travel",
  traveling: "Travel",
  travels: "Travel",
  trips: "Travel",
  "road trip": "Road trips",
  roadtrips: "Road trips",
  movie: "Movies",
  films: "Movies",
  film: "Movies",
  cinema: "Movies",
  gym: "Fitness",
  workout: "Fitness",
  workouts: "Fitness",
  "working out": "Fitness",
  book: "Books",
  reading: "Books",
  read: "Books",
  games: "Gaming",
  "video games": "Gaming",
  "board game": "Board games",
  dog: "Dogs",
  cat: "Cats",
  photos: "Photography",
  "live gigs": "Live music",
  concerts: "Live music",
  gigs: "Live music",
  songs: "Music",
  singing: "Music",
  dance: "Dancing",
  run: "Running",
  jogging: "Running",
  swim: "Swimming",
  cycle: "Cycling",
  biking: "Cycling",
  cook: "Cooking",
  bake: "Baking",
  foodie: "Street food",
  comedy: "Stand-up comedy",
  standup: "Stand-up comedy",
  "stand up comedy": "Stand-up comedy",
  startup: "Startups",
  technology: "Tech",
  coding: "Tech",
  poems: "Poetry",
  garden: "Gardening",
  plants: "Gardening",
  "street-food": "Street food",
};

const STANDARD_BY_LOWER = new Map(STANDARD_INTERESTS.map((i) => [i.toLowerCase(), i as string]));

/** The standard spelling for an interest, or the trimmed input when it is not a known one. */
export function canonicalInterest(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const key = text.toLowerCase();
  return STANDARD_BY_LOWER.get(key) ?? INTEREST_ALIASES[key] ?? text;
}

/** Key used to compare interests (case-insensitive, aliases resolved). */
export function interestKey(raw: string): string {
  return canonicalInterest(raw).toLowerCase();
}
