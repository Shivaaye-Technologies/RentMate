import { Body, Screen, Title } from "../../src/ui";
export default function Nearby() {
  return (
    <Screen>
      <Title>Nearby</Title>
      <Body>
        Discover public activities and people in your chosen area, with location sharing under your control.
      </Body>
      <Title>Your privacy comes first</Title>
      <Body>
        Location permission will be optional. RentMate should show approximate distance only, never expose
        exact coordinates, and allow you to pause visibility.
      </Body>
      <Body>Recent crossings require mutual opt-in. Background tracking is not enabled in this build.</Body>
      <Body muted>
        Nearby map and activity discovery are still being connected. No location is being collected on this
        screen.
      </Body>
    </Screen>
  );
}
