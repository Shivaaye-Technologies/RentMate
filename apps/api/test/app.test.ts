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

const makeApp = (
  store = new MemoryProfileStore(),
  verifyToken: TokenVerifier | null = verifier,
  readinessCheck: () => Promise<boolean> = async () => true,
) => createApp({ config, verifyToken, storeFor: () => store, readinessCheck });

const profile = {
  displayName: "Alice",
  age: 28,
  interests: ["hiking", "music"],
  lookingFor: "relationship",
  ageMin: 24,
  ageMax: 35,
};

describe("API", () => {
  it("GET /health reports process liveness without probing dependencies", async () => {
    const res = await request(makeApp(new MemoryProfileStore(), verifier, async () => false)).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", authConfigured: true });
  });

  it("GET /ready reports ready when Supabase is reachable", async () => {
    const res = await request(makeApp()).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready", service: "rentmate-api" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET /ready fails closed when Supabase is unavailable", async () => {
    const res = await request(makeApp(new MemoryProfileStore(), verifier, async () => false)).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", service: "rentmate-api" });
  });

  it("GET /ready fails closed when the dependency probe throws", async () => {
    const res = await request(
      makeApp(new MemoryProfileStore(), verifier, async () => {
        throw new Error("private connection detail");
      }),
    ).get("/ready");
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("private connection detail");
  });

  it("GET /ready fails closed when authentication is not configured", async () => {
    const res = await request(makeApp(new MemoryProfileStore(), null)).get("/ready");
    expect(res.status).toBe(503);
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

  it("rejects more than 10 interests, like the database", async () => {
    const res = await request(makeApp())
      .put("/api/v1/profile")
      .set("Authorization", "Bearer token-alice")
      .send({ ...profile, interests: Array.from({ length: 11 }, (_, i) => `i${i}`) });
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
        details: {},
        photos: [],
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

  // Regression for the production bug: three members whose ages fit but who share
  // no interests and want different things all saw an empty Discover.
  it("shows eligible people with no shared interests, with a summary", async () => {
    const app = makeApp();
    const put = (token: string, body: object) =>
      request(app).put("/api/v1/profile").set("Authorization", `Bearer ${token}`).send(body);
    await put("token-alice", { ...profile, interests: ["music"], lookingFor: "relationship" });
    await put("token-bob", {
      ...profile,
      displayName: "Bob",
      interests: ["cricket"],
      lookingFor: "friendship",
    });
    await put("token-cara", { ...profile, displayName: "Cara", age: 60, ageMin: 50, ageMax: 70 });

    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(200);
    expect(res.body.matches.map((m: { id: string; score: number }) => [m.id, m.score])).toEqual([["bob", 0]]);
    expect(res.body.summary).toEqual({ candidates: 2, outsideAgeRange: 1 });
  });

  // Behind Render's proxy every request arrives from the proxy's address; without
  // "trust proxy" all visitors shared one rate-limit bucket.
  it("rate-limits each visitor separately behind a proxy", async () => {
    const app = createApp({
      config: loadConfig({ NODE_ENV: "test", TRUST_PROXY: "1" }),
      verifyToken: verifier,
      storeFor: () => new MemoryProfileStore(),
    });
    const remaining = async (ip: string) => {
      const res = await request(app).get("/api/v1/matches").set("X-Forwarded-For", ip);
      return /remaining=(\d+)/.exec(String(res.headers["ratelimit"]))?.[1];
    };
    expect(await remaining("203.0.113.1")).toBe("119");
    expect(await remaining("203.0.113.1")).toBe("118");
    expect(await remaining("198.51.100.7")).toBe("119");
  });

  it("trusts one proxy hop in production by default", () => {
    const prod = { ...config, NODE_ENV: "production" as const };
    const app = createApp({ config: prod, verifyToken: verifier, storeFor: () => new MemoryProfileStore() });
    expect(app.get("trust proxy")).toBe(1);
    expect(makeApp().get("trust proxy")).toBe(0);
  });

  it("returns 404 for unknown routes", async () => {
    expect((await request(makeApp()).get("/nope")).status).toBe(404);
  });
});

describe("loadConfig", () => {
  it("requires Supabase settings in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/SUPABASE_URL/);
  });
  it("never prints secret settings when the config is logged or serialised", async () => {
    const { inspect } = await import("node:util");
    const secrets = {
      SUPABASE_ANON_KEY: "anon-key-value-should-not-print",
      LIVEKIT_API_SECRET: "livekit-secret-should-not-print-0123456789",
      LIVE_WEBHOOK_DB_SECRET: "webhook-db-secret-should-not-print-0123456789",
    };
    const c = loadConfig({ NODE_ENV: "test", LIVEKIT_API_KEY: "APIkey", ...secrets });
    for (const printed of [JSON.stringify(c), inspect(c), `${JSON.stringify({ c })}`]) {
      for (const v of Object.values(secrets)) expect(printed).not.toContain(v);
      expect(printed).toContain("[redacted]");
      expect(printed).toContain("APIkey"); // non-secret settings stay visible
    }
    // Code that needs the values still gets them.
    expect(c.LIVEKIT_API_SECRET).toBe(secrets.LIVEKIT_API_SECRET);
    expect(Object.keys(c)).not.toContain("toJSON");
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
          {
            id: "bob",
            displayName: "Bob",
            ...base,
            distanceKm: 15,
            online: true,
            details: { city: "Pune", prompts: [{ q: "My ideal Sunday", a: "Chai and a long walk" }] },
            photos: ["bob/2.jpg"],
          },
        ],
      }),
    });
    void store;
    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(200);
    expect(res.body.matches[0]).toMatchObject({
      id: "bob",
      distanceKm: 15,
      online: true,
      details: { city: "Pune", prompts: [{ q: "My ideal Sunday", a: "Chai and a long walk" }] },
      photos: ["bob/2.jpg"],
    });
    expect(res.body.matches[0]).not.toHaveProperty("lat");
  });

  it("no longer exposes the unused messages endpoint", async () => {
    const res = await request(makeApp()).post("/api/v1/messages").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(404);
  });
});
