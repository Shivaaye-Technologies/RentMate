import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedFetch, fetchWithTimeout, type FetchImplementation } from "../lib/fetchWithTimeout.js";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes the abort signal to fetch and returns its response", async () => {
    const response = new Response("ok", { status: 200 });
    const fetcher = vi.fn<FetchImplementation>().mockResolvedValue(response);

    await expect(fetchWithTimeout("https://example.test", {}, 1000, fetcher)).resolves.toBe(response);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a request at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetcher: FetchImplementation = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });

    const pending = fetchWithTimeout("https://example.test", {}, 250, fetcher);
    const assertion = expect(pending).rejects.toThrow("The request timed out");
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });

  it("does not relabel ordinary network failures as timeouts", async () => {
    const fetcher = vi.fn<FetchImplementation>().mockRejectedValue(new Error("network unavailable"));

    await expect(fetchWithTimeout("https://example.test", {}, 1000, fetcher)).rejects.toThrow(
      "network unavailable",
    );
  });
});

describe("boundedFetch (Supabase client)", () => {
  const hang: FetchImplementation = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });

  it("ends a stalled request with a timeout error instead of loading forever", async () => {
    vi.useFakeTimers();
    const pending = boundedFetch(hang, 1_000, 5_000)("https://x.supabase.co/rest/v1/matches");
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;
  });

  it("gives photo uploads the longer bound", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = boundedFetch(
      hang,
      1_000,
      5_000,
    )("https://x.supabase.co/storage/v1/object/photos/me/a.jpg", {
      method: "POST",
    }).catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(4_000);
    await pending;
    expect(settled).toBe(true);
  });

  it("passes the caller's own abort through unchanged", async () => {
    const outer = new AbortController();
    const pending = boundedFetch(hang)("https://x.supabase.co/rest/v1/likes", { signal: outer.signal });
    outer.abort();
    await expect(pending).rejects.toThrow("Aborted");
  });
});
