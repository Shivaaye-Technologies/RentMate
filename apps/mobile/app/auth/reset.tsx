import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { completeEmailLink, setNewPassword } from "../../src/lib/auth";
import { authClient } from "../../src/lib/authClient";
import { Body, Button, Field, Notice, Screen, Title } from "../../src/ui";

/** rentmate://auth/reset?code=… from a password-reset email: opens a recovery session, then sets a new password. */
export default function ResetPassword() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [phase, setPhase] = useState<"opening" | "form" | "done" | { error: string }>("opening");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authClient) return;
    void completeEmailLink(authClient, params).then((r) =>
      setPhase(r.ok ? "form" : { error: r.message ?? "Please request a new link." }),
    );
    // The link's parameters are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!authClient) return;
    setBusy(true);
    setError(null);
    const r = await setNewPassword(authClient, password, repeat);
    setBusy(false);
    if (r.ok) return setPhase("done");
    setFieldError(r.fields?.password ?? null);
    setError(r.message ?? null);
  }

  if (phase === "done") return <Redirect href="/home" />;
  if (phase === "opening") {
    return (
      <Screen>
        <Title>Reset your password</Title>
        <Body muted>One moment…</Body>
      </Screen>
    );
  }
  if (typeof phase === "object") {
    return (
      <Screen>
        <Title>Reset your password</Title>
        <Notice kind="error">{phase.error}</Notice>
      </Screen>
    );
  }
  return (
    <Screen>
      <Title>Choose a new password</Title>
      <Field
        label="New password (8+ characters, letters and numbers)"
        value={password}
        onChangeText={setPassword}
        error={fieldError}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Field
        label="Repeat the new password"
        value={repeat}
        onChangeText={setRepeat}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Save new password" onPress={() => void submit()} busy={busy} />
    </Screen>
  );
}
