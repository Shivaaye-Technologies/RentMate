import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { completeOAuthLink } from "../../src/lib/auth";
import { authClient } from "../../src/lib/authClient";
import { Body, Notice, Screen, Title } from "../../src/ui";

/** OAuth callback: exchanges Supabase's one-time PKCE code for the Google-authenticated session. */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [state, setState] = useState<"working" | "done" | { error: string }>("working");

  useEffect(() => {
    if (!authClient) return;
    void completeOAuthLink(authClient, params).then((r) =>
      setState(r.ok ? "done" : { error: r.message ?? "Please try Google sign-in again." }),
    );
    // OAuth callback parameters are handled once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "done") return <Redirect href="/home" />;
  return (
    <Screen>
      <Title>Signing you in</Title>
      {state === "working" ? (
        <Body muted>Completing secure Google sign-in…</Body>
      ) : (
        <Notice kind="error">{state.error}</Notice>
      )}
    </Screen>
  );
}
