import { useState, type FormEvent } from "react";
import { supabase } from "../supabase";

type Mode = "signin" | "signup";

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setError(error.message);
      else if (!data.session) setNotice("Check your email to confirm your account, then sign in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setBusy(false);
  }

  return (
    <main className="auth">
      <div className="auth-hero">
        <span className="squiggle" aria-hidden="true" />
        <p className="brand on-dark">
          <span className="logo-mark small" aria-hidden="true">
            ♥
          </span>
          SOULMATE.AI
        </p>
        <h1 className="display-xl">
          Find your <em>Crush</em>
        </h1>
        <p className="lede">…or a new friend. Matched on what you love, not just a photo.</p>
        <ul className="hero-points">
          <li>
            <b className="dot lilac" /> Profiles picked for you
          </li>
          <li>
            <b className="dot green" /> It's a Match when you both like
          </li>
          <li>
            <b className="dot yellow" /> Meet when you're both ready
          </li>
        </ul>
      </div>

      <form className="panel auth-card" onSubmit={submit}>
        <div className="segmented" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "active" : ""}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signin"}
            className={mode === "signin" ? "active" : ""}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <p className="alert error">{error}</p>}
        {notice && <p className="alert info">{notice}</p>}

        <button className="btn dark block" disabled={busy}>
          {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <p className="fine">You must be 18 or older to use SOULMATE.AI.</p>
      </form>
    </main>
  );
}
