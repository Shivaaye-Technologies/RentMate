import { Link } from "expo-router";
import { Body, Button, Screen, Title } from "../../src/ui";
export default function Companions() {
  return (
    <Screen>
      <Title>Companionship</Title>
      <Body>
        Find someone to share a little time with, or offer your time to another adult. Both men and women can
        request or offer companionship.
      </Body>
      <Title>What people can do together</Title>
      <Body>• Friendly conversation over coffee or a meal in a public place</Body>
      <Body>• Public walks, sightseeing and city exploration</Body>
      <Body>• Sports, music, events, museums and shared hobbies</Body>
      <Body>• Online conversation through approved voice or video features</Body>
      <Title>Marketplace setup in progress</Title>
      <Body>
        Companion listings, availability, booking requests, reviews and safety check-ins need their database,
        API and moderation workflows completed before bookings can be made. This screen does not accept
        bookings or payments yet.
      </Body>
      <Body>
        RentMate companionship is strictly non-sexual. No escorting, sexual services or private-address
        meetings.
      </Body>
      <Link href="/home" asChild>
        <Button label="Back to RentMate" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
