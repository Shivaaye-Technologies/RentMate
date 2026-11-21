import { Link, Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { profileDb } from "../../src/lib/data";
import { declarationStatus, type DeclarationStatus } from "../../src/lib/shared";
import { Body, Button, Notice, Screen, Title } from "../../src/ui";

/** Signed-in staging home. Age declaration is checked before any member feature is shown. */
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
      <Title>RentMate</Title>
      <Title>Nobody should have to feel alone.</Title>
      <Body>Meet people, make friends, find lawful companionship and join live social conversations.</Body>
      {gate === "checking" ? <Body muted>Checking your 18+ declaration…</Body> : null}
      {typeof gate === "object" ? (
        <>
          <Notice kind="error">{gate.error}</Notice>
          <Button label="Try again" onPress={check} />
        </>
      ) : null}
      {gate === "declared" ? (
        <>
          <Body muted>
            Adults 18+ only. Companionship is non-sexual and limited to lawful social activities.
          </Body>
          <Title>Explore RentMate</Title>
          <Link href="/discover" asChild>
            <Button label="Discover people" onPress={() => undefined} />
          </Link>
          <Link href="/companions" asChild>
            <Button label="Find or offer companionship" onPress={() => undefined} />
          </Link>
          <Link href="/live" asChild>
            <Button label="Live social rooms" onPress={() => undefined} />
          </Link>
          <Link href="/nearby" asChild>
            <Button label="Nearby and activities" kind="plain" onPress={() => undefined} />
          </Link>
          <Link href="/profile" asChild>
            <Button label="My profile" kind="plain" onPress={() => undefined} />
          </Link>
          <Link href="/settings" asChild>
            <Button label="Settings and safety" kind="plain" onPress={() => undefined} />
          </Link>
        </>
      ) : null}
    </Screen>
  );
}
