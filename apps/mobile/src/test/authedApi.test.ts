// Regression tests for "Invalid or expired token" on Home/Discover/Vibes/Around you (device test, 2026-11-27).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import {
  SERVER_AUTH_MESSAGE,
  SERVER_NOT_READY,
  SIGN_IN_AGAIN,
  ServerAuthError,
  SignInRequiredError,
  authedApiRequest,
  supabaseSessionAuth,
  type RefreshOutcome,
  type SessionAuth,
} from "../lib/authedApi";
import { clearDiagnostics, diagnosticsText } from "../lib/diagnostics";

const req = { base: "https://api.example", method: "GET" as const, path: "/api/v1/matches" as const };
const ACCESS_OLD = "eyJhbGciOiJIUzI1NiJ9.old-access.sig";
const ACCESS_NEW = "eyJhbGciOiJIUzI1NiJ9.new-access.sig";

/** A fake API that accepts only the tokens in `valid`. */
function api(valid: string[], status401 = 401) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization;
    if (valid.some((t) => auth === `Bearer ${t}`))
      return new Response(JSON.stringify({ matches: [{ id: "p1" }] }), { status: 200 });
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: status401 });
  }) as unknown as typeof fetch;
}

function session(outcome: RefreshOutcome, start: string | null = ACCESS_OLD) {
  let token = start;
  const auth: SessionAuth & { signedOut: boolean; refreshes: number } = {
    signedOut: false,
    refreshes: 0,
    accessToken: async () => token,
    refresh: async () => {
      auth.refreshes++;
      if (outcome === "ok") token = ACCESS_NEW;
      return outcome;
    },
    signOut: async () => {
      auth.signedOut = true;
      token = null;
    },
  };
  return auth;
}

beforeEach(clearDiagnostics);

describe("authedApiRequest", () => {
  it("uses a valid token without refreshing", async () => {
    const auth = session("ok");
    const body = await authedApiRequest<{ matches: unknown[] }>(auth, { ...req, fetchFn: api([ACCESS_OLD]) });
    expect(body?.matches).toHaveLength(1);
    expect(auth.refreshes).toBe(0);
  });

  it("an expired access token is refreshed once and the request retried", async () => {
    const auth = session("ok");
    const fetchFn = api([ACCESS_NEW]);
    const body = await authedApiRequest<{ matches: unknown[] }>(auth, { ...req, fetchFn });
    expect(body?.matches).toHaveLength(1);
    expect(auth.refreshes).toBe(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(auth.signedOut).toBe(false);
  });

  it("a revoked refresh token signs the member out and asks them to sign in again", async () => {
    const auth = session("revoked");
    await expect(authedApiRequest(auth, { ...req, fetchFn: api([]) })).rejects.toThrow(SIGN_IN_AGAIN);
    expect(auth.signedOut).toBe(true);
  });

  it("a refresh that cannot reach Supabase is an offline error and keeps the session", async () => {
    const auth = session("offline");
    const error = await authedApiRequest(auth, { ...req, fetchFn: api([]) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).failure.kind).toBe("network");
    expect(auth.signedOut).toBe(false);
  });

  it("the server rejecting a freshly issued token is a server error, not a sign-out (the staging bug)", async () => {
    const auth = session("ok");
    const error = await authedApiRequest(auth, { ...req, fetchFn: api([]) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerAuthError);
    expect((error as ServerAuthError).message).toBe(SERVER_AUTH_MESSAGE);
    expect(auth.signedOut).toBe(false);
  });

  it("an API without auth configured (503) is reported as such", async () => {
    const auth = session("ok");
    await expect(authedApiRequest(auth, { ...req, fetchFn: api([], 503) })).rejects.toThrow(SERVER_NOT_READY);
    expect(auth.refreshes).toBe(0);
  });

  it("no stored session after a restart asks the member to sign in", async () => {
    const auth = session("ok", null);
    await expect(authedApiRequest(auth, { ...req, fetchFn: api([ACCESS_OLD]) })).rejects.toBeInstanceOf(
      SignInRequiredError,
    );
  });

  it("never records a token in diagnostics", async () => {
    const auth = session("ok");
    await authedApiRequest(auth, { ...req, fetchFn: api([]) }).catch(() => undefined);
    const text = diagnosticsText();
    expect(text).toContain("server rejected a fresh token");
    expect(text).not.toContain("old-access");
    expect(text).not.toContain("new-access");
    expect(text).not.toMatch(/eyJ/);
  });
});

describe("supabaseSessionAuth", () => {
  const client = (refresh: () => Promise<unknown>, token: string | null = ACCESS_OLD) => ({
    getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
    refreshSession: refresh as never,
    signOut: vi.fn(async () => ({})),
  });

  it("restores the stored session's access token", async () => {
    expect(await supabaseSessionAuth(client(async () => ({}))).accessToken()).toBe(ACCESS_OLD);
    expect(await supabaseSessionAuth(client(async () => ({}), null)).accessToken()).toBeNull();
  });

  it("maps refresh results: new session ok, 400 revoked, network failure offline", async () => {
    const ok = client(async () => ({ data: { session: { access_token: ACCESS_NEW } }, error: null }));
    const revoked = client(async () => ({
      data: { session: null },
      error: { name: "AuthApiError", status: 400, code: "refresh_token_not_found" },
    }));
    const offline = client(async () => ({
      data: { session: null },
      error: { name: "AuthRetryableFetchError" },
    }));
    const thrown = client(async () => {
      throw new TypeError("Network request failed");
    });
    expect(await supabaseSessionAuth(ok).refresh()).toBe("ok");
    expect(await supabaseSessionAuth(revoked).refresh()).toBe("revoked");
    expect(await supabaseSessionAuth(offline).refresh()).toBe("offline");
    expect(await supabaseSessionAuth(thrown).refresh()).toBe("offline");
  });
});
