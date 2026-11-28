// Regression: Vibes/Preferences/Profile read private columns (city, show_me, select *) straight from `profiles`,
// which column grants refuse. The owner's row must come from get_my_profile().
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProfileLoadError, loadMyProfile } from "../lib/me";

describe("loadMyProfile", () => {
  it("reads the owner's row through get_my_profile", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ id: "me", city: "Noida", interests: ["Anime"] }],
      error: null,
    }));
    expect(await loadMyProfile({ rpc })).toEqual({ id: "me", city: "Noida", interests: ["Anime"] });
    expect(rpc).toHaveBeenCalledWith("get_my_profile");
  });

  it("returns null when there is no profile yet", async () => {
    expect(await loadMyProfile({ rpc: async () => ({ data: [], error: null }) })).toBeNull();
  });

  it("throws on a database error instead of pretending the profile is empty", async () => {
    const rpc = async () => ({ data: null, error: { code: "42501", message: "permission denied" } });
    await expect(loadMyProfile({ rpc })).rejects.toBeInstanceOf(ProfileLoadError);
  });
});

// Columns a member may SELECT directly (see the profiles column grants in supabase/migrations).
const PUBLIC_COLUMNS = new Set([
  "id",
  "display_name",
  "age",
  "bio",
  "interests",
  "looking_for",
  "age_min",
  "age_max",
  "photo_path",
  "verified",
  "created_at",
  "updated_at",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe("mobile reads of profiles", () => {
  const root = join(__dirname, "..", "..");
  const sources = [
    ...files(join(root, "app")),
    ...files(join(root, "src", "lib")),
    ...files(join(root, "src", "components")),
  ];

  it("select only public columns from profiles (private ones go through get_my_profile)", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8").replace(/\s+/g, " ");
      for (const m of text.matchAll(/from\("profiles"\)\s*\.select\(\s*"([^"]*)"/g)) {
        const cols = m[1]
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        const bad = cols.filter((c) => c === "*" || !PUBLIC_COLUMNS.has(c));
        if (bad.length) offenders.push(`${file.slice(root.length + 1)}: ${bad.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
