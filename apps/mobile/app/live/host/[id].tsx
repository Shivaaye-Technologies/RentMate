import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { AudioSession, LiveKitRoom, VideoTrack, useLocalParticipant, useTracks } from "@livekit/react-native";
import { Track } from "livekit-client";
import { LiveChat } from "../../../src/components/LiveChat";
import { apiBaseUrl, supabase } from "../../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../../src/ui";

type HostToken = { url: string; token: string; room: string; canPublish: boolean; publishSources: string[] };

function HostPreview() {
  const c = usePalette();
  const tracks = useTracks([Track.Source.Camera]);
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [busy, setBusy] = useState(false);
  async function toggleMic() {
    setBusy(true);
    try { await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled); }
    finally { setBusy(false); }
  }
  async function toggleCamera() {
    setBusy(true);
    try { await localParticipant.setCameraEnabled(!isCameraEnabled); }
    finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 12 }}>
      {tracks.map((track) => (
        <VideoTrack key={track.publication.trackSid} trackRef={track} style={{ width: "100%", height: 360, backgroundColor: c.card }} />
      ))}
      {!tracks.length ? <Body muted>Camera is off or waiting for video…</Body> : null}
      <Button label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"} kind="plain" disabled={busy} onPress={() => void toggleMic()} />
      <Button label={isCameraEnabled ? "Turn camera off" : "Turn camera on"} kind="plain" disabled={busy} onPress={() => void toggleCamera()} />
    </View>
  );
}

export default function HostLiveRoom() {
  const c = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [room, setRoom] = useState<HostToken | null>(null);
  const [busy, setBusy] = useState(true);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ended = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function joinAsHost() {
      if (!id || !supabase) throw new Error("This broadcast is unavailable.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(apiBaseUrl + "/api/v1/live/streams/" + id + "/join", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ as: "broadcaster" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.reasons?.join(", ") || payload.error || "Could not join the broadcast.");
      if (!payload.canPublish) throw new Error("The server has not granted publishing permission for this stream.");
      if (!cancelled) {
        setRoom(payload as HostToken);
        await AudioSession.startAudioSession();
      }
    }
    void joinAsHost()
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not open the broadcast studio."))
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [id]);

  async function endBroadcast() {
    if (ended.current || !id || !supabase) return;
    ended.current = true;
    setEnding(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        await supabase.rpc("live_end_stream", { p_stream: id });
        await fetch(apiBaseUrl + "/api/v1/live/streams/" + id + "/end", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
      }
    } finally {
      await AudioSession.stopAudioSession().catch(() => undefined);
      router.back();
    }
  }

  return (
    <Screen>
      <Title>Broadcast studio</Title>
      <Body muted>Only broadcast permitted, non-explicit content. Stop immediately if anyone withdraws consent.</Body>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {busy ? <ActivityIndicator size="large" color={c.accent} /> : null}
      {room && !error ? (
        <LiveKitRoom
          serverUrl={room.url}
          token={room.token}
          connect
          audio={room.publishSources.includes("microphone")}
          video={room.publishSources.includes("camera")}
          onDisconnected={() => {
            if (!ended.current) void endBroadcast();
          }}
        >
          <HostPreview />
          <Body muted>You're broadcasting live. Your camera and microphone can be switched off at any time.</Body>
        </LiveKitRoom>
      ) : null}
      {room && !error && id ? <LiveChat streamId={id} /> : null}
      <Button label={ending ? "Ending…" : "End broadcast"} kind="danger" busy={ending} onPress={() => void endBroadcast()} />
    </Screen>
  );
}
