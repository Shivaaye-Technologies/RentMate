import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { AudioSession, LiveKitRoom, VideoTrack, useLocalParticipant, useTracks } from "@livekit/react-native";
import { Track } from "livekit-client";
import { supabase, apiBaseUrl } from "../../src/lib/supabase";
import { fetchWithTimeout } from "../../src/lib/fetchWithTimeout";
import { Body, Button, Notice, Screen, Title, usePalette } from "../../src/ui";

type CallMode = "audio" | "video";
type RoomToken = { url: string; token: string; room: string; mode?: CallMode };

function CallControls({ mode }: { mode: CallMode }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const [changing, setChanging] = useState(false);
  async function toggleMicrophone() {
    setChanging(true);
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } finally {
      setChanging(false);
    }
  }
  async function toggleCamera() {
    setChanging(true);
    try {
      await localParticipant.setCameraEnabled(!isCameraEnabled);
    } finally {
      setChanging(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Button
        label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
        kind="plain"
        disabled={changing}
        onPress={() => void toggleMicrophone()}
      />
      {mode === "video" ? (
        <Button
          label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          kind="plain"
          disabled={changing}
          onPress={() => void toggleCamera()}
        />
      ) : null}
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
  // Route params are intentionally captured once. A retry must resume the same call,
  // not react to later router-param changes and accidentally create a second session.
  const initial = useRef({
    callId: id && id !== "new" ? id : null,
    callee,
    mode,
  });
  const initialMode = initial.current.mode;
  const callIdRef = useRef<string | null>(initial.current.callId);
  const mounted = useRef(true);
  const starting = useRef(false);
  const callStartAttempted = useRef(false);
  const ending = useRef(false);
  const [room, setRoom] = useState<RoomToken | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(Boolean(initial.current.callId));
  const [connected, setConnected] = useState(false);
  const [duration, setDuration] = useState(0);

  const startCall = useCallback(async () => {
    if (starting.current || ending.current) return;
    starting.current = true;
    if (mounted.current) {
      setBusy(true);
      setError(null);
    }

    try {
      if (!supabase) throw new Error("App configuration is missing.");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Please sign in again.");

      let current = callIdRef.current;
      if (!current) {
        if (!initial.current.callee) throw new Error("The person to call was not selected.");
        // Do not automatically repeat call_start after an uncertain response: it may
        // have created a session even if the mobile network lost the reply.
        callStartAttempted.current = true;
        const { data, error: startError } = await supabase.rpc("call_start", {
          p_callee: initial.current.callee,
          p_mode: initialMode === "audio" ? "voice" : "video",
        });
        if (startError) throw new Error(startError.message);
        current = String(data);
        if (!current || current === "null" || current === "undefined") {
          throw new Error("The call could not be created. Please return and try again.");
        }
        callIdRef.current = current;
        if (mounted.current) setRetryAllowed(true);
      }

      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Please sign in again.");

      const response = await fetchWithTimeout(
        apiBaseUrl + "/api/v1/calls/" + current + "/join",
        {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: "Bearer " + token },
          body: "{}",
        },
        15_000,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof payload === "object" && payload !== null && "error" in payload
            ? String(payload.error)
            : "Could not join the call.";
        throw new Error(message);
      }
      if (!mounted.current) return;
      setRoom(payload as RoomToken);
      await AudioSession.startAudioSession();
      if (mounted.current) setConnected(true);
    } catch (e) {
      if (mounted.current) {
        setRetryAllowed(Boolean(callIdRef.current) || !callStartAttempted.current);
        setError(e instanceof Error ? e.message : "Could not start call.");
      }
    } finally {
      starting.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [initialMode]);

  useEffect(() => {
    mounted.current = true;
    void startCall();
    return () => {
      mounted.current = false;
    };
  }, [startCall]);

  async function finishCall(navigate: boolean) {
    if (ending.current) return;
    ending.current = true;
    setConnected(false);
    const current = callIdRef.current;
    if (current && supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          await fetchWithTimeout(
            apiBaseUrl + "/api/v1/calls/" + current + "/end",
            { method: "POST", headers: { Authorization: "Bearer " + token } },
            8_000,
          );
        }
      } catch {
        // Ending the local media session must not wait indefinitely for a best-effort API update.
      }
    }
    await AudioSession.stopAudioSession().catch(() => undefined);
    if (navigate) router.back();
  }

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);

  const elapsed =
    String(Math.floor(duration / 60)).padStart(2, "0") + ":" + String(duration % 60).padStart(2, "0");

  return (
    <Screen>
      <Title>{initialMode === "video" ? "Video call" : "Voice call"}</Title>
      {error ? <Notice kind="error">{error}</Notice> : null}
      {busy ? <ActivityIndicator size="large" color={c.accent} /> : null}
      {room && connected ? (
        <LiveKitRoom
          serverUrl={room.url}
          token={room.token}
          connect
          audio
          video={initialMode === "video"}
          onDisconnected={() => {
            setConnected(false);
            setRetryAllowed(false);
            void finishCall(false);
          }}
        >
          <CallMedia mode={initialMode} />
          <CallControls mode={initialMode} />
          <Body muted>Connected · {elapsed}</Body>
          <Body muted>Connected securely through RentMate.</Body>
        </LiveKitRoom>
      ) : null}
      {!busy && !error && !connected ? <Body muted>Call ended or disconnected.</Body> : null}
      {retryAllowed && !connected && !busy ? (
        <Button label="Retry connection" kind="plain" onPress={() => void startCall()} />
      ) : null}
      <Button label="End call" kind="danger" onPress={() => void finishCall(true)} />
    </Screen>
  );
}
