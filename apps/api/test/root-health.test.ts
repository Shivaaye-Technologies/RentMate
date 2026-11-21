import { createRequire } from "node:module";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, ROUTES } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { MemoryProfileStore } from "../src/store.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

// Realistic-looking values so the test can prove they never appear in responses.
const SECRET_URL = "https://secret-project-ref.supabase.co";
const SECRET_KEY = "sb_publishable_TEST_SECRET_VALUE_123";
const config = loadConfig({
  NODE_ENV: "production",
  SUPABASE_URL: SECRET_URL,
  SUPABASE_ANON_KEY: SECRET_KEY,
  CORS_ORIGINS: "https://soulmate-web.onrender.com",
});
const verifier: TokenVerifier = async () => null;
const store = new MemoryProfileStore();
const app = createApp({ config, verifyToken: verifier, storeFor: () => store });

describe("GET /", () => {
  it("returns 200 with API information and route documentation", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toMatchObject({
      name: "RentMate API",
      service: "rentmate-api",
      version: pkg.version,
      status: "ok",
    });
    expect(res.body.routes).toEqual(ROUTES);
    expect(res.body.routes.map((r: { path: string }) => r.path)).toEqual(
      expect.arrayContaining(["/", "/health", "/api/v1/profile", "/api/v1/matches"]),
    );
  });

  it("never exposes configuration values or secrets", async () => {
    const res = await request(app).get("/");
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain(SECRET_URL);
    expect(text).not.toContain("secret-project-ref");
    expect(text).not.toMatch(/sb_(publishable|secret)_/);
  });

  it("does not require authentication", async () => {
    const res = await request(app).get("/").set("Authorization", "Bearer invalid");
    expect(res.status).toBe(200);
  });
});

describe("GET /health", () => {
  it("returns 200 and status ok while the process runs", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers HEAD requests with 200", async () => {
    const res = await request(app).head("/health");
    expect(res.status).toBe(200);
  });

  it("stays 200 even when Supabase auth is not configured", async () => {
    const bare = createApp({ config: loadConfig({}), verifyToken: null, storeFor: () => store });
    const res = await request(bare).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", authConfigured: false });
  });

  it("does not leak secrets", async () => {
    const res = await request(app).get("/health");
    expect(JSON.stringify(res.body)).not.toContain(SECRET_KEY);
  });
});

describe("documented routes", () => {
  it("every protected route exists and rejects requests without a token (401, not 404)", async () => {
    for (const r of ROUTES.filter((route) => route.auth)) {
      const res = await request(app)[r.method.toLowerCase() as "get" | "put"](r.path);
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it("unknown paths still return 404 JSON", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

describe("PORT", () => {
  it("uses the PORT Render provides", () => {
    expect(loadConfig({ PORT: "10000" }).PORT).toBe(10000);
  });

  it("defaults to 4000 locally", () => {
    expect(loadConfig({}).PORT).toBe(4000);
  });

  it("rejects an invalid PORT instead of starting on the wrong one", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });
});
