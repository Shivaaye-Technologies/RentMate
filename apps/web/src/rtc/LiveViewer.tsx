import { useEffect, useReducer, useRef, useState } from "react";
import type { RemoteParticipant } from "livekit-client";
import type { EndReason } from "./callState";
import { LiveChat } from "./LiveChat";
import { LIVE_REPORT_REASONS, liveApi, type StreamInfo } from "./liveData";
import { attach, joinMediaRoom, trackOf, type MediaRoom } from "./room";

type Phase = "loading" | "connecting" | "watching" | "reconnecting" | "waiting" | "ended" | "refused";

/** Watching a public broadcast: subscribe-only token, chat, reactions, report and block. */
export function LiveViewer({ me, streamId, onExit }: { me: string; streamId: string; onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [host, setHost] = useState("Creator");
  const [message, setMessage] = useState<string | null>(null);
  const [viewers, setViewers] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishers, setPublishers] = useState<RemoteParticipant[]>([]);
  const media = useRef<MediaRoom | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      const room = media.current?.room;
      if (!room) return;
      setPublishers([...room.remoteParticipants.values()].filter((p) => p.trackPublications.size > 0));
      bump();
    };
    void (async () => {
      try {
        const s = await liveApi.stream(streamId);
        if (cancelled) return;
        setInfo(s);
        if (s) void liveApi.stageNames([s.creator_id]).then((n) => setHost(n[s.creator_id] ?? "Creator"));
        if (!s || s.status !== "live") {
          setPhase(s && ["ended", "terminated", "cancelled"].includes(s.status) ? "ended" : "waiting");
          return;
        }
        setPhase("connecting");
        const t = await liveApi.join(streamId, "viewer");
        if (cancelled) return;
        media.current = await joinMediaRoom(t.url, t.token, {
          onConnection: (c) => {
            if (c === "reconnecting") setPhase("reconnecting");
            if (c === "reconnected") setPhase("watching");
          },
          onDisconnected: (reason: EndReason) => {
            setPhase("ended");
            if (reason === "removed") setMessage("You were removed from this stream.");
            else if (reason === "network") setMessage("The connection was lost.");
          },
          onRemoteChange: refresh,
        });
        if (cancelled) {
          await media.current.leave();
          return;
        }
        setPhase("watching");
        refresh();
      } catch (e) {
        if (!cancelled) {
          setPhase("refused");
          setMessage(e instanceof Error ? e.message : "This stream isn't available.");
        }
      }
    })();
    return () => {
      cancelled = true;
      void media.current?.leave();
      media.current = null;
    };
  }, [streamId]);

  // Viewer count (server-side, from the media server) and the stream's status.
  useEffect(() => {
    if (phase !== "watching" && phase !== "reconnecting") return;
    let stop = false;
    const poll = async () => {
      const st = await liveApi.stats(streamId).catch(() => null);
      if (stop || !st) return;
      setViewers(st.viewers);
      if (st.status !== "live") {
        setPhase("ended");
        void media.current?.leave();
      }
    };
    void poll();
    const t = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [phase, streamId]);

  async function block() {
    if (!info) return;
    try {
      await liveApi.block(me, info.creator_id);
      await media.current?.leave();
      setPhase("ended");
      setMessage(`You blocked ${host}. You won't see their streams.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't block.");
    }
  }

  async function report(reason: string) {
    if (!info) return;
    try {
      await liveApi.report(streamId, info.creator_id, me, reason, "");
      setReporting(false);
      setNotice("Thanks. Our safety team will review this stream.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't send the report.");
    }
  }

  const main = publishers[0];
  const live = phase === "watching" || phase === "reconnecting";
  return (
    <main className="live-viewer">
      <header className="live-head">
        <button className="btn small" onClick={onExit}>
          ← Live
        </button>
        <div>
          <strong>{info?.title ?? "Live stream"}</strong>
          <span className="muted small"> · {host}</span>
        </div>
        <span className={`live-pill ${live ? "on" : ""}`} data-testid="viewer-status">
          {phase === "watching"
            ? "LIVE"
            : phase === "reconnecting"
              ? "Reconnecting…"
              : phase === "ended"
                ? "Ended"
                : phase === "waiting"
                  ? "Not live yet"
                  : phase === "refused"
                    ? "Unavailable"
                    : "Connecting…"}
        </span>
        {viewers !== null && live && (
          <span className="muted small" data-testid="viewer-count">
            {viewers} watching
          </span>
        )}
      </header>

      <section className="live-stage">
        {publishers.length === 0 && (
          <div className="call-placeholder">
            {live ? "Waiting for the creator's camera…" : (message ?? "This stream has ended.")}
          </div>
        )}
        <div className={`live-grid n${Math.min(publishers.length, 5)}`}>
          {publishers.map((p) => (
            <PublisherTile key={p.identity} p={p} main={p === main} />
          ))}
        </div>
      </section>
      {message && phase !== "ended" && <p className="alert error">{message}</p>}
      {phase === "ended" && message && <p className="call-note">{message}</p>}
      {notice && (
        <p className="call-note" role="status">
          {notice}
        </p>
      )}

      <div className="live-actions">
        <button className="btn small" onClick={() => setReporting((v) => !v)}>
          Report
        </button>
        <button className="btn small danger" onClick={() => void block()} disabled={!info}>
          Block {host}
        </button>
      </div>
      {reporting && (
        <ul className="plain-list report-reasons">
          {LIVE_REPORT_REASONS.map(([key, label]) => (
            <li key={key}>
              <button className="menu-row" onClick={() => void report(key)}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {info && <LiveChat streamId={streamId} me={me} host={false} live={live} />}
    </main>
  );
}

function PublisherTile({ p, main }: { p: RemoteParticipant; main: boolean }) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const video = trackOf(p, "video");
  const audio = trackOf(p, "audio");
  useEffect(() => attach(video, v.current), [video]);
  useEffect(() => attach(audio, a.current), [audio]);
  return (
    <figure className={`live-tile ${main ? "main" : ""}`}>
      <video ref={v} autoPlay playsInline data-testid="live-video" />
      {!video && <figcaption className="call-placeholder">Camera off</figcaption>}
      <audio ref={a} autoPlay />
    </figure>
  );
}
