import { describe, expect, it } from "vitest";
import {
  addUnique,
  CITIES,
  detailsFromRow,
  EMPTY_DETAILS,
  heightLabel,
  PLACE_CATEGORIES,
  profileFacts,
  PROMPT_CATEGORIES,
  searchCities,
  validateDetails,
} from "./details";

describe("validateDetails", () => {
  it("accepts an empty profile (everything is optional)", () => {
    expect(validateDetails(EMPTY_DETAILS).ok).toBe(true);
  });

  it("mirrors the database limits", () => {
    const bad = validateDetails({
      ...EMPTY_DETAILS,
      height_cm: 300,
      favourite_places: Array.from({ length: 11 }, (_, i) => `p${i}`),
      neighbourhoods: ["a", "b", "c", "d", "e", "f"],
      prompts: [
        { q: "a", a: "1" },
        { q: "b", a: "2" },
        { q: "c", a: "3" },
        { q: "d", a: "4" },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(Object.keys(bad.errors).sort()).toEqual([
        "favourite_places",
        "height_cm",
        "neighbourhoods",
        "prompts",
      ]);
    }
    const long = validateDetails({ ...EMPTY_DETAILS, prompts: [{ q: "Q", a: "x".repeat(201) }] });
    expect(long.ok).toBe(false);
  });

  it("tidies text and drops empty prompts", () => {
    const r = validateDetails({
      ...EMPTY_DETAILS,
      job: "  Product   designer ",
      city: " Pune ",
      prompts: [
        { q: "My ideal Sunday", a: "  Trek then dosa " },
        { q: "I'm known for", a: "   " },
      ],
    });
    expect(r.ok && r.row.job).toBe("Product designer");
    expect(r.ok && r.row.city).toBe("Pune");
    expect(r.ok && r.row.prompts).toEqual([{ q: "My ideal Sunday", a: "Trek then dosa" }]);
  });

  it("rejects values outside the allowed choices", () => {
    const r = validateDetails({ ...EMPTY_DETAILS, gender: "robot" as never });
    expect(r.ok).toBe(false);
  });
});

describe("detailsFromRow", () => {
  it("survives rows from before the migration", () => {
    expect(detailsFromRow({})).toEqual(EMPTY_DETAILS);
    expect(detailsFromRow(null)).toEqual(EMPTY_DETAILS);
  });

  it("ignores malformed prompts", () => {
    const d = detailsFromRow({ prompts: [{ q: "A", a: "B" }, { q: 1 }, "x"] as unknown });
    expect(d.prompts).toEqual([{ q: "A", a: "B" }]);
  });
});

describe("helpers", () => {
  it("searches cities, prefix matches first", () => {
    expect(searchCities("pun")[0]).toBe("Pune");
    expect(searchCities("pu").slice(0, 2)).toEqual(["Puducherry", "Pune"]);
    expect(searchCities("bad")).toContain("Hyderabad");
    expect(searchCities("")).toEqual([]);
    expect(new Set(CITIES).size).toBe(CITIES.length);
  });

  it("adds unique items up to a limit", () => {
    expect(addUnique(["Cafés"], "cafés", 10, 60)).toEqual(["Cafés"]);
    expect(addUnique(["a"], "  b  ", 2, 60)).toEqual(["a", "b"]);
    expect(addUnique(["a", "b"], "c", 2, 60)).toEqual(["a", "b"]);
  });

  it("lists only facts that were filled in", () => {
    expect(profileFacts(EMPTY_DETAILS)).toEqual([]);
    expect(profileFacts({ ...EMPTY_DETAILS, height_cm: 170, smoking: "never" })).toEqual([
      "170 cm",
      "Doesn't smoke",
    ]);
    expect(heightLabel(170)).toBe("170 cm (5′7″)");
  });

  it("has unique prompt questions and place types", () => {
    const qs = PROMPT_CATEGORIES.flatMap((c) => c.questions);
    expect(new Set(qs).size).toBe(qs.length);
    const places = PLACE_CATEGORIES.flatMap((c) => c.items);
    expect(new Set(places).size).toBe(places.length);
  });
});
