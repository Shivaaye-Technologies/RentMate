import { useState } from "react";
import { DELETE_CONFIRM_WORD, isDeleteConfirmed } from "../safety";
import { clearPhotoCache, supabase } from "../supabase";

/** Legal links, sign out, and permanent account deletion. */
export function AccountPanel({
  email,
  photoPath,
  onSignOut,
}: {
  email: string | undefined;
  photoPath: string | null | undefined;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (!isDeleteConfirmed(typed)) return;
    setBusy(true);
    setError(null);
    // Photos live in Storage, which the database cannot delete for us.
    if (photoPath) await supabase.storage.from("photos").remove([photoPath]);
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    clearPhotoCache();
    await supabase.auth.signOut().catch(() => undefined);
    window.location.reload();
  }

  return (
    <div className="panel account">
      <p className="muted small center">Signed in as {email}</p>
      <nav className="legal-links" aria-label="Legal">
        <a href="/privacy.html">Privacy Policy</a>
        <a href="/terms.html">Terms of Use</a>
        <a href="/safety.html">Dating safety tips</a>
      </nav>
      <button className="btn block" onClick={onSignOut}>
        Sign out
      </button>

      {!open ? (
        <button className="btn link block danger" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      ) : (
        <div className="danger-zone">
          <h3>Delete your account</h3>
          <p className="small">
            This permanently deletes your profile, photo, likes, matches and messages. It can't be undone.
          </p>
          <label className="field">
            <span>Type {DELETE_CONFIRM_WORD} to confirm</span>
            <input
              value={typed}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          {error && <p className="alert error">{error}</p>}
          <button
            className="btn block danger-solid"
            disabled={busy || !isDeleteConfirmed(typed)}
            onClick={() => void deleteAccount()}
          >
            {busy ? "Deleting…" : "Permanently delete my account"}
          </button>
          <button className="btn link block" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
