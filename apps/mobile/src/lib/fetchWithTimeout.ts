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
