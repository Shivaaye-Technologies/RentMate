import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "../../src/lib/supabase";
import { classifyAuthError } from "../../src/lib/shared";
import { Body, Notice, Screen, Title } from "../../src/ui";

/**
 * rentmate://auth/callback?code=… from a confirmation email (PKCE). Exchanges the one-time code for a session on this
 * device. Works only once rentmate://auth/callback is in the Supabase Auth redirect allowlist (founder action).
 */
export default function AuthCallback() {
  const { code, error_description: linkError } = useLocalSearchParams<{
    code?: string;
    error_description?: string;
  }>();
  const [state, setState] = useState<"working" | "done" | { error: string }>("working");

  useEffect(() => {
    if (linkError) return setState({ error: classifyAuthError({ message: linkError }).message });
    if (!code || !supabase) return setState({ error: "This link is incomplete. Please sign in instead." });
    void supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => setState(error ? { error: classifyAuthError(error).message } : "done"))
      .catch((e: Error) => setState({ error: classifyAuthError(e).message }));
  }, [code, linkError]);

  if (state === "done") return <Redirect href="/home" />;
  return (
    <Screen>
      <Title>Confirming your email</Title>
      {state === "working" ? <Body muted>One moment…</Body> : <Notice kind="error">{state.error}</Notice>}
    </Screen>
  );
}
