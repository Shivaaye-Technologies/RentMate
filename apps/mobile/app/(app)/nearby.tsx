import { Link, type Href } from "expo-router";
import { View, Text } from "react-native";
import { Body, Button, Screen, Title, usePalette } from "../../src/ui";
export default function Nearby() {
  const c = usePalette();
  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>AROUND YOU</Text>
      <Title>Nearby & activities</Title>
      <Body>
        Discover public activities and people in your chosen area, while keeping your exact location private.
      </Body>
      <View
        style={{
          minHeight: 190,
          borderRadius: 24,
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 22,
          gap: 8,
        }}
      >
        <Text style={{ fontSize: 42 }}>⌖</Text>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: "700" }}>Your map is waiting</Text>
        <Text style={{ color: c.muted, textAlign: "center" }}>
          Map tiles and nearby activity results will appear after optional location permission and the
          privacy-safe nearby API are connected.
        </Text>
      </View>
      <Title>Privacy first</Title>
      <Body>• Location is optional and off until you choose to share it.</Body>
      <Body>• Approximate distance only. Exact coordinates are never shown to other members.</Body>
      <Body>• No background tracking or automatic location history.</Body>
      <Link href={"/(app)/vibes" as Href} asChild>
        <Button label="Explore community vibes" onPress={() => undefined} />
      </Link>
    </Screen>
  );
}
