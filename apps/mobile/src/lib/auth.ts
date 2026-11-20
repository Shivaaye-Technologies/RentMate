/**
 * Android sign-in, sign-up and password reset on the existing Supabase Auth (no new backend). Validation and error
 * messages come from the web's shared rules (apps/web/src/auth.ts), so both apps say the same thing. The client is
 * passed in so every flow is testable without a device.
 *
 * Email links (confirmation, password reset) return to the app as rentmate://auth/callback and rentmate://auth/reset
 * with a one-time PKCE code. They work only after those URLs are added to Supabase Auth → Redirect URLs (a production
 * setting, founder action); until then the links open the website.
 */
import { classifyAuthError, emailProblem, looksLikeExistingAccount, passwordProblem } from "./shared";

type AuthErr = { code?: string; message?: string; status?: number; name?: string } | null;

/** The subset of supabase-js auth used here (structural, so a test double fits). */
export interface AuthClient {
  auth: {
    signInWithPassword(c: { email: string; password: string }): PromiseLike<{ error: AuthErr }>;
    signUp(c: { email: string; password: string; options?: { emailRedirectTo?: string } }): PromiseLike<{
      data: { user: { identities?: unknown[] | null } | null; session: unknown };
      error: AuthErr;
    }>;
    resetPasswordForEmail(email: string, o?: { redirectTo?: string }): PromiseLike<{ error: AuthErr }>;
    exchangeCodeForSession(code: string): PromiseLike<{ error: AuthErr }>;
    updateUser(attrs: { password: string }): PromiseLike<{ error: AuthErr }>;
  };
}

export const AUTH_CALLBACK_PATH = "auth/callback";
export const AUTH_RESET_PATH = "auth/reset";
export const ADULT_REQUIRED = "Please confirm that you are 18 or older.";

export type FieldErrors = { email?: string | null; password?: string | null; adult?: string | null };
export type AuthResult = { ok: true } | { ok: false; message?: string; fields?: FieldErrors };

const fail = (e: unknown): AuthResult => ({ ok: false, message: classifyAuthError(e as AuthErr).message });

export async function signIn(client: AuthClient, email: string, password: string): Promise<AuthResult> {
  const problem = emailProblem(email);
  if (problem || !password) {
    return { ok: false, fields: { email: problem, password: password ? null : "Enter your password." } };
  }
  try {
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export type SignUpResult = { ok: true; needsConfirmation: boolean } | Extract<AuthResult, { ok: false }>;

/** Nothing is sent to Supabase unless the explicit 18+ declaration is ticked (same rule as the web sign-up). */
export async function signUp(
  client: AuthClient,
  input: { email: string; password: string; adultConfirmed: boolean },
  redirectTo: string,
): Promise<SignUpResult> {
  const fields: FieldErrors = {
    email: emailProblem(input.email),
    password: passwordProblem(input.password),
    adult: input.adultConfirmed ? null : ADULT_REQUIRED,
  };
  if (fields.email || fields.password || fields.adult) return { ok: false, fields };
  try {
    const { data, error } = await client.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) return fail(error) as SignUpResult;
    if (looksLikeExistingAccount(data.user)) return fail({ code: "user_already_exists" }) as SignUpResult;
    return { ok: true, needsConfirmation: !data.session };
  } catch (e) {
    return fail(e) as SignUpResult;
  }
}

/** Always answers the same way whether or not the email has an account, so it reveals nothing about members. */
export async function requestPasswordReset(
  client: AuthClient,
  email: string,
  redirectTo: string,
): Promise<AuthResult> {
  const problem = emailProblem(email);
  if (problem) return { ok: false, fields: { email: problem } };
  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    // Rate limits and network problems are worth showing; "no such user" never is (Supabase does not report it).
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Finishes an email link: exchanges the one-time PKCE code for a session on this device. */
export async function completeEmailLink(
  client: AuthClient,
  params: { code?: string | string[]; error_description?: string | string[] },
): Promise<AuthResult> {
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v);
  const linkError = one(params.error_description);
  if (linkError) return fail({ message: linkError });
  const code = one(params.code);
  if (!code)
    return { ok: false, message: "This link is incomplete or was already used. Please sign in instead." };
  try {
    const { error } = await client.auth.exchangeCodeForSession(code);
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Sets a new password for the signed-in (recovery) session, with the same password rules as sign-up. */
export async function setNewPassword(
  client: AuthClient,
  password: string,
  repeat: string,
): Promise<AuthResult> {
  const problem =
    passwordProblem(password) ?? (password === repeat ? null : "The two passwords don't match.");
  if (problem) return { ok: false, fields: { password: problem } };
  try {
    const { error } = await client.auth.updateUser({ password });
    return error ? fail(error) : { ok: true };
  } catch (e) {
    return fail(e);
  }
}
