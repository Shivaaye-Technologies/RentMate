import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { View, Text } from "react-native";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";
type Stream = {
  id: string;
  title?: string;
  stageName?: string;
  status?: string;
  category?: string;
  explicit?: boolean;
};
export default function Live() {
  const c = usePalette();
  const router = useRouter();
  const [rooms, setRooms] = useState<Stream[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return setMessage("App configuration is missing.");
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`${apiBaseUrl}/api/v1/live/streams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load live rooms.");
      const safe = Array.isArray(body.streams) ? body.streams.filter((x: Stream) => !x.explicit) : [];
      setRooms(safe);
      if (!safe.length) setMessage("No live rooms are available right now. Check back later.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load live rooms.");
    } finally {
      setBusy(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  return (
    <Screen>
      <Text style={{ color: c.accent, fontWeight: "800", letterSpacing: 2 }}>RENTMATE LIVE</Text>
      <Title>Live social rooms</Title>
      <Body>Real conversations, shared interests and positive community energy.</Body>
      <Body muted>
        Only permitted, non-explicit social rooms are shown. Joining is subject to server-side safety checks.
      </Body>
      {message ? <Notice kind="info">{message}</Notice> : null}
      {rooms.map((room) => (
        <View
          key={room.id}
          style={{
            padding: 18,
            borderRadius: 20,
            backgroundColor: c.card,
            borderColor: c.border,
            borderWidth: 1,
            gap: 8,
          }}
        >
          <Text style={{ color: c.text, fontSize: 18, fontWeight: "700" }}>
            {room.title || "Community room"}
          </Text>
          <Text style={{ color: c.muted }}>
            {room.stageName || "RentMate host"} · {room.category || "Social"} · {room.status || "Scheduled"}
          </Text>
          <Button
            label="Join live room"
            onPress={() => router.push({ pathname: "/live/[id]", params: { id: room.id } } as never)}
          />
        </View>
      ))}
      <Button label="Refresh rooms" onPress={() => void load()} busy={busy} />
    </Screen>
  );
}
