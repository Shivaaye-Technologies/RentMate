import { describe, expect, it } from "vitest";
import { compatibility, isMutualAgeFit, rankMatches, type MatchProfile } from "../src/matching.js";

const base = (over: Partial<MatchProfile>): MatchProfile => ({
  id: "a",
  age: 28,
  interests: ["hiking", "music"],
  lookingFor: "relationship",
  ageMin: 24,
  ageMax: 35,
  ...over,
});

describe("isMutualAgeFit", () => {
  it("is true when both fall inside each other's ranges", () => {
    expect(isMutualAgeFit(base({}), base({ id: "b", age: 30 }))).toBe(true);
  });
  it("is false when one person is outside the other's range", () => {
    expect(isMutualAgeFit(base({}), base({ id: "b", age: 40 }))).toBe(false);
  });
});

describe("compatibility", () => {
  it("scores 100 for identical interests and goal", () => {
    expect(compatibility(base({}), base({ id: "b" })).score).toBe(100);
  });
  it("matches interests case-insensitively", () => {
    const r = compatibility(base({}), base({ id: "b", interests: ["HIKING", " Music "] }));
    expect(r.sharedInterests).toEqual(["hiking", "music"]);
  });
  it("gives 0 to yourself and to age mismatches", () => {
    expect(compatibility(base({}), base({})).score).toBe(0);
    expect(compatibility(base({}), base({ id: "b", age: 50 })).score).toBe(0);
  });
  it("gives only the interest component when goals differ", () => {
    expect(compatibility(base({}), base({ id: "b", lookingFor: "casual" })).score).toBe(60);
  });
});

describe("rankMatches", () => {
  it("sorts by score, drops zeros, and respects the limit", () => {
    const me = base({});
    const out = rankMatches(me, [
      base({ id: "low", interests: ["chess"], lookingFor: "casual" }),
      base({ id: "top" }),
      base({ id: "mid", interests: ["hiking"] }),
      base({ id: "old", age: 60 }),
    ]);
    expect(out.map((m) => m.id)).toEqual(["top", "mid"]);
    expect(rankMatches(me, [base({ id: "x" }), base({ id: "y" })], 1)).toHaveLength(1);
  });
});

describe("distance and online status", () => {
  it("computes distance between two cities", async () => {
    const { distanceKm } = await import("../src/matching.js");
    // Bengaluru to Mumbai is about 840 km.
    const d = distanceKm({ lat: 12.97, lng: 77.59 }, { lat: 19.08, lng: 72.88 })!;
    expect(d).toBeGreaterThan(820);
    expect(d).toBeLessThan(860);
  });

  it("shows at least 1 km and null when a location is missing", async () => {
    const { displayDistanceKm } = await import("../src/matching.js");
    expect(displayDistanceKm({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(1);
    expect(displayDistanceKm({ lat: 12.97, lng: 77.59 }, { lat: null, lng: 77.59 })).toBeNull();
  });

  it("treats people seen in the last 10 minutes as online", async () => {
    const { isOnline } = await import("../src/matching.js");
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(isOnline("2026-10-23T11:55:00Z", now)).toBe(true);
    expect(isOnline("2026-10-23T11:40:00Z", now)).toBe(false);
    expect(isOnline(undefined, now)).toBe(false);
  });
});
