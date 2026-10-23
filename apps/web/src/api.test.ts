import { describe, expect, it } from "vitest";
import { apiBaseUrl, checkHealth, discoverEmptyState, DiscoverError, fetchDiscover } from "./api";

const fakeFetch = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe("apiBaseUrl", () => {
  it("strips trailing slashes and falls back to localhost", () => {
    expect(apiBaseUrl("https://api.example.com//")).toBe("https://api.example.com");
    expect(apiBaseUrl("")).toBe("http://localhost:4000");
  });
});

describe("checkHealth", () => {
  it("reports online for a healthy API", async () => {
    expect(await checkHealth(fakeFetch(200, { status: "ok" }), "http://x")).toBe("online");
  });
  it("reports offline on errors or bad responses", async () => {
    expect(await checkHealth(fakeFetch(500, {}), "http://x")).toBe("offline");
    const failing = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await checkHealth(failing, "http://x")).toBe("offline");
  });
});

describe("fetchDiscover", () => {
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns people and the summary, sending the access token", async () => {
    let auth = "";
    const f = (async (_url: string, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(
        JSON.stringify({ matches: [{ id: "b" }], summary: { candidates: 1, outsideAgeRange: 0 } }),
      );
    }) as unknown as typeof fetch;
    const r = await fetchDiscover("tok", f, "https://api.test");
    expect(auth).toBe("Bearer tok");
    expect(r.people.map((p) => p.id)).toEqual(["b"]);
    expect(r.summary).toEqual({ candidates: 1, outsideAgeRange: 0 });
  });

  it("explains an unreachable server instead of hiding it", async () => {
    const f = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const err = await fetchDiscover("t", f, "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiscoverError);
    expect((err as Error).message).toMatch(/Can't reach the SOULMATE.AI server/);
    expect((err as { status: unknown }).status).toBeNull();
  });

  it("reports expired sessions, server errors and bad responses", async () => {
    const run = (f: typeof fetch) => fetchDiscover("t", f, "x").catch((e: Error & { status: number }) => e);
    expect(await run(reply(401, { error: "Invalid token" }))).toMatchObject({
      status: 401,
      message: expect.stringMatching(/sign in again/),
    });
    expect(await run(reply(500, { error: "Internal server error" }))).toMatchObject({
      status: 500,
      message: expect.stringMatching(/Internal server error \(error 500\)/),
    });
    expect(await run(reply(404, { error: "Create your profile first" }))).toMatchObject({
      status: 404,
      message: expect.stringMatching(/Create your profile first/),
    });
    expect(await run(reply(200, { nope: true }))).toMatchObject({
      message: expect.stringMatching(/unexpected response/),
    });
  });
});

describe("discoverEmptyState", () => {
  it("explains each reason Discover can be empty", () => {
    expect(discoverEmptyState({ candidates: 3, outsideAgeRange: 1 })).toMatchObject({
      title: "You're all caught up",
      editProfile: false,
    });
    expect(discoverEmptyState({ candidates: 2, outsideAgeRange: 2 })).toMatchObject({
      editProfile: true,
      body: expect.stringMatching(/^2 people are outside your age range/),
    });
    expect(discoverEmptyState({ candidates: 1, outsideAgeRange: 1 }).body).toMatch(/^1 person is/);
    expect(discoverEmptyState({ candidates: 0, outsideAgeRange: 0 }).title).toBe("No new people yet");
    expect(discoverEmptyState(null).title).toBe("No new people yet");
  });
});
