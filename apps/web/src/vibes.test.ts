import { describe, expect, it } from "vitest";
import type { Person } from "./api";
import { EMPTY_DETAILS } from "./details";
import { buildVibes } from "./vibes";

const now = Date.parse("2026-10-24T12:00:00Z");
const p = (id: string, interests: string[], extra: Partial<Person> = {}): Person => ({
  id,
  score: 0,
  sharedInterests: [],
  displayName: id,
  age: 28,
  bio: "",
  interests,
  lookingFor: "relationship",
  photoPath: null,
  verified: false,
  online: false,
  distanceKm: null,
  joinedAt: "2026-01-01T00:00:00Z",
  details: EMPTY_DETAILS,
  photos: [],
  ...extra,
});

describe("buildVibes", () => {
  const people = [
    p("a", ["Movies", "hike"], { joinedAt: "2026-10-22T00:00:00Z", sharedInterests: ["movies"] }),
    p("b", ["Running"], { details: { ...EMPTY_DETAILS, city: "Pune" } }),
    p("c", ["Road trips"]),
  ];

  it("only says 'because you like' when you really have that interest", () => {
    const withInterest = buildVibes(people, { interests: ["Anime"], city: null }, now);
    expect(withInterest.find((v) => v.key === "cinema")?.why).toBe("Because you like Anime");
    expect(withInterest.find((v) => v.key === "sport")?.why).toBe("Members into sport and fitness");
  });

  it("groups real people, resolving spellings", () => {
    const v = buildVibes(people, { interests: [], city: null }, now);
    const ids = (k: string) => v.find((x) => x.key === k)!.people.map((x) => x.id);
    expect(ids("new")).toEqual(["a"]);
    expect(ids("explorers")).toEqual(["a", "c"]);
    expect(ids("sport")).toEqual(["b"]);
    expect(ids("roadtrips")).toEqual(["c"]);
    expect(ids("shared")).toEqual(["a"]);
  });

  it("uses your city only when you added one", () => {
    expect(
      buildVibes(people, { interests: [], city: null }, now).find((v) => v.key === "local"),
    ).toMatchObject({
      why: "Add your city to see people near you",
      people: [],
    });
    const local = buildVibes(people, { interests: [], city: " pune " }, now).find((v) => v.key === "local")!;
    expect(local.people.map((x) => x.id)).toEqual(["b"]);
  });

  it("returns empty groups honestly when nobody fits", () => {
    const v = buildVibes([], { interests: ["Art"], city: "Pune" }, now);
    expect(v.every((x) => x.people.length === 0)).toBe(true);
  });
});
