import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  createLocalTracks,
  Room,
  Track,
  type LocalAudioTrack,
  type LocalVideoTrack,
  type RemoteParticipant,
} from "livekit-client";
import { FAILURE_TEXT, mediaFailure } from "./callState";
import { LiveChat } from "./LiveChat";
import { liveApi, type GuestInvite, type StreamInfo } from "./liveData";
import { attach, joinMediaRoom, trackOf, type MediaRoom } from "./room";

type Phase = "loading" | "preview" | "starting" | "live" | "reconnecting" | "ended" | "error";

/** Creator (and invited guests) broadcasting a stream. Preview first; nothing is sent until "Go live". */
export function BroadcastStudio({
  me,
  streamId,
  onExit,
}: {
  me: string;
  streamId: string;
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [camId, setCamId] = useState<string>("");
  const [preview, setPreview] = useState<{ audio: LocalAudioTrack | null; video: LocalVideoTrack | null }>({
    audio: null,
    video: null,
  });
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [viewers, setViewers] = useState<number | null>(null);
  const [cohosts, setCohosts] = useState<RemoteParticipant[]>([]);
  const media = useRef<MediaRoom | null>(null);
  const previewEl = useRef<HTMLVideoElement>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const isCreator = info?.creator_id === me;

  const loadInfo = useCallback(async () => {
    const s = await liveApi.stream(streamId);
    setInfo(s);
    return s;
  }, [streamId]);

  // Load the stream and open a local preview (this is where the browser asks for permission).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await loadInfo();
        if (cancelled) return;
        if (!s || (s.creator_id !== me && !s.participants.includes(me))) {
          setPhase("error");
          setError("Only the creator and invited guests can broadcast this stream.");
          return;
        }
        if (["ended", "terminated", "cancelled"].includes(s.status)) {
          setPhase("ended");
          return;
        }
        const tracks = await createLocalTracks({
          audio: true,
          video: { resolution: { width: 1280, height: 720 } },
        });
        if (cancelled) {
          tracks.forEach((t) => t.stop());
          return;
        }
        setPreview({
          audio: (tracks.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack) ?? null,
          video: (tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack) ?? null,
        });
        setMics(await Room.getLocalDevices("audioinput"));
        setCams(await Room.getLocalDevices("videoinput"));
        setPhase("preview");
      } catch (e) {
        if (!cancelled) {
          setPhase("error");
          setError(FAILURE_TEXT[mediaFailure(e)]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadInfo, me]);

  useEffect(() => attach(preview.video, previewEl.current), [preview.video, phase]);
  useEffect(
    () => () => {
      preview.audio?.stop();
      preview.video?.stop();
    },
    [preview],
  );
  useEffect(() => () => void media.current?.leave(), []);

  async function pickDevice(kind: "audioinput" | "videoinput", id: string) {
    if (kind === "audioinput") setMicId(id);
    else setCamId(id);
    try {
      if (kind === "audioinput") await preview.audio?.restartTrack({ deviceId: id });
      else await preview.video?.restartTrack({ deviceId: id });
      if (media.current) await media.current.room.switchActiveDevice(kind, id);
    } catch (e) {
      setError(FAILURE_TEXT[mediaFailure(e)]);
    }
  }

  async function goLive() {
    setError(null);
    setPhase("starting");
    try {
      if (isCreator && info?.status !== "live") {
        const problems = await liveApi.start(streamId);
        if (problems.length > 0) {
          setPhase("preview");
          setError(`Can't go live yet: ${problems.join(", ").replace(/_/g, " ")}.`);
          return;
        }
      }
      const t = await liveApi.join(streamId, "broadcaster");
      const m = await joinMediaRoom(t.url, t.token, {
        onConnection: (c) => {
          if (c === "reconnecting") setPhase("reconnecting");
          if (c === "reconnected") setPhase("live");
        },
        onDisconnected: (reason) => {
          setPhase("ended");
          if (reason === "removed") setError("The host removed you from this stream.");
        },
        onRemoteChange: () => {
          const room = media.current?.room;
          if (room)
            setCohosts([...room.remoteParticipants.values()].filter((p) => p.trackPublications.size > 0));
          bump();
        },
      });
      media.current = m;
      if (preview.audio) await m.room.localParticipant.publishTrack(preview.audio);
      if (preview.video) await m.room.localParticipant.publishTrack(preview.video, { simulcast: true });
      setPhase("live");
      await loadInfo();
    } catch (e) {
      setPhase("preview");
      setError(e instanceof Error ? e.message : "Couldn't go live.");
    }
  }

  async function end() {
    try {
      if (isCreator) await liveApi.end(streamId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't end the stream.");
    }
    await media.current?.leave();
    media.current = null;
    preview.audio?.stop();
    preview.video?.stop();
    setPhase("ended");
  }

  async function toggle(kind: "mic" | "cam") {
    const track = kind === "mic" ? preview.audio : preview.video;
    const on = kind === "mic" ? !micOn : !camOn;
    if (!track) return;
    if (on) await track.unmute();
    else await track.mute();
    if (kind === "mic") setMicOn(on);
    else setCamOn(on);
  }

  // Viewer count while live.
  useEffect(() => {
    if (phase !== "live") return;
    let stop = false;
    const poll = () =>
      liveApi
        .stats(streamId)
        .then((s) => !stop && setViewers(s.viewers))
        .catch(() => undefined);
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [phase, streamId]);

  const live = phase === "live" || phase === "reconnecting";
  return (
    <main className="broadcast">
      <header className="live-head">
        <button className="btn small" onClick={onExit}>
          ← Studio
        </button>
        <div>
          <strong>{info?.title ?? "Broadcast"}</strong>
          <span className="muted small"> · {info?.category ?? ""}</span>
        </div>
        <span className={`live-pill ${live ? "on" : ""}`} data-testid="broadcast-status">
          {phase === "live"
            ? "LIVE"
            : phase === "reconnecting"
              ? "Reconnecting…"
              : phase === "preview"
                ? "Preview"
                : phase === "ended"
                  ? "Ended"
                  : phase === "starting"
                    ? "Going live…"
                    : phase === "error"
                      ? "Unavailable"
                      : "Loading…"}
        </span>
        {live && viewers !== null && (
          <span className="muted small" data-testid="broadcast-viewers">
            {viewers} watching
          </span>
        )}
      </header>

      <section className="live-stage">
        <div className={`live-grid n${Math.min(cohosts.length + 1, 5)}`}>
          <figure className="live-tile main">
            <video ref={previewEl} autoPlay playsInline muted data-testid="preview-video" />
            {!camOn && <figcaption className="call-placeholder">Camera off</figcaption>}
          </figure>
          {cohosts.map((p) => (
            <CohostTile key={p.identity} p={p} />
          ))}
        </div>
      </section>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      {(phase === "preview" || live) && (
        <div className="call-controls">
          <button
            className={`call-btn ${micOn ? "" : "off"}`}
            onClick={() => void toggle("mic")}
            aria-pressed={!micOn}
          >
            {micOn ? "Mute" : "Unmute"}
          </button>
          <button
            className={`call-btn ${camOn ? "" : "off"}`}
            onClick={() => void toggle("cam")}
            aria-pressed={!camOn}
          >
            {camOn ? "Camera off" : "Camera on"}
          </button>
          {phase === "preview" ? (
            <button
              className="call-btn go"
              onClick={() => void goLive()}
              disabled={!preview.audio && !preview.video}
            >
              {isCreator ? "Go live" : "Join as guest"}
            </button>
          ) : (
            <button className="call-btn end" onClick={() => void end()}>
              {isCreator ? "End broadcast" : "Leave stream"}
            </button>
          )}
        </div>
      )}
      {phase === "preview" && (mics.length > 1 || cams.length > 1) && (
        <div className="device-pickers">
          {mics.length > 1 && (
            <label>
              Microphone
              <select value={micId} onChange={(e) => void pickDevice("audioinput", e.target.value)}>
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Microphone"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {cams.length > 1 && (
            <label>
              Camera
              <select value={camId} onChange={(e) => void pickDevice("videoinput", e.target.value)}>
                {cams.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Camera"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <p className="muted small">Nothing is recorded. Your stream is visible only while you are live.</p>

      {isCreator && info && phase !== "ended" && (
        <GuestPanel streamId={streamId} participants={info.participants} live={live} />
      )}
      {info && <LiveChat streamId={streamId} me={me} host live={live} />}
    </main>
  );
}

function CohostTile({ p }: { p: RemoteParticipant }) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const video = trackOf(p, "video");
  const audio = trackOf(p, "audio");
  useEffect(() => attach(video, v.current), [video]);
  useEffect(() => attach(audio, a.current), [audio]);
  return (
    <figure className="live-tile">
      <video ref={v} autoPlay playsInline data-testid="cohost-video" />
      <audio ref={a} autoPlay />
    </figure>
  );
}

/** Creator: invite approved creators as guests (max 4), mute or remove them. */
function GuestPanel({
  streamId,
  participants,
  live,
}: {
  streamId: string;
  participants: string[];
  live: boolean;
}) {
  const [invites, setInvites] = useState<GuestInvite[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ user_id: string; stage_name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await liveApi.invites(streamId);
    setInvites(list);
    setNames(await liveApi.stageNames(list.map((i) => i.guest_id)));
  }, [streamId]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  async function act(f: () => Promise<unknown>) {
    setError(null);
    try {
      await f();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
  }

  const open = invites.filter((i) => i.status === "invited" || i.status === "accepted");
  return (
    <section className="panel guest-panel" aria-label="Guests">
      <h3>Guests ({participants.length}/4)</h3>
      <ul className="plain-list">
        {open.map((i) => (
          <li key={i.id} className="row between">
            <span>
              {names[i.guest_id] ?? "Guest"} <span className="muted small">· {i.status}</span>
            </span>
            <span className="row">
              {i.status === "accepted" && live && (
                <>
                  <button
                    className="btn small"
                    onClick={() => void act(() => liveApi.muteGuest(streamId, i.guest_id, "audio"))}
                  >
                    Mute mic
                  </button>
                  <button
                    className="btn small"
                    onClick={() => void act(() => liveApi.muteGuest(streamId, i.guest_id, "video"))}
                  >
                    Stop camera
                  </button>
                </>
              )}
              <button
                className="btn small danger"
                onClick={() => void act(() => liveApi.removeGuest(streamId, i.guest_id))}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => setFound(q.trim().length >= 2 ? await liveApi.findCreators(q.trim()) : []));
        }}
      >
        <input
          aria-label="Find a creator to invite"
          placeholder="Creator name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn small">Search</button>
      </form>
      <ul className="plain-list">
        {found.map((c) => (
          <li key={c.user_id} className="row between">
            <span>{c.stage_name}</span>
            <button
              className="btn small dark"
              onClick={() => void act(() => liveApi.invite(streamId, c.user_id))}
            >
              Invite
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="alert error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
