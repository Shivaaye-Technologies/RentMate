import { describe, expect, it } from "vitest";
import { apiBaseUrl, checkHealth } from "./api";

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
