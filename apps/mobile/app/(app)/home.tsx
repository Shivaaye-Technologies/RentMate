import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { profileDb } from "../../src/lib/data";
import { declarationStatus, type DeclarationStatus } from "../../src/lib/shared";
import { Body, Notice, Screen, Title } from "../../src/ui";

/** Session landing route: enforce the 18+ declaration, then enter discovery. */
export default function Home() {
  const [gate, setGate] = useState<DeclarationStatus | "checking">("checking");
  const check = useCallback(() => {
    if (!profileDb) return;
    setGate("checking");
    void declarationStatus(profileDb).then(setGate);
  }, []);
  useFocusEffect(check);
  if (gate === "missing") return <Redirect href="/(app)/declare-age" />;
  if (gate === "declared") return <Redirect href="/(app)/discover" />;
  return (
    <Screen>
      <Title>RentMate</Title>
      <Body>Making meaningful connections, one hello at a time.</Body>
      {gate === "checking" ? <Body muted>Checking your 18+ declaration…</Body> : null}
      {typeof gate === "object" ? <Notice kind="error">{gate.error}</Notice> : null}
    </Screen>
  );
}
