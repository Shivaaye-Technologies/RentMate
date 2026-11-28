import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { formatWhen } from "../../src/lib/bookings";
import { supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string;
  booking_id: string | null;
  read_at: string | null;
  created_at: string;
};

/** In-app notifications written by the database (bookings, reviews, moderation). Members can only mark them read. */
export default function Notifications() {
  const c = usePalette();
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return setError("App configuration is missing.");
    setError(null);
    const { data, error: e } = await supabase
      .from("notifications")
      .select("id, kind, title, body, booking_id, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (e) return setError("Could not load notifications. Check your connection and try again.");
    setItems((data ?? []) as Item[]);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const markAllRead = async () => {
    if (!supabase || !items) return;
    const unread = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!unread.length) return;
    const { error: e } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", unread);
    if (e) return setError("Could not update notifications. Please try again.");
    void load();
  };

  const open = async (item: Item) => {
    if (supabase && !item.read_at) {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", item.id);
    }
    if (item.booking_id) router.push(`/booking/${item.booking_id}`);
    else void load();
  };

  const unreadCount = items?.filter((i) => !i.read_at).length ?? 0;

  return (
    <Screen>
      <Title>Notifications</Title>
      {error ? (
        <>
          <Notice kind="error">{error}</Notice>
          <Button label="Try again" onPress={() => void load()} />
        </>
      ) : null}
      {!items && !error ? (
        <ActivityIndicator accessibilityLabel="Loading notifications" color={c.accent} />
      ) : null}
      {items && unreadCount > 0 ? (
        <Button label={`Mark ${unreadCount} as read`} kind="plain" onPress={() => void markAllRead()} />
      ) : null}
      {items && items.length === 0 ? <Body muted>No notifications yet.</Body> : null}
      {items?.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.read_at ? "" : "Unread: "}${item.title}`}
          onPress={() => void open(item)}
          style={({ pressed }) => ({
            backgroundColor: c.card,
            borderColor: item.read_at ? c.border : c.accent,
            borderWidth: 1,
            borderRadius: 14,
            padding: 14,
            gap: 4,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: c.text, fontWeight: item.read_at ? "600" : "800", flex: 1 }}>
              {item.title}
            </Text>
            {!item.read_at ? <Text style={{ color: c.accent, fontWeight: "800" }}>•</Text> : null}
          </View>
          {item.body ? <Text style={{ color: c.muted }}>{item.body}</Text> : null}
          <Text style={{ color: c.muted, fontSize: 12 }}>{formatWhen(item.created_at)}</Text>
        </Pressable>
      ))}
    </Screen>
  );
}
