/**
 * Adds a bounded timeout to a fetch request.
 *
 * Callers decide whether a failed operation is safe to retry; this helper never retries
 * automatically because POST requests may have server-side effects.
 */
export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
  fetcher: FetchImplementation = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The request timed out. Check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * fetch for the Supabase client: every request ends within a bound, so a stalled connection becomes an error a
 * screen can show instead of a spinner that never stops. Photo uploads get longer. The caller's own abort signal
 * still works.
 */
export function boundedFetch(
  fetcher: FetchImplementation = fetch,
  normalMs = 30_000,
  uploadMs = 120_000,
): FetchImplementation {
  return async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const upload = /\/storage\/v1\/object\//.test(url) && /^(POST|PUT)$/i.test(init.method ?? "GET");
    const controller = new AbortController();
    const outer = init.signal;
    if (outer?.aborted) controller.abort();
    else outer?.addEventListener("abort", () => controller.abort(), { once: true });
    const timer = setTimeout(() => controller.abort(), upload ? uploadMs : normalMs);
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !outer?.aborted) {
        throw new Error("The request timed out. Check your connection and try again.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}
