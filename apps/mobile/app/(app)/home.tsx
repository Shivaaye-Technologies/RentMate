import { Link, Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { profileDb } from "../../src/lib/data";
import { declarationStatus, type DeclarationStatus } from "../../src/lib/shared";
import { Body, Button, Notice, Screen, Title } from "../../src/ui";

/**
 * Signed-in home. Before anything else the member must have recorded their date of birth and 18+ declaration
 * (shared declarationStatus → my_age_attestation). If that cannot be checked, the app stops here (fails closed) and
 * offers a retry.
 */
export default function Home() {
  const [gate, setGate] = useState<DeclarationStatus | "checking">("checking");

  const check = useCallback(() => {
    if (!profileDb) return;
    setGate("checking");
    void declarationStatus(profileDb).then(setGate);
  }, []);

  useFocusEffect(check);

  if (gate === "missing") return <Redirect href="/declare-age" />;
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
