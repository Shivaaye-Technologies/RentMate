import { describe, expect, it } from "vitest";
import { loadDemoPeople } from "./data";

const row = {
  id: "d1",
  display_name: "Aanya",
  age: 24,
  bio: "Fictional",
  interests: null,
  looking_for: "friendship",
  photo_path: "demo/avatars/001.svg",
  verified: true,
  created_at: "2026-10-23T00:00:00Z",
  distance_km: 4,
  online: true,
};

describe("loadDemoPeople", () => {
  it("asks the database for demo profiles and maps them to cards", async () => {
    let called = "";
    const people = await loadDemoPeople(async (fn, args) => {
      called = `${fn}:${args.p_limit}`;
      return { data: [row], error: null };
    });
    expect(called).toBe("demo_mode_profiles:500");
    expect(people[0]).toMatchObject({
      id: "d1",
      displayName: "Aanya",
      interests: [],
      distanceKm: 4,
      online: true,
    });
  });

  it("shows database, network and response errors instead of an empty demo", async () => {
    await expect(loadDemoPeople(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow(
      /Could not load demo profiles: boom/,
    );
    await expect(
      loadDemoPeople(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).rejects.toThrow(/Can't reach SOULMATE.AI/);
    await expect(loadDemoPeople(async () => ({ data: { nope: 1 }, error: null }))).rejects.toThrow(
      /unexpected/,
    );
  });
});
