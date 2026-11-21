/**
 * Android authentication on Supabase Auth. Google OAuth is the only supported sign-in/sign-up method.
 * OAuth uses PKCE and returns to rentmate://auth/callback.
 */
import { classifyAuthError } from "./shared";

type AuthErr = { code?: string; message?: string; status?: number; name?: string } | null;

export interface AuthClient {
  auth: {
    signInWithOAuth(c: {
      provider: "google";
      options: { redirectTo: string; skipBrowserRedirect: true; queryParams?: Record<string, string> };
    }): PromiseLike<{ data: { url: string | null }; error: AuthErr }>;
    exchangeCodeForSession(code: string): PromiseLike<{ error: AuthErr }>;
  };
}

export type AuthResult = { ok: true } | { ok: false; message?: string };
const fail = (e: unknown): AuthResult => ({ ok: false, message: classifyAuthError(e as AuthErr).message });

/** Starts Google OAuth. The caller opens the returned Supabase authorization URL in the system browser. */
export async function signInWithGoogle(
  client: AuthClient,
  redirectTo: string,
): Promise<{ ok: true; url: string } | { ok: false; message?: string }> {
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    if (error) return fail(error);
    if (!data.url) return { ok: false, message: "Google sign-in could not be started. Please try again." };
    return { ok: true, url: data.url };
  } catch (e) {
    return fail(e);
  }
}

/** Exchanges the one-time OAuth PKCE code for the signed-in session on this device. */
export async function completeOAuthLink(
  client: AuthClient,
  params: { code?: string | string[]; error_description?: string | string[] },
): Promise<AuthResult> {
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
  const linkError = one(params.error_description);
  if (linkError) return fail({ message: linkError });
  const code = one(params.code);
  if (!code) return { ok: false, message: "Google sign-in was cancelled or the link expired. Please try again." };
  try {
    const { error } = await client.auth.exchangeCodeForSession(code);
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}
