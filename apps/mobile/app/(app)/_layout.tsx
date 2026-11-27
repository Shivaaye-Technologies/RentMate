import { useCallback, useEffect, useState } from "react";
import { Redirect, Stack, Tabs, useRouter, useSegments } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import { useSession } from "../../src/session";
import { profileDb } from "../../src/lib/data";
import { declarationStatus, type DeclarationStatus } from "../../src/lib/shared";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

function TabIcon({ symbol, color }: { symbol: string; color: unknown }) {
  return <Text style={{ color: String(color), fontSize: 22, fontWeight: "800" }}>{symbol}</Text>;
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
        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "#8D877F",
        tabBarStyle: {
          backgroundColor: c.tabBar,
          borderTopWidth: 0,
          height: 76,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabIcon symbol="◠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="vibes"
        options={{
          title: "Vibes",
          tabBarIcon: ({ color }) => <TabIcon symbol="❏" color={color} />,
        }}
      />
      <Tabs.Screen
        name="nearby"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) => <TabIcon symbol="⌖" color={color} />,
        }}
      />
      <Tabs.Screen
        name="likes"
        options={{
          title: "Likes",
          tabBarIcon: ({ color }) => <TabIcon symbol="♥" color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color }) => <TabIcon symbol="💬" color={color} />,
        }}
      />
      <Tabs.Screen name="profile" options={{ href: null, title: "Profile" }} />
      <Tabs.Screen name="edit-profile" options={{ href: null, title: "Edit profile" }} />
      <Tabs.Screen name="profile-tasks" options={{ href: null, title: "Complete your profile" }} />
      <Tabs.Screen name="preferences" options={{ href: null, title: "Preferences" }} />
      <Tabs.Screen
        name="user/[id]"
        options={{ href: null, title: "Profile", tabBarStyle: { display: "none" } }}
      />
      <Tabs.Screen name="wallet" options={{ href: null, title: "Wallet" }} />
      <Tabs.Screen name="home" options={{ href: null }} />
      <Tabs.Screen name="live" options={{ href: null, title: "Live social" }} />
      <Tabs.Screen name="companions" options={{ href: null, title: "Companionship" }} />
      <Tabs.Screen name="booking" options={{ href: null, title: "Bookings" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      <Tabs.Screen name="notifications" options={{ href: null, title: "Notifications" }} />
      <Tabs.Screen name="availability" options={{ href: null, title: "Availability" }} />
      <Tabs.Screen name="declare-age" options={{ href: null, title: "Your date of birth" }} />
    </Tabs>
  );
}
