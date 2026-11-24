import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, type FetchImplementation } from "../lib/fetchWithTimeout.js";

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
