// PUT /api/v1/profile when database-level age attestation is on (P2-03): the database refuses a new profile without a
// recorded date of birth and 18+ confirmation, and the API reports that clearly instead of a generic server error.
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type ProfileStore } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { AgeAttestationRequiredError, isAgeAttestationRefusal } from "../src/profileErrors.js";
import { SupabaseProfileStore } from "../src/supabaseStore.js";

const verifier: TokenVerifier = async (token) => (token === "token-new" ? { id: "new-member" } : null);
const profile = {
  displayName: "Nina",
  age: 30,
  bio: "",
  interests: ["books"],
  lookingFor: "friendship",
  ageMin: 21,
  ageMax: 40,
};
const REFUSAL = "Please confirm your date of birth before creating a profile.";

function appWith(upsertProfile: ProfileStore["upsertProfile"]) {
  const store: ProfileStore = {
    upsertProfile,
    getProfile: async () => null,
    listCandidates: async () => [],
  };
  return createApp({ config: loadConfig({}), verifyToken: verifier, storeFor: () => store });
}

afterEach(() => vi.unstubAllGlobals());

describe("database-level age attestation through the API", () => {
  it("recognises only the database's age-attestation refusal", () => {
    expect(isAgeAttestationRefusal({ code: "P0001", message: REFUSAL })).toBe(true);
    expect(isAgeAttestationRefusal({ code: "P0001", message: "RentMate does not allow this wording." })).toBe(
      false,
    );
    expect(isAgeAttestationRefusal({ code: "23514", message: REFUSAL })).toBe(false);
    expect(isAgeAttestationRefusal(null)).toBe(false);
  });

  it("returns 422 age_attestation_required when the database refuses the profile", async () => {
    const app = appWith(async () => {
      throw new AgeAttestationRequiredError(REFUSAL);
    });
    const res = await request(app)
      .put("/api/v1/profile")
      .set("Authorization", "Bearer token-new")
      .send(profile);
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: REFUSAL, code: "age_attestation_required" });
  });

  it("other storage failures are still server errors, not reported as an age problem", async () => {
    const app = appWith(async () => {
      throw new Error("Saving profile failed: connection reset");
    });
    const res = await request(app)
      .put("/api/v1/profile")
      .set("Authorization", "Bearer token-new")
      .send(profile);
    expect(res.status).toBe(500);
    expect(res.body.code).toBeUndefined();
  });

  it("the Supabase store turns the database's PostgREST refusal into AgeAttestationRequiredError", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        seen.push(`${init?.method ?? "GET"} ${new URL(String(url)).pathname}`);
        return new Response(JSON.stringify({ code: "P0001", message: REFUSAL, details: null, hint: null }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const store = new SupabaseProfileStore("https://db.example", "publishable", "member-jwt");
    await expect(store.upsertProfile("new-member", profile as never)).rejects.toBeInstanceOf(
      AgeAttestationRequiredError,
    );
    expect(seen).toEqual(["POST /rest/v1/profiles"]);
  });

  it("the Supabase store keeps other database errors as ordinary failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "23514", message: "violates check constraint" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const store = new SupabaseProfileStore("https://db.example", "publishable", "member-jwt");
    const attempt = store.upsertProfile("new-member", profile as never);
    await expect(attempt).rejects.toThrow(/Saving profile failed/);
    await expect(store.upsertProfile("new-member", profile as never)).rejects.not.toBeInstanceOf(
      AgeAttestationRequiredError,
    );
  });
});
