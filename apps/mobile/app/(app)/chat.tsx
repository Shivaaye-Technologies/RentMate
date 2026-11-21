import { Body, Screen, Title } from "../../src/ui";
export default function Chat() {
  return (
    <Screen>
      <Title>Messages</Title>
      <Body>Your conversations will appear here after a mutual connection.</Body>
      <Body muted>Messaging UI and realtime delivery are not yet connected in this Android build. We won't show fake conversations.</Body>
    </Screen>
  );
}
