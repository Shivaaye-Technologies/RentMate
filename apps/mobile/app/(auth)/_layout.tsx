import { Redirect, Stack } from "expo-router";
import { useSession } from "../../src/session";

export default function AuthLayout() {
  const { ready, session } = useSession();
  if (ready && session) return <Redirect href="/home" />;
  return <Stack screenOptions={{ headerTitleAlign: "center" }}>
    <Stack.Screen name="sign-in" options={{ title: "Sign in" }} />
  </Stack>;
}
