import { useState } from "react";
import { AccountDeletionError, DELETION_RETRY_MESSAGE, deleteAccountViaServer } from "../accountDeletion";
import { apiBaseUrl } from "../api";
import { DELETE_CONFIRM_WORD, isDeleteConfirmed } from "../safety";
import { clearPhotoCache, supabase } from "../supabase";

/**
 * Deletes the signed-in account through the RentMate API only (P2-05). The server removes the photos and then the
 * account. There is no browser-side fallback: if the server can't be reached or doesn't confirm, nothing is deleted
 * and the member gets a message to try again. Returns null once the account is deleted, otherwise that message.
 */
export async function deleteMyAccount(
  options: { fetchFn?: typeof fetch; base?: string; reload?: () => void } = {},
): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) return "Please sign in again, then delete your account.";
  try {
    await deleteAccountViaServer(token, options.base ?? apiBaseUrl(), options.fetchFn);
  } catch (e) {
    return e instanceof AccountDeletionError ? e.message : DELETION_RETRY_MESSAGE;
  }
  clearPhotoCache();
  await supabase.auth.signOut().catch(() => undefined);
  (options.reload ?? (() => window.location.reload()))();
  return null;
}

/** Legal links, sign out, and permanent account deletion. */
export function AccountPanel({ email, onSignOut }: { email: string | undefined; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (!isDeleteConfirmed(typed)) return;
    setBusy(true);
    setError(null);
    const problem = await deleteMyAccount();
    if (problem) {
      setBusy(false);
      setError(problem);
    }
  }

  return (
    <div className="panel account">
      <p className="muted small center">Signed in as {email}</p>
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
            This permanently deletes your sign-in, profile, all your photos, likes, passes, matches, messages
            and blocks. Safety reports are kept without your name so the team can still act on them. It can't
            be undone.
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
