import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { MemoryProfileStore } from "../src/store.js";

const config = loadConfig({ NODE_ENV: "test" });
const tokens: Record<string, string> = {
  "token-alice": "alice",
  "token-bob": "bob",
  "token-cara": "cara",
};
const verifier: TokenVerifier = async (t) => (tokens[t] ? { id: tokens[t] } : null);

const makeApp = (store = new MemoryProfileStore(), verifyToken: TokenVerifier | null = verifier) =>
  createApp({ config, verifyToken, storeFor: () => store });

const profile = {
  displayName: "Alice",
  age: 28,
  interests: ["hiking", "music"],
  lookingFor: "relationship",
  ageMin: 24,
  ageMax: 35,
};

describe("API", () => {
  it("GET /health reports ok", async () => {
    const res = await request(makeApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", authConfigured: true });
  });

  it("rejects requests without a token", async () => {
    const app = makeApp();
    expect((await request(app).get("/api/v1/matches")).status).toBe(401);
    const bad = await request(app).get("/api/v1/matches").set("Authorization", "Bearer nope");
    expect(bad.status).toBe(401);
  });

  it("fails closed with 503 when auth is not configured", async () => {
    const res = await request(makeApp(new MemoryProfileStore(), null))
      .get("/api/v1/matches")
      .set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(503);
  });

  it("rejects under-18 profiles", async () => {
    const res = await request(makeApp())
      .put("/api/v1/profile")
      .set("Authorization", "Bearer token-alice")
      .send({ ...profile, age: 17 });
    expect(res.status).toBe(400);
  });

  it("returns 404 from /matches until the user has a profile", async () => {
    const res = await request(makeApp()).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(404);
  });

  it("creates profiles and returns ranked matches with display details", async () => {
    const app = makeApp();
    const put = (token: string, body: object) =>
      request(app).put("/api/v1/profile").set("Authorization", `Bearer ${token}`).send(body);

    expect((await put("token-alice", profile)).status).toBe(204);
    expect(
      (await put("token-bob", { ...profile, displayName: "Bob", age: 30, bio: "Trail runner" })).status,
    ).toBe(204);

    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([
      {
        id: "bob",
        score: 100,
        sharedInterests: ["hiking", "music"],
        displayName: "Bob",
        age: 30,
        bio: "Trail runner",
        interests: ["hiking", "music"],
        lookingFor: "relationship",
        photoPath: null,
        verified: false,
        online: false,
        distanceKm: null,
        joinedAt: null,
      },
    ]);
  });

  it("does not show people the user already liked or passed on", async () => {
    const store = new MemoryProfileStore();
    const app = makeApp(store);
    const put = (token: string, body: object) =>
      request(app).put("/api/v1/profile").set("Authorization", `Bearer ${token}`).send(body);
    await put("token-alice", profile);
    await put("token-bob", { ...profile, displayName: "Bob", age: 30 });
    await put("token-cara", { ...profile, displayName: "Cara", age: 29 });

    store.markSeen("alice", "bob");
    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.body.matches.map((m: { id: string }) => m.id)).toEqual(["cara"]);
  });

  it("returns 404 for unknown routes", async () => {
    expect((await request(makeApp()).get("/nope")).status).toBe(404);
  });
});

describe("loadConfig", () => {
  it("requires Supabase settings in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/SUPABASE_URL/);
  });
  it("parses CORS origins", () => {
    expect(loadConfig({ CORS_ORIGINS: "https://a.com, https://b.com" }).CORS_ORIGINS).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});

describe("precomputed fields from the database", () => {
  it("uses distance and online status supplied by the store", async () => {
    const store = new MemoryProfileStore();
    const base = {
      age: 28,
      interests: ["hiking"],
      lookingFor: "relationship" as const,
      ageMin: 20,
      ageMax: 40,
    };
    const app = createApp({
      config,
      verifyToken: verifier,
      storeFor: () => ({
        upsertProfile: async () => undefined,
        getProfile: async () => ({ id: "alice", ...base }),
        listCandidates: async () => [
          { id: "bob", displayName: "Bob", ...base, distanceKm: 15, online: true },
        ],
      }),
    });
    void store;
    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(200);
    expect(res.body.matches[0]).toMatchObject({ id: "bob", distanceKm: 15, online: true });
  });

  it("no longer exposes the unused messages endpoint", async () => {
    const res = await request(makeApp()).post("/api/v1/messages").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(404);
  });
});
