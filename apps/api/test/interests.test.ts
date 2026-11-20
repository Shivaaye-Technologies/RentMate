import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalInterest, INTEREST_ALIASES, interestKey, STANDARD_INTERESTS } from "../src/interests.js";

describe("interests", () => {
  it("is the same file in the API and the website", () => {
    const api = readFileSync(join(__dirname, "../src/interests.ts"), "utf8");
    const web = readFileSync(join(__dirname, "../../web/src/interests.ts"), "utf8");
    expect(web).toBe(api);
  });

  it("maps spellings to standard interests and keeps unknown ones", () => {
    expect(canonicalInterest("  hike ")).toBe("Hiking");
    expect(canonicalInterest("TRAVELING")).toBe("Travel");
    expect(canonicalInterest("live   music")).toBe("Live music");
    expect(canonicalInterest("Chess")).toBe("Chess");
    expect(interestKey("Hikes")).toBe("hiking");
  });

  it("only aliases to standard interests, with unique standard names", () => {
    expect(new Set(STANDARD_INTERESTS).size).toBe(STANDARD_INTERESTS.length);
    for (const target of Object.values(INTEREST_ALIASES)) {
      expect(STANDARD_INTERESTS as readonly string[]).toContain(target);
    }
    for (const key of Object.keys(INTEREST_ALIASES)) expect(key).toBe(key.toLowerCase());
  });
});

describe("interest categories", () => {
  it("puts every standard interest in exactly one category", async () => {
    const { INTEREST_CATEGORIES } = await import("../src/interests.js");
    const all = INTEREST_CATEGORIES.flatMap((c) => c.items);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...STANDARD_INTERESTS].sort());
  });
});
