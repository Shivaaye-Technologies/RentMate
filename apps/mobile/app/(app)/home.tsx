import { Link, Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title } from "../../src/ui";

type Gate = "checking" | "declared" | "needs-declaration" | { error: string };

/**
 * Signed-in home. Before anything else the member must have recorded their date of birth and 18+ declaration
 * (my_age_attestation). If that cannot be checked, the app stops here (fails closed) and offers a retry.
 */
export default function Home() {
  const [gate, setGate] = useState<Gate>("checking");

  const check = useCallback(() => {
    if (!supabase) return;
    setGate("checking");
    void Promise.resolve(supabase.rpc("my_age_attestation"))
      .then(({ data, error }) => {
        if (error) {
          // Function missing: the member still has to declare; the declaration screen fails closed with a message.
          if (error.code === "PGRST202") return setGate("needs-declaration");
          return setGate({ error: "We couldn't check your account. Check your connection and try again." });
        }
        setGate(Array.isArray(data) && data.length > 0 ? "declared" : "needs-declaration");
      })
      .catch(() =>
        setGate({ error: "We couldn't check your account. Check your connection and try again." }),
      );
  }, []);

  useFocusEffect(check);

  if (gate === "needs-declaration") return <Redirect href="/declare-age" />;
  return (
    <Screen>
      <Title>Welcome to RentMate</Title>
      {gate === "checking" ? <Body muted>Checking your account…</Body> : null}
      {typeof gate === "object" ? (
        <>
          <Notice kind="error">{gate.error}</Notice>
          <Button label="Try again" onPress={check} />
        </>
      ) : null}
      {gate === "declared" ? (
        <>
          <Body>
            This is an early Android build. Profiles, discovery, messages, calls and public bookings are being
            added step by step.
          </Body>
          <Body muted>
            Meetings on RentMate are non-sexual and happen in public, social places. 18+ only.
          </Body>
        </>
      ) : null}
      <Link href="/settings" asChild>
        <Button label="Settings" kind="plain" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
