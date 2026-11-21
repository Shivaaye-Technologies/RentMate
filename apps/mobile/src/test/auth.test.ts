import { describe, expect, it, vi } from "vitest";
import { completeOAuthLink, signInWithGoogle, type AuthClient } from "../lib/auth";

function fakeAuth(over: Partial<AuthClient["auth"]> = {}) {
  const auth = {
    signInWithOAuth: vi.fn(async () => ({
      data: { url: "https://example.supabase.co/auth/v1/authorize?provider=google" },
      error: null,
    })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    ...over,
  };
  return { client: { auth } as AuthClient, auth };
}

describe("Google-only authentication", () => {
  it("starts Google OAuth with PKCE callback and account chooser", async () => {
    const { client, auth } = fakeAuth();
    const redirect = "rentmate://auth/callback";
    expect(await signInWithGoogle(client, redirect)).toEqual({
      ok: true,
      url: "https://example.supabase.co/auth/v1/authorize?provider=google",
    });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: redirect, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
  });

  it("reports provider configuration errors without leaking raw details", async () => {
    const { client } = fakeAuth({
      signInWithOAuth: vi.fn(async () => ({ data: { url: null }, error: { message: "provider disabled" } })),
    });
    expect((await signInWithGoogle(client, "rentmate://auth/callback")).ok).toBe(false);
  });

  it("exchanges the OAuth PKCE code for a session", async () => {
    const { client, auth } = fakeAuth();
    expect(await completeOAuthLink(client, { code: "one-time-code" })).toEqual({ ok: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
  });

  it("does not exchange a missing, expired or cancelled callback", async () => {
    const { client, auth } = fakeAuth();
    expect((await completeOAuthLink(client, {})).ok).toBe(false);
    expect((await completeOAuthLink(client, { error_description: "access_denied" })).ok).toBe(false);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
