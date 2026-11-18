// Sign-up / sign-in helpers. Pure functions so the wording and rules are tested.
//
// Supabase Auth returns different errors that need different answers:
// an unconfirmed email needs a "resend" button, wrong credentials need a
// password reset link, and rate limits need "wait a few minutes", not a retry.

export type AuthErrorKind =
  | "email_not_confirmed"
  | "invalid_credentials"
  | "rate_limited"
  | "email_rate_limited"
  | "weak_password"
  | "already_registered"
  | "link_expired"
  | "same_password"
  | "signup_disabled"
  | "network"
  | "unknown";

export interface AuthProblem {
  kind: AuthErrorKind;
  message: string;
}

interface ErrorLike {
  code?: string | null;
  status?: number | null;
  message?: string | null;
  name?: string | null;
}

const MESSAGES: Record<AuthErrorKind, string> = {
  email_not_confirmed:
    "Your email isn't confirmed yet. Open the newest email from RentMate and tap the link, or send a new one below.",
  invalid_credentials:
    "That email and password don't match an account. Check them, or reset your password if you've forgotten it.",
  rate_limited: "Too many attempts. Please wait a few minutes before trying again.",
  email_rate_limited:
    "We've sent too many emails to this address recently. Please wait about an hour, then use the newest email you received. Each new email replaces the link in the previous one.",
  weak_password: "Choose a stronger password: at least 8 characters with letters and numbers.",
  already_registered:
    "There's already an account with this email. Sign in instead, or reset your password if you've forgotten it.",
  link_expired:
    "That email link has expired or was already used. Each new email replaces the previous link, so use the newest one, or request a new email below.",
  same_password: "Your new password must be different from your current one.",
  signup_disabled: "New sign-ups are paused right now. Please try again later.",
  network: "Can't reach the sign-in service. Check your internet connection and try again.",
  unknown: "Something went wrong. Please try again.",
};

/** Maps a Supabase Auth error (or a fetch failure) to a kind and a message people can act on. */
export function classifyAuthError(err: ErrorLike | null | undefined): AuthProblem {
  const code = (err?.code ?? "").toLowerCase();
  const msg = (err?.message ?? "").toLowerCase();
  const status = err?.status ?? null;
  const kind = ((): AuthErrorKind => {
    if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "email_not_confirmed";
    if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
      return "invalid_credentials";
    }
    if (code === "over_email_send_rate_limit" || msg.includes("email rate limit"))
      return "email_rate_limited";
    if (
      code === "over_request_rate_limit" ||
      code === "over_sms_send_rate_limit" ||
      status === 429 ||
      msg.includes("for security purposes") ||
      msg.includes("rate limit")
    ) {
      return "rate_limited";
    }
    if (code === "weak_password" || msg.includes("password should")) return "weak_password";
    if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) {
      return "already_registered";
    }
    if (code === "otp_expired" || code === "flow_state_expired" || msg.includes("invalid or has expired")) {
      return "link_expired";
    }
    if (code === "same_password") return "same_password";
    if (code === "signup_disabled" || code === "email_provider_disabled") return "signup_disabled";
    if (
      err?.name === "AuthRetryableFetchError" ||
      msg.includes("failed to fetch") ||
      msg.includes("network")
    ) {
      return "network";
    }
    return "unknown";
  })();
  return { kind, message: MESSAGES[kind] };
}

export const PASSWORD_MIN = 8;
/** Supabase (bcrypt) ignores anything past 72 bytes; refuse rather than silently truncate. */
export const PASSWORD_MAX = 72;

/** Client-side password rules (Supabase enforces its own minimum on the server too). */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use both letters and numbers.";
  return null;
}

export function emailProblem(email: string): string | null {
  const e = email.trim();
  if (!e) return "Enter your email.";
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "Enter a valid email address.";
  return null;
}

/**
 * Supabase hides whether an email is registered: signing up again with a
 * confirmed email returns a user with no identities and sends nothing.
 */
export function looksLikeExistingAccount(user: { identities?: unknown[] | null } | null | undefined) {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}

/** What an email link put in the address bar when it brought the visitor back. */
export interface AuthRedirect {
  /** "recovery" after a password-reset link, "signup" after a confirmation link. */
  type: string | null;
  problem: AuthProblem | null;
}

/** Reads Supabase's redirect parameters from the URL hash and query string. */
export function parseAuthRedirect(hash: string, search: string): AuthRedirect {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const get = (k: string) => params.get(k) ?? query.get(k);
  const type = get("type");
  const errorCode = get("error_code");
  const error = get("error");
  if (!errorCode && !error) return { type, problem: null };
  return {
    type,
    problem: classifyAuthError({
      code: errorCode ?? error,
      message: get("error_description") ?? "",
    }),
  };
}

/** True when the URL holds auth parameters that should be removed after reading. */
export function hasAuthParams(hash: string, search: string): boolean {
  return /(^|[#&?])(error|error_code|access_token|type)=/.test(`${hash}&${search}`);
}

/** Seconds to wait before another confirmation or reset email may be requested. */
export const RESEND_COOLDOWN_S = 60;

export function cooldownLeft(lastSentAt: number | null, now = Date.now(), seconds = RESEND_COOLDOWN_S) {
  if (!lastSentAt) return 0;
  return Math.min(seconds, Math.max(0, Math.ceil((lastSentAt + seconds * 1000 - now) / 1000)));
}

const SENT_KEY = "soulmate-auth-email-sent";

/** When an email was last sent to this address from this browser (survives reloads). */
export function readLastSent(email: string): number | null {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) ?? "{}") as Record<string, number>;
    return all[email.trim().toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

export function writeLastSent(email: string, at = Date.now()) {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) ?? "{}") as Record<string, number>;
    all[email.trim().toLowerCase()] = at;
    localStorage.setItem(SENT_KEY, JSON.stringify(all));
  } catch {
    // Storage can be unavailable (private mode); the in-memory cooldown still applies.
  }
}
