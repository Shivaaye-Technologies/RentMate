import type { Person } from "./api";
import { INTEREST_CATEGORIES, interestKey } from "./interests";
import { isNew } from "./profile";

export type VibeKey =
  "new" | "shared" | "art" | "cinema" | "sport" | "explorers" | "food" | "music" | "roadtrips" | "local";

export interface Vibe {
  key: VibeKey;
  title: string;
  blurb: string;
  /** Why this card appears, from real data only. */
  why: string;
  tone: "lilac" | "green" | "yellow" | "sky" | "coral" | "sand";
  art: "spark" | "heart" | "brush" | "film" | "ball" | "compass" | "bowl" | "note" | "road" | "pin";
  people: Person[];
}

const group = (name: string) =>
  new Set((INTEREST_CATEGORIES.find((c) => c.name === name)?.items ?? []).map((i) => interestKey(i)));

const ART = group("Art and creativity");
const CINEMA = group("Movies and TV");
const SPORT = group("Sport and fitness");
const FOOD = group("Food and drinks");
const MUSIC = group("Music");
const EXPLORE = new Set([...group("Travel"), ...group("Outdoors")]);
const ROAD = new Set([interestKey("Road trips")]);

const hasAny = (interests: string[], set: Set<string>) => interests.some((i) => set.has(interestKey(i)));
const firstIn = (interests: string[], set: Set<string>) => interests.find((i) => set.has(interestKey(i)));

/**
 * Vibe cards built from the people you can actually see in Discover. The
 * "why" line only mentions your interests or city when you really have them.
 */
export function buildVibes(
  people: Person[],
  me: { interests: string[]; city: string | null },
  now = Date.now(),
): Vibe[] {
  const mine = me.interests;
  const because = (set: Set<string>, fallback: string) => {
    const hit = firstIn(mine, set);
    return hit ? `Because you like ${hit}` : fallback;
  };
  const interestVibe = (
    key: VibeKey,
    title: string,
    blurb: string,
    set: Set<string>,
    tone: Vibe["tone"],
    art: Vibe["art"],
    fallback: string,
  ): Vibe => ({
    key,
    title,
    blurb,
    why: because(set, fallback),
    tone,
    art,
    people: people.filter((p) => hasAny(p.interests, set)),
  });

  const city = me.city?.trim() || null;
  const vibes: Vibe[] = [
    {
      key: "new",
      title: "New profiles",
      blurb: "Members who joined in the last week.",
      why: "Joined in the last 7 days",
      tone: "yellow",
      art: "spark",
      people: people.filter((p) => isNew(p.joinedAt, now)),
    },
    {
      key: "shared",
      title: "Shared interests",
      blurb: "People who love some of the same things you do.",
      why:
        mine.length > 0 ? "Based on the interests on your profile" : "Add interests to see who shares them",
      tone: "lilac",
      art: "heart",
      people: people.filter((p) => p.sharedInterests.length > 0),
    },
    interestVibe(
      "art",
      "Art lovers",
      "Galleries, sketchbooks and photo walks.",
      ART,
      "coral",
      "brush",
      "Members into art and creativity",
    ),
    interestVibe(
      "cinema",
      "Cinephiles",
      "Movie nights and binge-worthy series.",
      CINEMA,
      "sky",
      "film",
      "Members into movies and TV",
    ),
    interestVibe(
      "sport",
      "Sport zone",
      "Runs, matches and morning yoga.",
      SPORT,
      "green",
      "ball",
      "Members into sport and fitness",
    ),
    interestVibe(
      "explorers",
      "Explorers",
      "Trails, beaches and new places.",
      EXPLORE,
      "sand",
      "compass",
      "Members who love to explore",
    ),
    interestVibe(
      "food",
      "Food lovers",
      "Street food, baking and good coffee.",
      FOOD,
      "yellow",
      "bowl",
      "Members into food and drinks",
    ),
    interestVibe(
      "music",
      "Music lovers",
      "Gigs, playlists and karaoke nights.",
      MUSIC,
      "lilac",
      "note",
      "Members into music",
    ),
    interestVibe(
      "roadtrips",
      "Road trip fans",
      "Window seat, good playlist, long drive.",
      ROAD,
      "coral",
      "road",
      "Members who love road trips",
    ),
    {
      key: "local",
      title: "Local community",
      blurb: city ? `Members who live in ${city}.` : "Members in your city.",
      why: city ? `People in ${city}` : "Add your city to see people near you",
      tone: "green",
      art: "pin",
      people: city ? people.filter((p) => p.details.city?.trim().toLowerCase() === city.toLowerCase()) : [],
    },
  ];
  return vibes;
}
