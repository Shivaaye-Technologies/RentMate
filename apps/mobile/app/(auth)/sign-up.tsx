import * as Linking from "expo-linking";
import { useState } from "react";
import { supabase } from "../../src/lib/supabase";
import {
  classifyAuthError,
  emailProblem,
  looksLikeExistingAccount,
  passwordProblem,
} from "../../src/lib/shared";
import { Body, Button, Checkbox, Field, Notice, Screen, Title } from "../../src/ui";

const ADULT_CONFIRM_LABEL = "I confirm that I am 18 or older.";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adult, setAdult] = useState(false);
  const [errors, setErrors] = useState<{
    email?: string | null;
    password?: string | null;
    adult?: string | null;
  }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function signUp() {
    const next = {
      email: emailProblem(email),
      password: passwordProblem(password),
      adult: adult ? null : "Please confirm that you are 18 or older.",
    };
    setErrors(next);
    // Nothing is sent without the explicit 18+ declaration (same rule as the web sign-up).
    if (next.email || next.password || next.adult || !supabase) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        // Needs rentmate://auth/callback in Supabase Auth redirect URLs; otherwise the link opens the website.
        options: { emailRedirectTo: Linking.createURL("auth/callback") },
      });
      if (authError) setError(classifyAuthError(authError).message);
      else if (looksLikeExistingAccount(data.user))
        setError(classifyAuthError({ code: "user_already_exists" }).message);
      else if (!data.session) setSent(true);
    } catch (e) {
      setError(classifyAuthError(e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Screen>
        <Title>Check your email</Title>
        <Body>We sent a confirmation link to {email.trim()}. Open it, then sign in here.</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Create your account</Title>
      <Body muted>
        RentMate is only for adults (18+). Meetings are non-sexual and happen in public, social places.
      </Body>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password (8+ characters, letters and numbers)"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Checkbox label={ADULT_CONFIRM_LABEL} checked={adult} onChange={setAdult} error={errors.adult} />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Create account" onPress={() => void signUp()} busy={busy} />
    </Screen>
  );
}
