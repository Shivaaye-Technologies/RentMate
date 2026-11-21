import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { apiBaseUrl, supabase } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title } from "../../src/ui";

type Stream = { id: string; title?: string; status?: string; category?: string; viewerCount?: number };
export default function Live() {
  const [rooms, setRooms] = useState<Stream[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!supabase) return setMessage("App configuration is missing.");
    setBusy(true); setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(`${apiBaseUrl}/api/v1/live/streams`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? (response.status === 503 ? "Live rooms are not enabled on this staging server yet." : "Could not load live rooms."));
      setRooms(Array.isArray(body.streams) ? body.streams : []);
      if (!Array.isArray(body.streams) || body.streams.length === 0) setMessage("No live rooms are available right now.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load live rooms."); }
    finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <Screen>
    <Title>Live social</Title>
    <Body>Join moderated conversations about music, travel, hobbies, sport and everyday life. You can listen without speaking.</Body>
    <Body muted>Voice and video participation is opt-in. No recording by default.</Body>
    {message ? <Notice kind="info">{message}</Notice> : null}
    {rooms.map((room) => <Body key={room.id}>{room.title ?? "Live room"} · {room.status ?? "Available"}</Body>)}
    <Button label="Refresh live rooms" onPress={() => void load()} busy={busy} />
    <Body muted>Hosting, speaker requests and video joining will be enabled only after the provider and moderation controls pass staging tests.</Body>
  </Screen>;
}