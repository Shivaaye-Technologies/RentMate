/**
 * Calls the RentMate API with the member's Supabase session, and tells the three 401 causes apart:
 *  - the access token expired          → refresh once and retry (normal after the app sleeps)
 *  - the refresh token is revoked/gone → sign out, so the app returns to sign-in
 *  - the server rejects a fresh token  → a server problem (e.g. the API checks tokens against another Supabase
 *                                        project). The member stays signed in and sees an honest error.
 * Auth errors are always thrown, never turned into empty lists. Tokens are never logged.
 */
import { ApiError, NETWORK_MESSAGE, apiRequest, type ApiRequest } from "./api";
import { record } from "./diagnostics";

export type RefreshOutcome = "ok" | "revoked" | "offline";

export type SessionAuth = {
  /** The current access token, or null when there is no stored session. */
  accessToken(): Promise<string | null>;
  refresh(): Promise<RefreshOutcome>;
  signOut(): Promise<void>;
};

export const SIGN_IN_AGAIN = "Your session has ended. Please sign in again.";
export const SERVER_AUTH_MESSAGE =
  "RentMate's server couldn't verify your sign-in (AUTH-401). Your account is fine; this is a server setup problem. Please try again later.";
export const SERVER_NOT_READY =
  "RentMate's server isn't ready to check sign-ins yet (AUTH-503). Please try again later.";

/** The member must sign in again; the session has already been cleared. */
export class SignInRequiredError extends Error {}
/** The API refused a token that Supabase Auth has just issued: a server-side configuration problem. */
export class ServerAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Req = Omit<ApiRequest, "token">;

const isStatus = (e: unknown, status: number) =>
  e instanceof ApiError && e.failure.kind === "http" && e.failure.status === status;

export async function authedApiRequest<T>(auth: SessionAuth, req: Req): Promise<T | null> {
  const token = await auth.accessToken();
  if (!token) {
    record("auth", "no stored session", { path: req.path });
    throw new SignInRequiredError("Please sign in again.");
  }
  try {
    const out = await apiRequest<T>({ ...req, token });
    record("api", "ok", { path: req.path, status: 200 });
    return out;
  } catch (e) {
    if (isStatus(e, 503)) {
      record("api", "auth not configured on server", { path: req.path, status: 503 });
      throw new ServerAuthError(503, SERVER_NOT_READY);
    }
    if (!isStatus(e, 401)) {
      if (e instanceof ApiError)
        record("api", "failed", {
          path: req.path,
          kind: e.failure.kind,
          status: e.failure.kind === "http" ? e.failure.status : 0,
        });
      throw e;
    }
  }

  record("api", "401, refreshing session", { path: req.path, status: 401 });
  const outcome = await auth.refresh();
  record("auth", `refresh ${outcome}`);
  if (outcome === "offline") throw new ApiError({ kind: "network", message: NETWORK_MESSAGE });
  if (outcome === "revoked") {
    await auth.signOut();
    throw new SignInRequiredError(SIGN_IN_AGAIN);
  }

  const fresh = await auth.accessToken();
  if (!fresh) {
    await auth.signOut();
    throw new SignInRequiredError(SIGN_IN_AGAIN);
  }
  try {
    const out = await apiRequest<T>({ ...req, token: fresh });
    record("api", "ok after refresh", { path: req.path, status: 200 });
    return out;
  } catch (e) {
    if (isStatus(e, 401)) {
      // Supabase Auth just issued this token, so the API is checking it against the wrong project or key.
      record("api", "server rejected a fresh token", { path: req.path, status: 401 });
      throw new ServerAuthError(401, SERVER_AUTH_MESSAGE);
    }
    throw e;
  }
}

type AuthLike = {
  getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
  refreshSession(): Promise<{ data: { session: unknown }; error: { name?: string; status?: number } | null }>;
  signOut(): Promise<unknown>;
};

/** Adapter for supabase-js. A refresh that fails without an HTTP answer is "offline", not a revoked session. */
export function supabaseSessionAuth(auth: AuthLike): SessionAuth {
  return {
    async accessToken() {
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    },
    async refresh() {
      try {
        const { data, error } = await auth.refreshSession();
        if (!error && data.session) return "ok";
        if (error && (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500))
          return "offline";
        return "revoked";
      } catch {
        return "offline";
      }
    },
    async signOut() {
      await auth.signOut();
    },
  };
}
