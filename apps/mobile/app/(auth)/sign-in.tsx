import { useState } from "react";
import { Linking } from "react-native";
import { signInWithGoogle } from "../../src/lib/auth";
import { authClient, callbackUrl } from "../../src/lib/authClient";
import { Body, Button, Notice, Screen, Title } from "../../src/ui";

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithGoogle() {
    if (!authClient || busy) return;
    setBusy(true);
    setError(null);
    const result = await signInWithGoogle(authClient, callbackUrl());
    if (!result.ok) {
      setError(result.message ?? "Unable to start Google sign-in.");
      setBusy(false);
      return;
    }
    try {
      await Linking.openURL(result.url);
    } catch {
      setError("Could not open Google sign-in. Check your browser and try again.");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Screen>
      <Title>Welcome to RentMate</Title>
      <Body muted>
        Sign in securely with your Google account. RentMate is for adults (18+) meeting in non-sexual public
        and social settings.
      </Body>
      {error ? <Notice kind="error">{error}</Notice> : null}
      <Button label="Continue with Google" onPress={() => void continueWithGoogle()} busy={busy} />
      <Body muted>
        We use Google to verify your sign-in. Your Google password is never shared with RentMate.
      </Body>
    </Screen>
  );
}
