import { describe, expect, it } from "vitest";
import {
  buildVibes,
  distanceText,
  factsFor,
  personFromApi,
  personFromRow,
  photoList,
  type Person,
} from "../lib/people";
import { profileStrength, type PersonRow, type ProfileRow } from "../lib/shared";

const base = (over: Partial<Person> = {}): Person => ({
  ...personFromApi({ id: "p1", displayName: "Asha", age: 27, interests: [] }),
  ...over,
});

describe("people", () => {
  it("normalises API people, tolerating missing details and duplicate photos", () => {
    const p = personFromApi({
      id: "a",
      displayName: "Asha",
      age: 27,
      photoPath: "a/1.jpg",
      photos: ["a/1.jpg", "a/2.jpg", 5],
      lookingFor: "nonsense",
      details: { city: "Noida", height_cm: 161 },
    });
    expect(photoList(p)).toEqual(["a/1.jpg", "a/2.jpg"]);
    expect(p.lookingFor).toBe("friendship");
    expect(p.details.city).toBe("Noida");
    expect(p.details.height_cm).toBe(161);
  });

  it("maps profiles_by_ids rows", () => {
    const row = {
      id: "b",
      display_name: "Ravi",
      age: 30,
      bio: "",
      interests: ["Cricket"],
      looking_for: "relationship",
      photo_path: null,
      verified: true,
      created_at: "2026-11-20T00:00:00Z",
      distance_km: 9,
      online: false,
      city: "Delhi",
      photos: ["b/1.jpg"],
    } as PersonRow;
    const p = personFromRow(row);
    expect(p.displayName).toBe("Ravi");
    expect(p.distanceKm).toBe(9);
    expect(p.details.city).toBe("Delhi");
    expect(photoList(p)).toEqual(["b/1.jpg"]);
  });

  it("only lists facts the person filled in", () => {
    expect(factsFor(base())).toEqual([]);
    const facts = factsFor(
      base({
        distanceKm: 9,
        details: { ...base().details, city: "Noida", height_cm: 161, education: "undergraduate" },
      }),
    );
    expect(facts.map((f) => f.text)).toEqual(["Noida", "9 km away", "161 cm (5′3″)", "Undergraduate degree"]);
  });

  it("describes coarse distance without false precision", () => {
    expect(distanceText(null)).toBeNull();
    expect(distanceText(0)).toBe("Less than 1 km away");
    expect(distanceText(9.4)).toBe("9 km away");
  });

  it("builds Vibes from real interests and city only, dropping empty ones", () => {
    const people = [
      base({ id: "1", interests: ["Movies"], details: { ...base().details, city: "Noida" } }),
      base({ id: "2", interests: ["Cooking"] }),
    ];
    const vibes = buildVibes(people, { interests: ["Anime"], city: "noida" }, Date.parse("2026-11-27"));
    const byKey = Object.fromEntries(vibes.map((v) => [v.key, v]));
    expect(byKey.local.people.map((p) => p.id)).toEqual(["1"]);
    expect(byKey.local.why).toBe("Because you live in noida");
    expect(byKey.cinema.why).toBe("Because you like: Anime");
    expect(byKey.food.why).toBe("Members into food and drinks");
    expect(byKey.sport).toBeUndefined();
    expect(byKey.nearby).toBeUndefined();
  });

  it("profile completion counts only saved fields", () => {
    const row = {
      id: "x",
      display_name: "A",
      age: 30,
      bio: "",
      interests: [],
      looking_for: "friendship",
      age_min: 18,
      age_max: 40,
    } as ProfileRow;
    const s = profileStrength(row);
    expect(s.percent).toBe(0);
    const better = profileStrength({
      ...row,
      photo_path: "x/1.jpg",
      photos: ["x/1.jpg", "x/2.jpg", "x/3.jpg"],
      city: "Delhi",
    });
    expect(better.items.filter((i) => i.done).map((i) => i.key)).toEqual(["photo", "photos3", "city"]);
  });
});
