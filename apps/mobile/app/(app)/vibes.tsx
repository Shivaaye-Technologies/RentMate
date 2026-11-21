import { Link } from "expo-router";
import { Body, Button, Screen, Title } from "../../src/ui";
export default function Vibes() {
  return (
    <Screen>
      <Title>Vibes</Title>
      <Body>Join conversations around the things you love: music, sport, travel, food, games and everyday life.</Body>
      <Link href="/(app)/live" asChild><Button label="Explore live social rooms" onPress={() => undefined} /></Link>
      <Link href="/(app)/nearby" asChild><Button label="Find nearby activities" kind="plain" onPress={() => undefined} /></Link>
      <Link href="/(app)/companions" asChild><Button label="Explore companionship" kind="plain" onPress={() => undefined} /></Link>
      <Body muted>Live rooms are moderated. Voice/video participation is opt-in and subject to creator approval and safety checks.</Body>
    </Screen>
  );
}
