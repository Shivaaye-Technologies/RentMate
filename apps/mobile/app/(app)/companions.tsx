import { Link } from "expo-router";
import { View, Text } from "react-native";
import { Body, Button, Screen, Title, usePalette } from "../../src/ui";
const activities = [
  ["☕", "Coffee & conversation", "Meet for a friendly chat in a public café."],
  ["🚶", "Walks & city exploring", "Discover public places and local sights together."],
  ["🎵", "Music, sport & events", "Share a concert, match screening or community event."],
  ["🎨", "Hobbies & learning", "Find someone to enjoy a class or creative activity with."],
];
export default function Companions() {
  const c = usePalette();
  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>MEET WITH PURPOSE</Text>
      <Title>Companionship</Title>
      <Body>Find someone to share a little time with, or offer your time to another adult.</Body>
      {activities.map(([icon, title, description]) => (
        <View
          key={title}
          style={{
            padding: 16,
            borderRadius: 18,
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: 1,
            gap: 7,
          }}
        >
          <Text style={{ fontSize: 26 }}>{icon}</Text>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: "700" }}>{title}</Text>
          <Text style={{ color: c.muted, lineHeight: 21 }}>{description}</Text>
        </View>
      ))}
      <Title>Bookings are not enabled yet</Title>
      <Body>
        Listings, availability, booking requests, reviews and safety check-ins need their approved API and
        moderation workflows before bookings can be made. This screen does not accept bookings or payments.
      </Body>
      <Body muted>
        Strictly non-sexual companionship. No escorting, sexual services or private-address meetings.
      </Body>
      <Link href="/(app)/nearby" asChild>
        <Button label="Find nearby activities" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
