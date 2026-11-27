import { AuthHero } from "../../src/components/AuthHero";
import { useState } from "react";
import { signUp, type FieldErrors } from "../../src/lib/auth";
import { authClient, callbackUrl } from "../../src/lib/authClient";
import { Body, Button, Checkbox, Field, Notice, Screen, Title } from "../../src/ui";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!authClient) return;
    setBusy(true);
    setError(null);
    const r = await signUp(authClient, { email, password, adultConfirmed: adult }, callbackUrl());
    setBusy(false);
    if (!r.ok) {
      setFields(r.fields ?? {});
      setError(r.message ?? null);
    } else if (r.needsConfirmation) setSent(true);
  }

  if (sent) {
    return (
      <Screen>
        <Title>Check your email</Title>
        <Body>We sent a confirmation link to {email.trim()}. Open it on this phone, then sign in here.</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <AuthHero line="Create your account" />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={fields.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password (8+ characters, letters and numbers)"
        value={password}
        onChangeText={setPassword}
        error={fields.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Checkbox
        label="I confirm that I am 18 or older."
        checked={adult}
        onChange={setAdult}
        error={fields.adult}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Create account" onPress={() => void submit()} busy={busy} />
    </Screen>
  );
}
