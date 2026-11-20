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
    expect((err as Error).message).toMatch(/Can't reach the RentMate server/);
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

describe("discoverEmptyState with your activity", () => {
  it("says how many likes are awaiting a reply (the live case: liked both members)", () => {
    const e = discoverEmptyState({ candidates: 0, outsideAgeRange: 0 }, { awaitingReply: 2, passed: 0 });
    expect(e.title).toBe("You're all caught up");
    expect(e.body).toContain("You liked 2 people who haven't replied yet.");
    expect(e.body).toContain("you'll match");
    expect(e.reviewPasses).toBe(0);
  });

  it("offers to bring back passed profiles, with singular wording", () => {
    const e = discoverEmptyState({ candidates: 0, outsideAgeRange: 0 }, { awaitingReply: 1, passed: 1 });
    expect(e.body).toContain("You liked 1 person who hasn't replied yet.");
    expect(e.body).toContain("You passed 1 person");
    expect(e.reviewPasses).toBe(1);
  });

  it("keeps the age-range explanation and adds waiting likes", () => {
    const e = discoverEmptyState({ candidates: 3, outsideAgeRange: 3 }, { awaitingReply: 1, passed: 2 });
    expect(e.editProfile).toBe(true);
    expect(e.body).toMatch(/^3 people are outside your age range/);
    expect(e.reviewPasses).toBe(2);
  });

  it("is honest when nobody has joined yet", () => {
    const e = discoverEmptyState({ candidates: 0, outsideAgeRange: 0 }, { awaitingReply: 0, passed: 0 });
    expect(e.title).toBe("No new people yet");
    expect(e.body).toMatch(/invite friends/);
    expect(e.reviewPasses).toBe(0);
  });
});
