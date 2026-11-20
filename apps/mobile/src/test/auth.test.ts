// Android authentication flows on the existing Supabase Auth, with a test double that records every call.
import { describe, expect, it, vi } from "vitest";
import {
  ADULT_REQUIRED,
  AUTH_CALLBACK_PATH,
  AUTH_RESET_PATH,
  completeEmailLink,
  requestPasswordReset,
  setNewPassword,
  signIn,
  signUp,
  type AuthClient,
} from "../lib/auth";

const ok = { error: null };
function fakeAuth(over: Partial<AuthClient["auth"]> = {}) {
  const auth = {
    signInWithPassword: vi.fn(async () => ok),
    signUp: vi.fn(async () => ({ data: { user: { identities: [{}] }, session: null }, error: null })),
    resetPasswordForEmail: vi.fn(async () => ok),
    exchangeCodeForSession: vi.fn(async () => ok),
    updateUser: vi.fn(async () => ok),
    ...over,
  };
  return { client: { auth } as AuthClient, auth };
}
const offline = vi.fn(async () => {
  throw Object.assign(new TypeError("Failed to fetch"), { name: "AuthRetryableFetchError" });
});
const REDIRECT = "rentmate://auth/callback";

describe("sign-in", () => {
  it("signs in with a trimmed email", async () => {
    const { client, auth } = fakeAuth();
    expect(await signIn(client, "  asha@example.com ", "walks2026cafe")).toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "asha@example.com",
      password: "walks2026cafe",
    });
  });

  it("checks the email and password before calling Supabase", async () => {
    const { client, auth } = fakeAuth();
    const r = await signIn(client, "not-an-email", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields?.password).toBe("Enter your password.");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("wrong password and offline errors get clear messages, never raw errors", async () => {
    const { client } = fakeAuth({
      signInWithPassword: vi.fn(async () => ({ error: { code: "invalid_credentials", message: "x" } })),
    });
    const wrong = await signIn(client, "asha@example.com", "nope");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toMatch(/password/i);
    const { client: down } = fakeAuth({ signInWithPassword: offline });
    const net = await signIn(down, "asha@example.com", "walks2026cafe");
    if (!net.ok) expect(net.message).toMatch(/connection|offline|network/i);
    expect(net.ok).toBe(false);
  });
});

describe("sign-up (18+ declaration required)", () => {
  const input = { email: "new@example.com", password: "walks2026cafe", adultConfirmed: true };

  it("without the 18+ declaration nothing is sent", async () => {
    const { client, auth } = fakeAuth();
    const r = await signUp(client, { ...input, adultConfirmed: false }, REDIRECT);
    expect(r).toEqual({ ok: false, fields: { email: null, password: null, adult: ADULT_REQUIRED } });
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("with the declaration it signs up and asks for the email link back into the app", async () => {
    const { client, auth } = fakeAuth();
    expect(await signUp(client, input, REDIRECT)).toEqual({ ok: true, needsConfirmation: true });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "walks2026cafe",
      options: { emailRedirectTo: REDIRECT },
    });
  });

  it("a weak password is refused locally with the shared rule", async () => {
    const { client, auth } = fakeAuth();
    const r = await signUp(client, { ...input, password: "short" }, REDIRECT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields?.password).toBeTruthy();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("an existing account (Supabase returns no identities) is reported", async () => {
    const { client } = fakeAuth({
      signUp: vi.fn(async () => ({ data: { user: { identities: [] }, session: null }, error: null })),
    });
    const r = await signUp(client, input, REDIRECT);
    expect(r.ok).toBe(false);
  });

  it("no email confirmation needed: signed in straight away", async () => {
    const { client } = fakeAuth({
      signUp: vi.fn(async () => ({ data: { user: { identities: [{}] }, session: {} }, error: null })),
    });
    expect(await signUp(client, input, REDIRECT)).toEqual({ ok: true, needsConfirmation: false });
  });
});

describe("password reset", () => {
  it("sends the reset email with the app's reset link", async () => {
    const { client, auth } = fakeAuth();
    expect(await requestPasswordReset(client, " asha@example.com ", "rentmate://auth/reset")).toEqual({
      ok: true,
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("asha@example.com", {
      redirectTo: "rentmate://auth/reset",
    });
  });

  it("an invalid email is caught before calling Supabase", async () => {
    const { client, auth } = fakeAuth();
    expect((await requestPasswordReset(client, "nope", "x")).ok).toBe(false);
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("a new password must follow the sign-up rules and match its repeat", async () => {
    const { client, auth } = fakeAuth();
    expect((await setNewPassword(client, "walks2026cafe", "walks2026cafX")).ok).toBe(false);
    expect((await setNewPassword(client, "short", "short")).ok).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(await setNewPassword(client, "walks2026cafe", "walks2026cafe")).toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "walks2026cafe" });
  });
});

describe("email links (PKCE)", () => {
  it("exchanges the one-time code for a session on this device", async () => {
    const { client, auth } = fakeAuth();
    expect(await completeEmailLink(client, { code: "abc" })).toEqual({ ok: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
  });

  it("an expired or used link explains what to do", async () => {
    const { client } = fakeAuth({
      exchangeCodeForSession: vi.fn(async () => ({ error: { code: "flow_state_expired", message: "x" } })),
    });
    const r = await completeEmailLink(client, { code: "old" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBeTruthy();
  });

  it("a link without a code, or with an error, does not call Supabase", async () => {
    const { client, auth } = fakeAuth();
    expect((await completeEmailLink(client, {})).ok).toBe(false);
    expect(
      (await completeEmailLink(client, { error_description: "Email link is invalid or has expired" })).ok,
    ).toBe(false);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("uses the app link paths that the route files implement", async () => {
    const { existsSync } = await import("node:fs");
    expect(AUTH_CALLBACK_PATH).toBe("auth/callback");
    expect(AUTH_RESET_PATH).toBe("auth/reset");
    for (const p of [AUTH_CALLBACK_PATH, AUTH_RESET_PATH]) {
      expect(existsSync(new URL(`../../app/${p}.tsx`, import.meta.url).pathname)).toBe(true);
    }
  });
});
