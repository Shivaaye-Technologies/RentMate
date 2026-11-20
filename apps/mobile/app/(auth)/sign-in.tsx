import { Link } from "expo-router";
import { useState } from "react";
import { supabase } from "../../src/lib/supabase";
import { classifyAuthError, emailProblem } from "../../src/lib/shared";
import { Body, Button, Field, Notice, Screen, Title } from "../../src/ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    const problem = emailProblem(email) ?? (password ? null : "Enter your password.");
    if (problem) return setError(problem);
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) setError(classifyAuthError(authError).message);
      // On success the session listener moves the member into the app.
    } catch (e) {
      setError(classifyAuthError(e as Error).message);
    } finally {
      setBusy(false);
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
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Sign in" onPress={() => void signIn()} busy={busy} />
      <Link href="/sign-up" asChild>
        <Button label="Create an account" kind="plain" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
