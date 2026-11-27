import { Link } from "expo-router";
import { useState } from "react";
import { Linking } from "react-native";
import { signIn, signInWithGoogle, type FieldErrors } from "../../src/lib/auth";
import { authClient, callbackUrl } from "../../src/lib/authClient";
import { AuthHero } from "../../src/components/AuthHero";
import { Button, Field, Notice, Screen } from "../../src/ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"email" | "google" | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!authClient || busy) return;
    setBusy("email");
    setError(null);
    const r = await signIn(authClient, email, password);
    setBusy(null);
    // On success the session listener moves the member into the app.
    if (!r.ok) {
      setFields(r.fields ?? {});
      setError(r.message ?? null);
    }
  }

  async function continueWithGoogle() {
    if (!authClient || busy) return;
    setBusy("google");
    setError(null);
    const result = await signInWithGoogle(authClient, callbackUrl());
    if (!result.ok) {
      setError(result.message ?? "Unable to start Google sign-in.");
      setBusy(null);
      return;
    }
    try {
      await Linking.openURL(result.url);
    } catch {
      setError("Could not open Google sign-in. Check your browser and try again.");
    }
    setBusy(null);
  }

  return (
    <Screen>
      <AuthHero line="Cross paths with people who share your vibe." />
      <Button
        label="G  Continue with Google"
        kind="plain"
        onPress={() => void continueWithGoogle()}
        busy={busy === "google"}
      />
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
        onSubmitEditing={() => void submit()}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Sign in" onPress={() => void submit()} busy={busy === "email"} />
      <Link href="/forgot-password" asChild>
        <Button label="Forgot your password?" kind="plain" onPress={() => undefined} />
      </Link>
      <Link href="/sign-up" asChild>
        <Button label="New here? Create an account" kind="plain" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
