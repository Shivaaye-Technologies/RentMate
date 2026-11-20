import { useState } from "react";
import { requestPasswordReset } from "../../src/lib/auth";
import { authClient, resetUrl } from "../../src/lib/authClient";
import { Body, Button, Field, Notice, Screen, Title } from "../../src/ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!authClient) return;
    setBusy(true);
    setError(null);
    const r = await requestPasswordReset(authClient, email, resetUrl());
    setBusy(false);
    if (r.ok) return setSent(true);
    setFieldError(r.fields?.email ?? null);
    setError(r.message ?? null);
  }

  if (sent) {
    return (
      <Screen>
        <Title>Check your email</Title>
        <Body>
          If {email.trim()} has a RentMate account, we sent a link to choose a new password. Open it on this
          phone.
        </Body>
      </Screen>
    );
  }
  return (
    <Screen>
      <Title>Reset your password</Title>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={fieldError}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Send reset link" onPress={() => void submit()} busy={busy} />
    </Screen>
  );
}
