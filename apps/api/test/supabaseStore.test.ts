import { describe, expect, it } from "vitest";
import { excludeSeen } from "../src/matching.js";
import { personToMatchProfile, toMatchProfile, toProfileRow, type ProfileRow } from "../src/supabaseStore.js";

const row: ProfileRow = {
  id: "u1",
  display_name: "Asha",
  age: 27,
  bio: "Chai and long walks",
  interests: ["travel", "books"],
  looking_for: "relationship",
  age_min: 25,
  age_max: 33,
};

describe("Supabase row mapping", () => {
  it("maps a database row to a match profile", () => {
    expect(toMatchProfile(row)).toEqual({
      id: "u1",
      displayName: "Asha",
      bio: "Chai and long walks",
      age: 27,
      interests: ["travel", "books"],
      lookingFor: "relationship",
      ageMin: 25,
      ageMax: 33,
      photoPath: null,
      lat: null,
      lng: null,
      verified: false,
    });
  });

  it("converts numeric strings from Postgres and keeps photo and status fields", () => {
    const p = toMatchProfile({
      ...row,
      photo_path: "u1/a.jpg",
      lat: "12.97",
      lng: "77.59",
      last_seen_at: "2026-10-23T00:00:00Z",
      created_at: "2026-10-01T00:00:00Z",
      verified: true,
    });
    expect(p).toMatchObject({
      photoPath: "u1/a.jpg",
      lat: 12.97,
      lng: 77.59,
      lastSeenAt: "2026-10-23T00:00:00Z",
      joinedAt: "2026-10-01T00:00:00Z",
      verified: true,
    });
  });

  it("round-trips profile input to a row", () => {
    const back = toProfileRow("u1", {
      displayName: "Asha",
      age: 27,
      bio: "Chai and long walks",
      interests: ["travel", "books"],
      lookingFor: "relationship",
      ageMin: 25,
      ageMax: 33,
    });
    expect(back).toEqual(row);
  });

  it("treats null interests as empty", () => {
    expect(toMatchProfile({ ...row, interests: null as unknown as string[] }).interests).toEqual([]);
  });
});

describe("excludeSeen", () => {
  it("drops liked or passed ids and keeps order", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(excludeSeen(list, ["b"])).toEqual([{ id: "a" }, { id: "c" }]);
    expect(excludeSeen(list, [])).toEqual(list);
  });
});

describe("people from the database", () => {
  it("keeps the precomputed distance and online flag and has no coordinates", () => {
    const p = personToMatchProfile({
      id: "u2",
      display_name: "Ravi",
      age: 30,
      bio: "",
      interests: null,
      looking_for: "friendship",
      age_min: 25,
      age_max: 35,
      photo_path: null,
      verified: false,
      created_at: "2026-10-01T00:00:00Z",
      distance_km: 15,
      online: true,
    });
    expect(p).toMatchObject({
      id: "u2",
      interests: [],
      distanceKm: 15,
      online: true,
      joinedAt: "2026-10-01T00:00:00Z",
    });
    expect(p.lat).toBeUndefined();
    expect(p.lastSeenAt).toBeUndefined();
  });
});
