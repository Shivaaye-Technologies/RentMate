import { Tabs } from "expo-router";
import { Text } from "react-native";
import { usePalette } from "../../src/ui";

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ color, fontSize: 19, fontWeight: "700" }}>{symbol}</Text>;
}

export default function AppLayout() {
  const c = usePalette();
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
      <Tabs.Screen name="discover" options={{ title: "Discover", tabBarIcon: ({ color }) => <TabIcon symbol="⌕" color={color} /> }} />
      <Tabs.Screen name="vibes" options={{ title: "Vibes", tabBarIcon: ({ color }) => <TabIcon symbol="◉" color={color} /> }} />
      <Tabs.Screen name="wallet" options={{ href: null, title: "Wallet" }} />
      <Tabs.Screen name="likes" options={{ title: "Likes", tabBarIcon: ({ color }) => <TabIcon symbol="♡" color={color} /> }} />
      <Tabs.Screen name="chat" options={{ title: "Chat", tabBarIcon: ({ color }) => <TabIcon symbol="▤" color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color }) => <TabIcon symbol="◎" color={color} /> }} />
      <Tabs.Screen name="home" options={{ href: null }} />
      <Tabs.Screen name="live" options={{ href: null, title: "Live social" }} />
      <Tabs.Screen name="companions" options={{ href: null, title: "Companionship" }} />
      <Tabs.Screen name="nearby" options={{ href: null, title: "Nearby" }} />
      <Tabs.Screen name="settings" options={{ href: null, title: "Settings" }} />
      <Tabs.Screen name="declare-age" options={{ href: null, title: "Your date of birth" }} />
    </Tabs>
  );
}
