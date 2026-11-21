import { Link } from "expo-router";
import { Body, Button, Screen, Title } from "../../src/ui";
export default function Profile() {
  return (
    <Screen>
      <Title>Your profile</Title>
      <Body>Show people what makes you, you. Add a friendly introduction, interests and the activities you enjoy.</Body>
      <Title>Profile completion</Title>
      <Body muted>Photo management and profile editing will be enabled when the mobile profile editor is connected to the existing secure profile API.</Body>
      <Link href="/(app)/companions" asChild><Button label="Companionship options" onPress={() => undefined} /></Link>
      <Link href="/(app)/nearby" asChild><Button label="Nearby and activities" kind="plain" onPress={() => undefined} /></Link>
      <Link href="/(app)/settings" asChild><Button label="Settings and safety" kind="plain" onPress={() => undefined} /></Link>
    </Screen>
  );
}
