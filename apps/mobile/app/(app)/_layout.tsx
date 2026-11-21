import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/session";

export default function AppLayout() {
  const { ready, session } = useSession();
  if (ready && !session) return <Redirect href="/sign-in" />;
  return (
    <Stack screenOptions={{ headerTitleAlign: "center" }}>
      <Stack.Screen name="home" options={{ title: "RentMate" }} />
      <Stack.Screen name="discover" options={{ title: "Discover" }} />
      <Stack.Screen name="companions" options={{ title: "Companionship" }} />
      <Stack.Screen name="live" options={{ title: "Live social" }} />
      <Stack.Screen name="nearby" options={{ title: "Nearby" }} />
      <Stack.Screen name="profile" options={{ title: "My profile" }} />
      <Stack.Screen name="declare-age" options={{ title: "Your date of birth" }} />
      <Stack.Screen name="settings" options={{ title: "Settings" }} />
    </Stack>
  );
}
