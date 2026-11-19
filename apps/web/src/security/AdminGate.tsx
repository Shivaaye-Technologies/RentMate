import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { decideGate, mfaApi, SIX_DIGITS, type SecurityStatus } from "./mfa";

/** In front of every admin page: enrol or verify MFA when the database requires it for this account. */
export function AdminGate({ children, onExit }: { children: ReactNode; onExit: () => void }) {
  const [status, setStatus] = useState<SecurityStatus | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setStatus(await mfaApi.status());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check your security settings.");
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (status === undefined) return <div className="spinner" aria-hidden="true" />;
  const gate = decideGate(status);
  if (gate === "pass") return <>{children}</>;
  return (
    <main className="mfa-gate">
      <button className="btn small" onClick={onExit}>
        ← Back
      </button>
      <h1 className="display-sm">Two-step verification</h1>
      <p className="muted">
        Admin and moderator accounts need a code from an authenticator app (Google Authenticator, Microsoft
        Authenticator, 1Password and similar) in addition to the password.
      </p>
      {error && <p className="alert error">{error}</p>}
      {gate === "enroll" ? <Enroll onDone={reload} /> : <Challenge onDone={reload} />}
    </main>
  );
}

export function Enroll({ onDone }: { onDone: () => Promise<void> }) {
  const [factor, setFactor] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setFactor(await mfaApi.enroll());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start setup.");
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factor || !SIX_DIGITS.test(code)) return;
    setBusy(true);
    setError(null);
    try {
      await mfaApi.verify(factor.factorId, code);
      setCodes(await mfaApi.generateRecoveryCodes());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "That code didn't work. Check the time on your phone and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />;
  return (
    <section className="panel">
      <h2>Set up your authenticator</h2>
      {!factor ? (
        <button className="btn dark" onClick={() => void start()} disabled={busy}>
          Start setup
        </button>
      ) : (
        <>
          <p>Scan this code with your authenticator app, then enter the 6-digit code it shows.</p>
          <img
            className="mfa-qr"
            src={factor.qr}
            alt="QR code for your authenticator app"
            width={200}
            height={200}
          />
          <p className="muted small">
            Can't scan? Enter this key: <code className="mfa-secret">{factor.secret}</code>
          </p>
          <form className="row" onSubmit={verify}>
            <input
              aria-label="6-digit code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <button className="btn dark" disabled={busy || !SIX_DIGITS.test(code)}>
              Verify
            </button>
          </form>
        </>
      )}
      {error && <p className="alert error">{error}</p>}
    </section>
  );
}

function Challenge({ onDone }: { onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (recovery) {
        const result = await mfaApi.useRecoveryCode(code);
        if (result === "locked")
          throw new Error("Too many attempts. Try again in an hour, or ask another admin.");
        if (result === "invalid") throw new Error("That recovery code isn't valid or was already used.");
      } else {
        const factorId = await mfaApi.firstVerifiedFactor();
        if (!factorId) throw new Error("No authenticator is set up on this account.");
        await mfaApi.verify(factorId, code);
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>{recovery ? "Use a recovery code" : "Enter your 6-digit code"}</h2>
      {recovery && (
        <p className="muted small">
          A recovery code gives you 15 minutes to set up a new authenticator, and signs out your other
          devices.
        </p>
      )}
      <form className="row" onSubmit={submit}>
        <input
          aria-label={recovery ? "Recovery code" : "6-digit code"}
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={recovery ? 20 : 6}
          value={code}
          onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, ""))}
        />
        <button
          className="btn dark"
          disabled={busy || (!recovery && !SIX_DIGITS.test(code)) || (recovery && code.trim().length < 12)}
        >
          Continue
        </button>
      </form>
      <button className="link small" onClick={() => setRecovery((v) => !v)}>
        {recovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
      {error && <p className="alert error">{error}</p>}
    </section>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  return (
    <section className="panel">
      <h2>Save your recovery codes</h2>
      <p>
        Each code works once if you lose your phone. Store them somewhere safe (a password manager). They will
        not be shown again.
      </p>
      <ol className="mfa-codes">
        {codes.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ol>
      <label className="row">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved
        these codes
      </label>
      <button className="btn dark" disabled={!saved} onClick={() => void onDone()}>
        Continue
      </button>
    </section>
  );
}

/** Admin console: who still needs MFA, set up my own authenticator, and switch mandatory MFA on or off. */
export function MfaSettings() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [ready, setReady] = useState<{ user_id: string; roles: string[]; has_factor: boolean }[] | null>(
    null,
  );
  const [enrolling, setEnrolling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const s = await mfaApi.status();
      setStatus(s);
      setReady(await mfaApi.readiness().catch(() => null));
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!status?.privileged) return null;
  const missing = (ready ?? []).filter((r) => !r.has_factor).length;

  async function toggle(on: boolean) {
    setMessage(null);
    try {
      await mfaApi.setRequired(on);
      setMessage(on ? "MFA is now required for every admin and moderator." : "MFA is no longer required.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Couldn't change the setting.");
    }
  }

  return (
    <section className="panel mfa-settings" aria-label="Admin security">
      <h2>Admin security</h2>
      <p>
        Mandatory MFA: <strong>{status.mfa_required ? "on" : "off"}</strong> · This session:{" "}
        <strong>{status.aal === "aal2" ? "verified with MFA" : "password only"}</strong> · Your authenticator:{" "}
        <strong>{status.has_factor ? "set up" : "not set up"}</strong>
      </p>
      {ready && (
        <p className="muted small">
          {missing === 0
            ? "Every admin and moderator has MFA."
            : `${missing} admin or moderator account(s) still need to set up MFA.`}
        </p>
      )}
      {!status.has_factor && !enrolling && (
        <button className="btn small dark" onClick={() => setEnrolling(true)}>
          Set up MFA for my account
        </button>
      )}
      {enrolling && (
        <Enroll
          onDone={async () => {
            setEnrolling(false);
            await load();
          }}
        />
      )}
      {ready && (
        <button
          className="btn small"
          disabled={!status.mfa_required && (missing > 0 || status.aal !== "aal2")}
          onClick={() => void toggle(!status.mfa_required)}
        >
          {status.mfa_required ? "Turn off mandatory MFA" : "Require MFA for all admins and moderators"}
        </button>
      )}
      {!status.mfa_required && status.aal !== "aal2" && status.has_factor && (
        <p className="muted small">Sign in again and verify with your app to change this setting.</p>
      )}
      {message && <p className="alert info">{message}</p>}
    </section>
  );
}
