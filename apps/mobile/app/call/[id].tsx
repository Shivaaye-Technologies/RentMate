import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { AudioSession, LiveKitRoom, VideoTrack, useLocalParticipant, useTracks } from "@livekit/react-native";
import { Track } from "livekit-client";
import { supabase, apiBaseUrl } from "../../src/lib/supabase";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type CallMode = "audio" | "video";
type RoomToken = { url: string; token: string; room: string; mode?: CallMode };

function CallControls({ mode }: { mode: CallMode }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [changing, setChanging] = useState(false);
  async function toggleMicrophone() {
    setChanging(true);
    try { await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled); }
    finally { setChanging(false); }
  }
  async function toggleCamera() {
    setChanging(true);
    try { await localParticipant.setCameraEnabled(!isCameraEnabled); }
    finally { setChanging(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Button label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"} kind="plain" disabled={changing} onPress={() => void toggleMicrophone()} />
      {mode === "video" ? <Button label={isCameraEnabled ? "Turn camera off" : "Turn camera on"} kind="plain" disabled={changing} onPress={() => void toggleCamera()} /> : null}
    </View>
  );
}

function CallMedia({ mode }: { mode: CallMode }) {
  const tracks = useTracks([Track.Source.Camera]);
  const c = usePalette();
  if (mode === "audio") return <Body>Voice call connected. Keep the conversation respectful.</Body>;
  return (
    <View style={{ gap: 12 }}>
      {tracks.map((track) => (
        <VideoTrack
          key={track.publication.trackSid}
          trackRef={track}
          style={{ width: "100%", height: 360, backgroundColor: c.card }}
        />
      ))}
      {!tracks.length ? <Body muted>Waiting for video…</Body> : null}
    </View>
  );
}

export default function CallScreen() {
  const c = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; callee?: string; mode?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const callee = Array.isArray(params.callee) ? params.callee[0] : params.callee;
  const mode: CallMode = params.mode === "video" ? "video" : "audio";
  const [callId, setCallId] = useState(id && id !== "new" ? id : null);
  const [room, setRoom] = useState<RoomToken | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [duration, setDuration] = useState(0);
  const ending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function begin() {
      if (!supabase) throw new Error("App configuration is missing.");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Please sign in again.");
      let current = callId;
      if (!current) {
        if (!callee) throw new Error("The person to call was not selected.");
        const { data, error: startError } = await supabase.rpc("call_start", {
          p_callee: callee,
          p_mode: mode === "audio" ? "voice" : "video",
        });
        if (startError) throw new Error(startError.message);
        current = String(data);
        if (!cancelled) setCallId(current);
      }
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch(apiBaseUrl + "/api/v1/calls/" + current + "/join", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: "Bearer " + token },
        body: "{}",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not join the call.");
      if (!cancelled) {
        setRoom(payload as RoomToken);
        await AudioSession.startAudioSession();
        setConnected(true);
      }
    }
    void begin()
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not start call."))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function finishCall(navigate: boolean) {
    if (ending.current) return;
    ending.current = true;
    setConnected(false);
    if (callId && supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token)
        await fetch(apiBaseUrl + "/api/v1/calls/" + callId + "/end", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        }).catch(() => undefined);
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
    if (navigate) router.back();
  }

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  const elapsed = String(Math.floor(duration / 60)).padStart(2, "0") + ":" + String(duration % 60).padStart(2, "0");

  return (
    <Screen>
      <Title>{mode === "video" ? "Video call" : "Voice call"}</Title>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {busy ? <ActivityIndicator size="large" color={c.accent} /> : null}
      {room && connected ? (
        <LiveKitRoom
          serverUrl={room.url}
          token={room.token}
          connect
          audio
          video={mode === "video"}
          onDisconnected={() => {
            setConnected(false);
            void finishCall(false);
          }}
        >
          <CallMedia mode={mode} />
          <CallControls mode={mode} />
          <Body muted>Connected · {elapsed}</Body>
          <Body muted>Connected securely through RentMate.</Body>
        </LiveKitRoom>
      ) : null}
      {!busy && !error && !connected ? <Body muted>Call ended or disconnected.</Body> : null}
      <Button label="End call" kind="danger" onPress={() => void finishCall(true)} />
    </Screen>
  );
}
