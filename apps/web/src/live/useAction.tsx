import { useState } from "react";

/** Runs an action, shows its error or a confirmation, then reloads. */
export function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const messages = (
    <>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="alert info" role="status">
          {note}
        </p>
      )}
    </>
  );
  return { busy, run, messages, setError };
}
