import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { completeEmailLink } from "../../src/lib/auth";
import { authClient } from "../../src/lib/authClient";
import { Body, Notice, Screen, Title } from "../../src/ui";

/** rentmate://auth/callback?code=… from a confirmation email (PKCE): signs the member in on this device. */
export default function AuthCallback() {
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [state, setState] = useState<"working" | "done" | { error: string }>("working");

  useEffect(() => {
    if (!authClient) return;
    void completeEmailLink(authClient, params).then((r) =>
      setState(r.ok ? "done" : { error: r.message ?? "Please sign in instead." }),
    );
    // The link's parameters are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "done") return <Redirect href="/home" />;
  return (
    <Screen>
      <Title>Confirming your email</Title>
      {state === "working" ? <Body muted>One moment…</Body> : <Notice kind="error">{state.error}</Notice>}
    </Screen>
  );
}
