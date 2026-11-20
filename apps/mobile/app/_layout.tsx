import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configResult } from "../src/lib/supabase";
import { SessionProvider } from "../src/session";
import { Body, Notice, Screen, Title } from "../src/ui";

export default function RootLayout() {
  if (!configResult.ok) {
    return (
      <SafeAreaProvider>
        <Screen>
          <Title>RentMate can’t start</Title>
          <Body>This build is missing its public settings:</Body>
          {configResult.problems.map((p) => (
            <Notice key={p} kind="error">
              {p}
            </Notice>
          ))}
        </Screen>
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerTitleAlign: "center" }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
