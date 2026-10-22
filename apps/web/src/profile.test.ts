import { describe, expect, it } from "vitest";
import { filterPeople, personFromRow, type Person } from "./api";
import { fitWithin } from "./photo";
import {
  coarse,
  distanceKm,
  draftFromRow,
  initials,
  isNew,
  isOnline,
  orderedPair,
  otherUserId,
  parseInterests,
  validateProfile,
  type ProfileDraft,
  type ProfileRow,
} from "./profile";

const draft: ProfileDraft = {
  displayName: "Asha",
  age: "27",
  bio: "Chai and long walks",
  interests: "travel, Books, books",
  lookingFor: "friendship",
  ageMin: "24",
  ageMax: "34",
};

describe("profile validation", () => {
  it("accepts a valid profile and normalizes it", () => {
    const r = validateProfile(draft);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row).toEqual({
        display_name: "Asha",
        age: 27,
        bio: "Chai and long walks",
        interests: ["travel", "Books"],
        looking_for: "friendship",
        age_min: 24,
        age_max: 34,
      });
    }
  });

  it("blocks anyone under 18", () => {
    const r = validateProfile({ ...draft, age: "17" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.age).toMatch(/18/);
  });

  it("rejects bad names, ages and ranges", () => {
    const r = validateProfile({ ...draft, displayName: "A", age: "abc", ageMin: "40", ageMax: "30" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.displayName).toBeTruthy();
      expect(r.errors.age).toBeTruthy();
      expect(r.errors.ageMax).toBeTruthy();
    }
  });

  it("caps interests at 15", () => {
    const many = Array.from({ length: 16 }, (_, i) => `i${i}`).join(",");
    const r = validateProfile({ ...draft, interests: many });
    expect(r.ok).toBe(false);
  });

  it("parses interests with case-insensitive dedupe", () => {
    expect(parseInterests(" Hiking, music,, hiking ,MUSIC")).toEqual(["Hiking", "music"]);
  });

  it("round-trips a row into a draft", () => {
    const row: ProfileRow = {
      id: "u",
      display_name: "Asha",
      age: 27,
      bio: "",
      interests: ["a", "b"],
      looking_for: "casual",
      age_min: 20,
      age_max: 30,
    };
    expect(draftFromRow(row)).toMatchObject({ age: "27", interests: "a, b", lookingFor: "casual" });
    expect(draftFromRow(null).age).toBe("");
  });
});

describe("helpers", () => {
  it("finds the other person in an ordered match pair", () => {
    expect(otherUserId({ user_a: "a", user_b: "b" }, "a")).toBe("b");
    expect(otherUserId({ user_a: "a", user_b: "b" }, "b")).toBe("a");
    expect(orderedPair("z", "a")).toEqual(["a", "z"]);
  });

  it("builds initials", () => {
    expect(initials("Asha Rao")).toBe("AR");
    expect(initials("asha")).toBe("A");
    expect(initials("  ")).toBe("?");
  });

  it("rounds coordinates to about 1 km", () => {
    expect(coarse(12.971599)).toBe(12.97);
    expect(coarse(-77.594566)).toBe(-77.59);
  });

  it("computes distance like the API, as strings or numbers", () => {
    expect(distanceKm({ lat: "12.97", lng: "77.59" }, { lat: 19.08, lng: 72.88 })).toBeGreaterThan(820);
    expect(distanceKm({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(1);
    expect(distanceKm({ lat: null, lng: 1 }, { lat: 1, lng: 1 })).toBeNull();
  });

  it("knows who is online and who is new", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(isOnline("2026-10-23T11:52:00Z", now)).toBe(true);
    expect(isOnline("2026-10-23T11:00:00Z", now)).toBe(false);
    expect(isNew("2026-10-20T00:00:00Z", now)).toBe(true);
    expect(isNew("2026-09-01T00:00:00Z", now)).toBe(false);
    expect(isNew(null, now)).toBe(false);
  });

  it("scales photos down but never up", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1080, height: 810 });
    expect(fitWithin(600, 800)).toEqual({ width: 600, height: 800 });
  });
});

describe("discover filters", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const base: Person = {
    id: "x",
    score: 50,
    sharedInterests: [],
    displayName: "X",
    age: 25,
    bio: "",
    interests: [],
    lookingFor: "relationship",
    photoPath: null,
    verified: false,
    online: false,
    distanceKm: null,
    joinedAt: "2026-01-01T00:00:00Z",
  };
  const people: Person[] = [
    { ...base, id: "v", verified: true },
    { ...base, id: "o", online: true, lookingFor: "friendship" },
    { ...base, id: "n", joinedAt: "2026-10-22T00:00:00Z", lookingFor: "casual" },
  ];
  const ids = (list: Person[]) => list.map((p) => p.id);

  it("filters by quick filter", () => {
    expect(ids(filterPeople(people, "all", "any", now))).toEqual(["v", "o", "n"]);
    expect(ids(filterPeople(people, "verified", "any", now))).toEqual(["v"]);
    expect(ids(filterPeople(people, "online", "any", now))).toEqual(["o"]);
    expect(ids(filterPeople(people, "new", "any", now))).toEqual(["n"]);
  });

  it("filters by mood", () => {
    expect(ids(filterPeople(people, "all", "friendship", now))).toEqual(["o"]);
    expect(ids(filterPeople(people, "online", "casual", now))).toEqual([]);
  });

  it("builds a person from a profile row with distance from me", () => {
    const p = personFromRow(
      {
        id: "r",
        display_name: "Ravi",
        age: 30,
        bio: "",
        interests: ["cricket"],
        looking_for: "relationship",
        age_min: 25,
        age_max: 35,
        lat: "12.98",
        lng: "77.60",
        verified: true,
      },
      { lat: 12.97, lng: 77.59 },
    );
    // 0.01° lat + 0.01° lng near Bengaluru ≈ 1.5 km → rounds to 2.
    expect(p).toMatchObject({ displayName: "Ravi", verified: true, distanceKm: 2, photoPath: null });
  });
});
