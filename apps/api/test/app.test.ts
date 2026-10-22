import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { MemoryProfileStore } from "../src/store.js";

const config = loadConfig({ NODE_ENV: "test" });
const tokens: Record<string, string> = { "token-alice": "alice", "token-bob": "bob" };
const verifier: TokenVerifier = async (t) => (tokens[t] ? { id: tokens[t] } : null);

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
    const app = createApp({ config, verifyToken: verifier, store: new MemoryProfileStore() });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", authConfigured: true });
  });

  it("rejects requests without a token", async () => {
    const app = createApp({ config, verifyToken: verifier, store: new MemoryProfileStore() });
    expect((await request(app).get("/api/v1/matches")).status).toBe(401);
    const bad = await request(app).get("/api/v1/matches").set("Authorization", "Bearer nope");
    expect(bad.status).toBe(401);
  });

  it("fails closed with 503 when auth is not configured", async () => {
    const app = createApp({ config, verifyToken: null, store: new MemoryProfileStore() });
    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(503);
  });

  it("rejects under-18 profiles", async () => {
    const app = createApp({ config, verifyToken: verifier, store: new MemoryProfileStore() });
    const res = await request(app)
      .put("/api/v1/profile")
      .set("Authorization", "Bearer token-alice")
      .send({ ...profile, age: 17 });
    expect(res.status).toBe(400);
  });

  it("creates profiles and returns ranked matches", async () => {
    const app = createApp({ config, verifyToken: verifier, store: new MemoryProfileStore() });
    const put = (token: string, body: object) =>
      request(app).put("/api/v1/profile").set("Authorization", `Bearer ${token}`).send(body);

    expect((await put("token-alice", profile)).status).toBe(204);
    expect((await put("token-bob", { ...profile, displayName: "Bob", age: 30 })).status).toBe(204);

    const res = await request(app).get("/api/v1/matches").set("Authorization", "Bearer token-alice");
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([{ id: "bob", score: 100, sharedInterests: ["hiking", "music"] }]);
  });

  it("returns 404 for unknown routes", async () => {
    const app = createApp({ config, verifyToken: verifier, store: new MemoryProfileStore() });
    expect((await request(app).get("/nope")).status).toBe(404);
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
