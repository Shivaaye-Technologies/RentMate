import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { LiveKitRoom, VideoTrack, useTracks } from "@livekit/react-native";
import { Track } from "livekit-client";
import { supabase, apiBaseUrl } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type RoomToken = { url: string; token: string; canPublish: boolean; publishSources: string[] };
function Stage() {
  const c = usePalette();
  const tracks = useTracks([Track.Source.Camera]);
  return (
    <View style={{ gap: 12 }}>
      {tracks.map((track) => (
        <VideoTrack
          key={track.publication.trackSid}
          trackRef={track}
          style={{ width: "100%", height: 340, backgroundColor: c.card }}
        />
      ))}
      {!tracks.length ? <Body muted>Waiting for the host to publish video…</Body> : null}
    </View>
  );
}
export default function LiveRoomScreen() {
  const c = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [room, setRoom] = useState<RoomToken | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function join() {
      if (!id || !supabase) throw new Error("This live room is unavailable.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(apiBaseUrl + "/api/v1/live/streams/" + id + "/join", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ as: "viewer" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reasons?.[0] || payload.error || "Could not join this room.");
      if (!cancelled) {
        setRoom(payload as RoomToken);
        setConnected(true);
      }
    }
    void join()
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not join the room."))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return (
    <Screen>
      <Title>Live social room</Title>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {busy ? <ActivityIndicator size="large" color={c.accent} /> : null}
      {room && connected ? (
        <LiveKitRoom
          serverUrl={room.url}
          token={room.token}
          connect
          audio
          video={false}
          onDisconnected={() => setConnected(false)}
        >
          <Stage />
          <Body>You're watching live. Keep chat kind and respectful.</Body>
        </LiveKitRoom>
      ) : null}
      {!busy && !error && !connected ? <Body muted>This room has ended or disconnected.</Body> : null}
      <Button label="Leave room" kind="danger" onPress={() => router.back()} />
    </Screen>
  );
}
