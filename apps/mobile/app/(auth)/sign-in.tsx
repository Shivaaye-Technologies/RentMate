import { Link } from "expo-router";
import { useState } from "react";
import { signIn, type FieldErrors } from "../../src/lib/auth";
import { authClient } from "../../src/lib/authClient";
import { Body, Button, Field, Notice, Screen, Title } from "../../src/ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!authClient) return;
    setBusy(true);
    setError(null);
    const r = await signIn(authClient, email, password);
    setBusy(false);
    // On success the session listener moves the member into the app.
    if (!r.ok) {
      setFields(r.fields ?? {});
      setError(r.message ?? null);
    }
  }

  return (
    <Screen>
      <Title>Welcome back</Title>
      <Body muted>RentMate is for adults (18+) who want to meet people in public, social settings.</Body>
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
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={fields.password}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Sign in" onPress={() => void submit()} busy={busy} />
      <Link href="/forgot-password" asChild>
        <Button label="Forgot your password?" kind="plain" onPress={() => undefined} />
      </Link>
      <Link href="/sign-up" asChild>
        <Button label="Create an account" kind="plain" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
