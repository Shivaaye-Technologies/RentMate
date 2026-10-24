import { useState } from "react";
import { DELETE_CONFIRM_WORD, isDeleteConfirmed } from "../safety";
import { clearPhotoCache, supabase } from "../supabase";

/** Legal links, sign out, and permanent account deletion. */
/** Every file in your own photo folder (Storage RLS only lists your own folder for writing). */
async function ownPhotoFiles(userId: string, known: string[]): Promise<string[]> {
  const { data } = await supabase.storage.from("photos").list(userId, { limit: 100 });
  const listed = (data ?? []).map((f) => `${userId}/${f.name}`);
  return [...new Set([...known, ...listed])];
}

export function AccountPanel({
  userId,
  email,
  photoPaths,
  onSignOut,
}: {
  userId: string;
  email: string | undefined;
  photoPaths: string[];
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
    const files = await ownPhotoFiles(userId, photoPaths).catch(() => photoPaths);
    if (files.length > 0) {
      const { error: removeError } = await supabase.storage.from("photos").remove(files);
      if (removeError) {
        setBusy(false);
        setError(
          `Couldn't delete your photos, so your account wasn't deleted yet. Please try again. (${removeError.message})`,
        );
        return;
      }
    }
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
