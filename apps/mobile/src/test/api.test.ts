import { describe, expect, it, vi } from "vitest";
import { API_ROUTES, ApiError, apiRequest, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from "../lib/api";

const base = "https://api.example";
const reply = (status: number, body?: unknown) =>
  vi.fn(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;

describe("apiRequest", () => {
  it("sends the member's token and JSON body to an existing route", async () => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
    await apiRequest({
      base,
      token: "tok",
      method: "PUT",
      path: API_ROUTES.profile,
      body: { a: 1 },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.example/api/v1/profile");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBe('{"a":1}');
  });

  it("returns parsed JSON", async () => {
    await expect(
      apiRequest({
        base,
        token: "t",
        method: "GET",
        path: API_ROUTES.matches,
        fetchFn: reply(200, [{ id: "x" }]),
      }),
    ).resolves.toEqual([{ id: "x" }]);
  });

  it("network failure becomes a clear offline error", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    const err = await apiRequest({
      base,
      token: "t",
      method: "GET",
      path: API_ROUTES.matches,
      fetchFn: down,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).failure).toEqual({ kind: "network", message: NETWORK_MESSAGE });
  });

  it("a slow server times out instead of hanging", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) =>
        init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      )) as unknown as typeof fetch;
    const err = await apiRequest({
      base,
      token: "t",
      method: "GET",
      path: API_ROUTES.matches,
      fetchFn: hang,
      timeoutMs: 20,
    }).catch((e) => e);
    expect((err as ApiError).failure).toEqual({ kind: "timeout", message: TIMEOUT_MESSAGE });
  });

  it("server errors keep the server's message and code (e.g. 422 age_attestation_required)", async () => {
    const err = await apiRequest({
      base,
      token: "t",
      method: "PUT",
      path: API_ROUTES.profile,
      body: {},
      fetchFn: reply(422, {
        error: "Please confirm your date of birth before creating a profile.",
        code: "age_attestation_required",
      }),
    }).catch((e) => e);
    expect((err as ApiError).failure).toMatchObject({
      kind: "http",
      status: 422,
      code: "age_attestation_required",
    });
  });

  it("an expired session asks the member to sign in again", async () => {
    const err = await apiRequest({
      base,
      token: "t",
      method: "GET",
      path: API_ROUTES.matches,
      fetchFn: reply(401, { error: "Invalid or expired token" }),
    }).catch((e) => e);
    expect((err as ApiError).message).toMatch(/sign in again/);
  });

  it("only wraps routes that exist in apps/api", () => {
    expect(Object.values(API_ROUTES).map((r) => (typeof r === "function" ? r("id") : r))).toEqual([
      "/api/v1/profile",
      "/api/v1/matches",
      "/api/v1/account",
      "/api/v1/calls/id/join",
      "/api/v1/calls/id/end",
    ]);
  });
});
