import { Body, Screen, Title } from "../../src/ui";
export default function Likes() {
  return (
    <Screen>
      <Title>Likes</Title>
      <Body>See your connections grow. People who like you and mutual matches will appear here when the likes and matching service is connected.</Body>
      <Body muted>Likes are not being fabricated or stored locally. This staging screen is ready for the authenticated likes endpoint.</Body>
    </Screen>
  );
}
