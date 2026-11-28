/**
 * Client for the existing RentMate API (apps/api). Only routes that exist are wrapped; nothing here adds backend
 * behaviour. Every request carries the member's Supabase access token, like the web app.
 */
export type ApiFailure =
  | { kind: "network"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "http"; status: number; message: string; code?: string };

export class ApiError extends Error {
  constructor(public readonly failure: ApiFailure) {
    super(failure.message);
  }
}

export const NETWORK_MESSAGE = "You seem to be offline. Check your connection and try again.";
export const TIMEOUT_MESSAGE = "RentMate is taking too long to answer. Please try again.";
export const REQUEST_TIMEOUT_MS = 20_000;

export type ApiRequest = {
  base: string;
  token: string;
  method: "GET" | "PUT" | "POST" | "DELETE";
  path: `/api/v1/${string}`;
  body?: unknown;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

export async function apiRequest<T>(req: ApiRequest): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (req.fetchFn ?? fetch)(`${req.base}${req.path}`, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${req.token}`,
        ...(req.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? { kind: "timeout", message: TIMEOUT_MESSAGE }
        : { kind: "network", message: NETWORK_MESSAGE },
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!res.ok) {
    throw new ApiError({
      kind: "http",
      status: res.status,
      code: json?.code,
      message:
        res.status === 401
          ? "Your session has ended. Please sign in again."
          : (json?.error ?? `Something went wrong (${res.status}). Please try again.`),
    });
  }
  return json as T;
}

/** The existing routes the Android app uses (see apps/api/src/app.ts and apps/api/src/live/calls.ts). */
export const API_ROUTES = {
  profile: "/api/v1/profile", // PUT
  matches: "/api/v1/matches", // GET
  account: "/api/v1/account", // DELETE (wrapped by the shared deleteAccountViaServer)
  callJoin: (id: string) => `/api/v1/calls/${encodeURIComponent(id)}/join` as const, // POST
  callEnd: (id: string) => `/api/v1/calls/${encodeURIComponent(id)}/end` as const, // POST
} as const;
