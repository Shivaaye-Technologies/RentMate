import { Link } from "expo-router";
import { View, Text } from "react-native";
import { Body, Button, Screen, Title, usePalette } from "../../src/ui";
export default function Profile() {
  const c = usePalette();
  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>YOUR SPACE</Text>
      <Title>Your profile</Title>
      <View style={{ backgroundColor: c.card, borderRadius: 22, padding: 20, gap: 8, borderWidth: 1, borderColor: c.border }}>
        <Text style={{ fontSize: 34, color: c.accent }}>◎</Text>
        <Text style={{ color: c.text, fontWeight: "700", fontSize: 18 }}>Make your profile yours</Text>
        <Text style={{ color: c.muted }}>Add a friendly introduction, interests and the activities you enjoy.</Text>
      </View>
      <Link href="/(app)/wallet" asChild><Button label="Wallet & tokens" onPress={() => undefined} /></Link>
      <Link href="/(app)/companions" asChild><Button label="Companionship options" kind="plain" onPress={() => undefined} /></Link>
      <Link href="/(app)/nearby" asChild><Button label="Nearby and activities" kind="plain" onPress={() => undefined} /></Link>
      <Link href="/(app)/settings" asChild><Button label="Settings and safety" kind="plain" onPress={() => undefined} /></Link>
      <Body muted>Profile photo management and editing still need the authenticated mobile profile and private-storage flows.</Body>
    </Screen>
  );
}
