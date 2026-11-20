import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { RemoteParticipant } from "livekit-client";
import {
  callReducer,
  END_TEXT,
  FAILURE_TEXT,
  formatDuration,
  initialCallState,
  mediaFailure,
  PHASE_TEXT,
} from "./callState";
import { attach, joinMediaRoom, trackOf, type MediaRoom } from "./room";
import { callsApi, type CallRecord } from "./rtcData";

/** One-to-one voice or video call. The database decides who may join; billing uses server events only. */
export function CallScreen({ me, callId, onExit }: { me: string; callId: string; onExit: () => void }) {
  const [state, dispatch] = useReducer(callReducer, initialCallState());
  const [call, setCall] = useState<CallRecord | null>(null);
  const [peerName, setPeerName] = useState("Your match");
  const [now, setNow] = useState(Date.now());
  const [remote, setRemote] = useState<RemoteParticipant | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);
  const media = useRef<MediaRoom | null>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const iAmCaller = call?.caller_id === me;
  const finished = state.phase === "ended" || state.phase === "failed";

  // Follow the call record (answer, decline, end by the other person, safety actions).
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const c = await callsApi.get(callId);
        if (stop) return;
        if (!c) {
          dispatch({ type: "fail", failure: "not_allowed", message: "This call doesn't exist." });
          return;
        }
        setCall(c);
        dispatch({
          type: "record",
          status: c.status,
          mode: c.mode,
          iAmCaller: c.caller_id === me,
          endReason: c.end_reason,
        });
      } catch {
        /* the next poll retries */
      }
    };
    void load();
    const t = setInterval(load, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [callId, me]);

  useEffect(() => {
    if (!call) return;
    const peer = call.caller_id === me ? call.callee_id : call.caller_id;
    void callsApi.names([peer]).then((n) => n[peer] && setPeerName(n[peer]));
  }, [call, me]);

  const refreshRemote = useCallback(() => {
    const room = media.current?.room;
    const p = room ? ([...room.remoteParticipants.values()][0] ?? null) : null;
    setRemote(p);
    if (p) dispatch({ type: "peer_joined", at: Date.now() });
    else dispatch({ type: "peer_left" });
    bump();
  }, []);

  // Join the room: the caller as soon as it rings (media ready when they answer), the callee once accepted.
  const shouldJoin =
    call !== null &&
    !finished &&
    (call.status === "accepted" || (call.status === "ringing" && call.caller_id === me));
  useEffect(() => {
    if (!shouldJoin || media.current) return;
    let cancelled = false;
    void (async () => {
      dispatch({ type: "joining" });
      try {
        const t = await callsApi.join(callId);
        if (cancelled) return;
        const m = await joinMediaRoom(t.url, t.token, {
          onConnection: (s) => {
            if (s === "reconnecting") dispatch({ type: "reconnecting" });
            if (s === "reconnected") {
              const peerPresent = (media.current?.room.remoteParticipants.size ?? 0) > 0;
              dispatch({ type: "reconnected", peerPresent, at: Date.now() });
            }
          },
          onDisconnected: (reason) => dispatch({ type: "disconnected", reason }),
          onRemoteChange: refreshRemote,
          onLocalChange: bump,
        });
        if (cancelled) {
          await m.leave();
          return;
        }
        media.current = m;
        dispatch({ type: "joined", peerPresent: m.room.remoteParticipants.size > 0 });
        refreshRemote();
        try {
          await m.setMic(true);
          if (t.mode === "video") await m.setCamera(true);
        } catch (err) {
          dispatch({ type: "fail", failure: mediaFailure(err) });
          return;
        }
        const cams = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []);
        setCanSwitch((cams ?? []).filter((d) => d.kind === "videoinput").length > 1);
        bump();
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "fail",
            failure: "not_allowed",
            message: err instanceof Error ? err.message : undefined,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shouldJoin, callId, refreshRemote]);

  // Leave the room when the call is over.
  useEffect(() => {
    if (finished && media.current) {
      void media.current.leave();
      media.current = null;
    }
  }, [finished]);
  useEffect(() => () => void media.current?.leave(), []);

  // Attach media elements whenever tracks change.
  const remoteVideoTrack = trackOf(remote ?? undefined, "video");
  const remoteAudioTrack = trackOf(remote ?? undefined, "audio");
  const localVideoTrack = media.current ? trackOf(media.current.room.localParticipant, "video") : null;
  useEffect(() => attach(remoteVideoTrack, remoteVideo.current), [remoteVideoTrack]);
  useEffect(() => attach(remoteAudioTrack, remoteAudio.current), [remoteAudioTrack]);
  useEffect(() => attach(localVideoTrack, localVideo.current), [localVideoTrack]);

  useEffect(() => {
    if (state.phase !== "connected") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);

  async function hangUp() {
    dispatch({ type: "hang_up" });
    await media.current?.leave();
    media.current = null;
    await callsApi.end(callId).catch(() => undefined);
  }

  async function toggleMic() {
    const on = !state.micOn;
    try {
      await media.current?.setMic(on);
      dispatch({ type: "mic", on });
    } catch (err) {
      dispatch({ type: "fail", failure: mediaFailure(err) });
    }
  }

  async function toggleCam() {
    const on = !state.camOn;
    try {
      await media.current?.setCamera(on);
      dispatch({ type: "cam", on });
    } catch (err) {
      dispatch({ type: "fail", failure: mediaFailure(err) });
    }
  }

  const video = state.mode === "video";
  const status =
    state.phase === "connected" && state.connectedAt
      ? formatDuration(now - state.connectedAt)
      : PHASE_TEXT[state.phase];

  return (
    <main
      className={`call-screen ${video ? "is-video" : "is-voice"}`}
      aria-label={`${video ? "Video" : "Voice"} call`}
    >
      <header className="call-head">
        <strong className="call-peer">{peerName}</strong>
        <span className="call-status" data-phase={state.phase} role="status" aria-live="polite">
          {status}
        </span>
      </header>

      {video ? (
        <section className="call-stage">
          <video ref={remoteVideo} className="call-remote" autoPlay playsInline data-testid="remote-video" />
          {!remoteVideoTrack && (
            <div className="call-placeholder">{remote ? "Camera off" : PHASE_TEXT[state.phase]}</div>
          )}
          <video
            ref={localVideo}
            className="call-local"
            autoPlay
            playsInline
            muted
            data-testid="local-video"
          />
        </section>
      ) : (
        <section className="call-stage voice">
          <div className="call-avatar" aria-hidden="true">
            {peerName.slice(0, 1).toUpperCase()}
          </div>
        </section>
      )}
      <audio ref={remoteAudio} autoPlay data-testid="remote-audio" />

      {state.phase === "ended" && state.reason && <p className="call-note">{END_TEXT[state.reason]}</p>}
      {state.phase === "failed" && (
        <div className="call-note error" role="alert">
          <p>{state.message ?? (state.failure ? FAILURE_TEXT[state.failure] : "The call failed.")}</p>
          {(state.failure === "permission_denied" || state.failure === "unavailable") && (
            <p className="muted small">
              The call is still open on the other side. Fix the permission, then try again.
            </p>
          )}
        </div>
      )}

      <footer className="call-controls">
        {!finished ? (
          <>
            <button
              className={`call-btn ${state.micOn ? "" : "off"}`}
              onClick={() => void toggleMic()}
              aria-pressed={!state.micOn}
              disabled={!media.current}
            >
              {state.micOn ? "Mute" : "Unmute"}
            </button>
            {video && (
              <button
                className={`call-btn ${state.camOn ? "" : "off"}`}
                onClick={() => void toggleCam()}
                aria-pressed={!state.camOn}
                disabled={!media.current}
              >
                {state.camOn ? "Camera off" : "Camera on"}
              </button>
            )}
            {video && canSwitch && (
              <button
                className="call-btn"
                onClick={() => void media.current?.switchCamera()}
                disabled={!state.camOn}
              >
                Switch camera
              </button>
            )}
            <button className="call-btn end" onClick={() => void hangUp()}>
              {state.phase === "ringing_out" ? "Cancel" : "End call"}
            </button>
          </>
        ) : (
          <>
            {state.phase === "failed" &&
              (state.failure === "permission_denied" || state.failure === "unavailable") && (
                <button
                  className="call-btn"
                  // Reloading re-reads the call and joins again once the browser allows the device.
                  onClick={() => window.location.reload()}
                >
                  Try again
                </button>
              )}
            {state.phase === "failed" && (
              <button className="call-btn end" onClick={() => void hangUp().finally(onExit)}>
                End call
              </button>
            )}
            <button className="call-btn" onClick={onExit}>
              Close
            </button>
          </>
        )}
      </footer>
      {iAmCaller === false && state.phase === "loading" && (
        <p className="muted small">Connecting the call…</p>
      )}
    </main>
  );
}
