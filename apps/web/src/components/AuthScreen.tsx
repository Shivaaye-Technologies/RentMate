import { useEffect, useRef, useState, type FormEvent } from "react";
import { Monogram } from "./Monogram";
import { BRAND } from "../brand";
import { ThemeToggle } from "./ThemeToggle";
import {
  classifyAuthError,
  cooldownLeft,
  emailProblem,
  looksLikeExistingAccount,
  passwordProblem,
  readLastSent,
  writeLastSent,
  type AuthProblem,
} from "../auth";
import { supabase } from "../supabase";
import { Icon } from "./Icon";

type Mode = "signin" | "signup" | "forgot";

/** Public pages anyone can read without an account (served from public/). */
export const PUBLIC_PAGES = [
  { href: "/privacy.html", label: "Privacy" },
  { href: "/terms.html", label: "Terms" },
  { href: "/safety.html", label: "Dating safety" },
  { href: "/delete-account.html", label: "Delete your account" },
] as const;

/** Where email links bring people back: this same site (must be in Supabase's Redirect URLs). */
const redirectTo = () => (typeof window === "undefined" ? undefined : window.location.origin);

/** Ticks once a second while a cooldown is running. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function AuthScreen({ initialProblem = null }: { initialProblem?: AuthProblem | null }) {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(initialProblem);
  const [fieldError, setFieldError] = useState<{ email?: string; password?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  /** Email address we just sent a confirmation or reset link to. */
  const [sentTo, setSentTo] = useState<{ email: string; kind: "signup" | "recovery" } | null>(null);
  const [lastSent, setLastSent] = useState<number | null>(null);
  const inFlight = useRef(false);

  const wait = cooldownLeft(lastSent, useNow(lastSent !== null));
  const cleanEmail = email.trim();

  useEffect(() => {
    setLastSent(cleanEmail ? readLastSent(cleanEmail) : null);
  }, [cleanEmail]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setProblem(null);
    setFieldError({});
    setNotice(null);
  };

  const markSent = () => {
    const at = Date.now();
    writeLastSent(cleanEmail, at);
    setLastSent(at);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Ignore repeated taps while a request is running.
    if (inFlight.current) return;
    setProblem(null);
    setNotice(null);
    const errs = {
      email: emailProblem(email) ?? undefined,
      password:
        mode === "forgot"
          ? undefined
          : ((mode === "signup" ? passwordProblem(password) : password ? null : "Enter your password.") ??
            undefined),
    };
    setFieldError(errs);
    if (errs.email || errs.password) return;
    if ((mode === "signup" || mode === "forgot") && wait > 0) {
      setNotice(`Please wait ${wait}s before asking for another email.`);
      return;
    }

    inFlight.current = true;
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: redirectTo() },
        });
        if (error) setProblem(classifyAuthError(error));
        else if (looksLikeExistingAccount(data.user))
          setProblem(classifyAuthError({ code: "user_already_exists" }));
        else if (!data.session) {
          markSent();
          setSentTo({ email: cleanEmail, kind: "signup" });
        }
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) setProblem(classifyAuthError(error));
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo: redirectTo() });
        if (error) setProblem(classifyAuthError(error));
        else {
          markSent();
          setSentTo({ email: cleanEmail, kind: "recovery" });
        }
      }
    } catch (err) {
      console.error("Authentication request failed", err);
      setProblem(classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function resend(target: string) {
    if (inFlight.current || cooldownLeft(readLastSent(target)) > 0) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: target,
        options: { emailRedirectTo: redirectTo() },
      });
      if (error) setProblem(classifyAuthError(error));
      else {
        writeLastSent(target);
        setLastSent(Date.now());
        setNotice("New email sent. Use the link in this newest email; older links no longer work.");
      }
    } catch {
      setProblem(classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const hero = (
    <div className="auth-hero">
      <div className="auth-top">
        <p className="brand on-dark">
          <Monogram size={34} />
          <span className="wordmark">{BRAND.name}</span>
        </p>
        <ThemeToggle />
      </div>
      <p className="eyebrow">{BRAND.tagline}</p>
      <h1 className="display-xl">
        Real people. <em>Real experiences.</em>
      </h1>
      <p className="lede">
        Dating, friendship and social connection for verified adults, matched on what you love, not just a
        photo.
      </p>
      <a className="btn demo-cta" href="#demo">
        Try Demo Mode, no sign-up
      </a>
      <p className="demo-cta-note">
        Explore fictional profiles with simulated likes, matches and chat. No real people are involved.
      </p>
      <ul className="pillars" aria-label="RentMate experiences">
        <li>
          <strong>Online</strong>
          <span>Matches, chat, and soon live rooms and private calls</span>
          <small className="pill-status ready">Dating & chat available</small>
        </li>
        <li>
          <strong>Physical</strong>
          <span>
            Verified companions for coffee, meals, events and city walks (non-sexual, public places)
          </span>
          <small className="pill-status ready">Booking requests available</small>
        </li>
        <li>
          <strong>Hybrid</strong>
          <span>Meet online first, then choose to meet in public</span>
          <small className="pill-status soon">In development</small>
        </li>
      </ul>
      <p className="hero-rule">18+ only · Verified members · No sexual services of any kind</p>
    </div>
  );

  const footer = (
    <footer className="public-links" aria-label="About RentMate">
      {PUBLIC_PAGES.map((p) => (
        <a key={p.href} href={p.href}>
          {p.label}
        </a>
      ))}
    </footer>
  );

  // "Check your email" after sign-up or a password reset request.
  if (sentTo) {
    const left = cooldownLeft(lastSent, Date.now());
    return (
      <main className="auth">
        {hero}
        <section className="panel auth-card" aria-live="polite">
          <span className="sent-icon" aria-hidden="true">
            <Icon name="mail" size={28} />
          </span>
          <h2 className="display-sm">Check your email</h2>
          <p>
            We sent a {sentTo.kind === "signup" ? "confirmation" : "password reset"} link to{" "}
            <strong>{sentTo.email}</strong>. Open it on this device to continue.
          </p>
          <ul className="tips">
            <li>It can take a few minutes. Check Spam or Promotions too.</li>
            <li>Only the newest email works: each new email replaces the previous link.</li>
          </ul>
          {problem && (
            <p className="alert error" role="alert">
              {problem.message}
            </p>
          )}
          {notice && <p className="alert info">{notice}</p>}
          {sentTo.kind === "signup" && (
            <button
              className="btn block"
              disabled={busy || wait > 0}
              onClick={() => void resend(sentTo.email)}
            >
              {busy
                ? "Sending…"
                : wait > 0 || left > 0
                  ? `Resend email in ${Math.max(wait, left)}s`
                  : "Resend email"}
            </button>
          )}
          <button
            className="btn dark block"
            onClick={() => {
              setSentTo(null);
              setPassword("");
              switchMode("signin");
            }}
          >
            Back to sign in
          </button>
        </section>
        {footer}
      </main>
    );
  }

  const title = mode === "signup" ? "Create account" : mode === "signin" ? "Sign in" : "Reset password";

  return (
    <main className="auth">
      {hero}

      <form className="panel auth-card" onSubmit={submit} noValidate aria-label={title}>
        {mode === "forgot" ? (
          <div className="auth-sub">
            <button
              type="button"
              className="icon-btn"
              aria-label="Back to sign in"
              onClick={() => switchMode("signin")}
            >
              <Icon name="back" size={20} />
            </button>
            <h2 className="display-sm">Reset your password</h2>
          </div>
        ) : (
          <div className="segmented" role="tablist" aria-label="Account">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              className={mode === "signin" ? "active" : ""}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
          </div>
        )}

        {mode === "forgot" && (
          <p className="muted small">
            Enter your account email and we'll send you a link to choose a new password.
          </p>
        )}

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={!!fieldError.email}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {fieldError.email && <small className="err">{fieldError.email}</small>}
        </label>

        {mode !== "forgot" && (
          <label className="field">
            <span>Password</span>
            <span className="password-wrap">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
                maxLength={72}
                aria-invalid={!!fieldError.password}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="reveal"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
              >
                <Icon name={showPassword ? "eyeOff" : "eye"} size={20} />
              </button>
            </span>
            {mode === "signup" && !fieldError.password && (
              <small className="muted">At least 8 characters, with letters and numbers.</small>
            )}
            {fieldError.password && <small className="err">{fieldError.password}</small>}
          </label>
        )}

        {problem && (
          <div className="alert error" role="alert">
            <p>{problem.message}</p>
            {problem.kind === "email_not_confirmed" && cleanEmail && (
              <button
                type="button"
                className="btn small"
                disabled={busy || wait > 0}
                onClick={() => void resend(cleanEmail)}
              >
                {wait > 0 ? `Resend confirmation in ${wait}s` : "Resend confirmation email"}
              </button>
            )}
            {(problem.kind === "invalid_credentials" || problem.kind === "already_registered") && (
              <button
                type="button"
                className="btn small"
                onClick={() => switchMode(problem.kind === "already_registered" ? "signin" : "forgot")}
              >
                {problem.kind === "already_registered" ? "Go to sign in" : "Reset my password"}
              </button>
            )}
          </div>
        )}
        {notice && (
          <p className="alert info" role="status">
            {notice}
          </p>
        )}

        <button className="btn dark block" disabled={busy} aria-busy={busy}>
          {busy
            ? "Please wait…"
            : mode === "signup"
              ? "Create account"
              : mode === "signin"
                ? "Sign in"
                : "Send reset link"}
        </button>

        {mode === "signin" && (
          <button type="button" className="btn link block" onClick={() => switchMode("forgot")}>
            Forgot your password?
          </button>
        )}
        {mode === "signup" && (
          <p className="fine">We'll email you a link to confirm your address before you can sign in.</p>
        )}
        <p className="fine">
          You must be 18 or older to use RentMate. By creating an account you agree to the{" "}
          <a href="/terms.html">Terms of Use</a> and <a href="/privacy.html">Privacy Policy</a>.
        </p>
      </form>

      {footer}
    </main>
  );
}

/** Shown after a password-reset link: choose a new password (the link signed you in). */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const p = passwordProblem(password);
    if (p) {
      setError(p);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setError(classifyAuthError(error).message);
      else setDone(true);
    } catch {
      setError(classifyAuthError({ name: "AuthRetryableFetchError" }).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth single">
      <form className="panel auth-card" onSubmit={submit} noValidate aria-label="Choose a new password">
        <h2 className="display-sm">Choose a new password</h2>
        {done ? (
          <>
            <p className="alert info" role="status">
              Your password has been changed.
            </p>
            <button type="button" className="btn dark block" onClick={onDone}>
              Continue
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>New password</span>
              <span className="password-wrap">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={72}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="reveal"
                  aria-label={show ? "Hide password" : "Show password"}
                  aria-pressed={show}
                  onClick={() => setShow((s) => !s)}
                >
                  <Icon name={show ? "eyeOff" : "eye"} size={20} />
                </button>
              </span>
              <small className="muted">At least 8 characters, with letters and numbers.</small>
            </label>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <button className="btn dark block" disabled={busy}>
              {busy ? "Saving…" : "Save new password"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
