import { useCallback, useEffect, useState } from "react";
import { Redirect, Stack, Tabs, useRouter, useSegments } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useSession } from "../../src/session";
import { profileDb } from "../../src/lib/data";
import { declarationStatus, type DeclarationStatus } from "../../src/lib/shared";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ color, fontSize: 19, fontWeight: "700" }}>{symbol}</Text>;
}

export default function AppLayout() {
  const c = usePalette();
  const { ready, session } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const isDeclarationRoute = segments[segments.length - 1] === "declare-age";
  const [gate, setGate] = useState<DeclarationStatus | "checking">("checking");

  const checkDeclaration = useCallback(async () => {
    if (!profileDb || !session) return;
    setGate("checking");
    setGate(await declarationStatus(profileDb));
  }, [session]);

  useEffect(() => {
    if (ready && session) void checkDeclaration();
  }, [checkDeclaration, isDeclarationRoute, ready, session]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator accessibilityLabel="Loading RentMate" color={c.accent} size="large" />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  if (gate === "checking") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg }}>
        <ActivityIndicator accessibilityLabel="Checking your age declaration" color={c.accent} size="large" />
      </View>
    );
  }
  if (gate === "missing" && !isDeclarationRoute) return <Redirect href="/declare-age" />;
  if (typeof gate === "object" && !isDeclarationRoute) {
    return (
      <Screen>
        <Title>We couldn't verify your declaration</Title>
        <Notice kind="error">{gate.error}</Notice>
        <Body>Access stays locked until RentMate can confirm your 18+ declaration.</Body>
        <Button label="Try again" onPress={() => void checkDeclaration()} />
        <Button
          label="Continue to date-of-birth declaration"
          kind="plain"
          onPress={() => router.replace("/declare-age")}
        />
      </Screen>
    );
  }
  if (gate !== "declared") {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="declare-age" />
      </Stack>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: {
          backgroundColor: c.bg,
          borderTopColor: c.border,
          height: 66,
          paddingTop: 7,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          tabBarIcon: ({ focused }) => <TabIcon symbol="⌕" color={focused ? c.accent : c.muted} />,
        }}
      />
      <Tabs.Screen
        name="vibes"
        options={{
          title: "Vibes",
          tabBarIcon: ({ focused }) => <TabIcon symbol="◉" color={focused ? c.accent : c.muted} />,
        }}
      />
      <Tabs.Screen name="wallet" options={{ href: null, title: "Wallet" }} />
      <Tabs.Screen
        name="likes"
        options={{
          title: "Likes",
          tabBarIcon: ({ focused }) => <TabIcon symbol="♡" color={focused ? c.accent : c.muted} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ focused }) => <TabIcon symbol="▤" color={focused ? c.accent : c.muted} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused }) => <TabIcon symbol="◎" color={focused ? c.accent : c.muted} />,
        }}
      />
      <Tabs.Screen name="home" options={{ href: null }} />
      <Tabs.Screen name="live" options={{ href: null, title: "Live social" }} />
      <Tabs.Screen name="companions" options={{ href: null, title: "Companionship" }} />
      <Tabs.Screen name="booking" options={{ href: null, title: "Bookings" }} />
      <Tabs.Screen name="nearby" options={{ href: null, title: "Nearby" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: "Notifications" }} />
      <Tabs.Screen name="availability" options={{ href: null, title: "Availability" }} />
      <Tabs.Screen name="declare-age" options={{ href: null, title: "Your date of birth" }} />
    </Tabs>
  );
}
