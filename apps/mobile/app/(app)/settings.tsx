import { useState } from "react";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import {
  AccountDeletionError,
  DELETE_CONFIRM_WORD,
  DELETION_RETRY_MESSAGE,
  deleteAccountViaServer,
  isDeleteConfirmed,
} from "../../src/lib/shared";
import { Body, Button, Field, Notice, Screen, Title } from "../../src/ui";

/**
 * Sign out and permanent account deletion. Deletion goes only through the RentMate API (DELETE /api/v1/account),
 * which removes photos and then the account; the app never deletes anything itself. On any failure nothing is
 * deleted and the member can try again (same flow as the web, shared code).
 */
export default function Settings() {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    await supabase?.auth.signOut().catch(() => undefined);
  }

  async function deleteAccount() {
    if (!supabase || !isDeleteConfirmed(typed)) return;
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setBusy(false);
      return setError("Please sign in again, then delete your account.");
    }
    try {
      await deleteAccountViaServer(token, apiBaseUrl);
    } catch (e) {
      setBusy(false);
      return setError(e instanceof AccountDeletionError ? e.message : DELETION_RETRY_MESSAGE);
    }
    await supabase.auth.signOut().catch(() => undefined);
  }

  return (
    <Screen>
      <Title>Settings</Title>
      <Button label="Sign out" kind="plain" onPress={() => void signOut()} />
      <Title>Delete your account</Title>
      <Body>
        This permanently deletes your sign-in, profile, photos, likes, matches and messages. Safety reports
        are kept without your name. It can’t be undone.
      </Body>
      <Field
        label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button
        label="Permanently delete my account"
        kind="danger"
        onPress={() => void deleteAccount()}
        busy={busy}
        disabled={!isDeleteConfirmed(typed)}
      />
    </Screen>
  );
}
