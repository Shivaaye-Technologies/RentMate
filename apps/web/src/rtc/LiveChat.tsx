import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../supabase";
import { liveApi, REACTIONS, type ChatMessage } from "./liveData";
import { callsApi } from "./rtcData";

/**
 * Live chat and reactions for one stream. Realtime when available, plus a short poll. The database screens text,
 * limits the rate, hides messages from people you blocked and lets hosts hide messages or mute people.
 */
export function LiveChat({
  streamId,
  me,
  host,
  live,
}: {
  streamId: string;
  me: string;
  host: boolean;
  live: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [bursts, setBursts] = useState<{ id: number; kind: string }[]>([]);
  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<number>());
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const m = await liveApi.chat(streamId);
        if (stop) return;
        setMessages(m);
        const missing = [...new Set(m.map((x) => x.sender_id))].filter((id) => !(id in names));
        if (missing.length) {
          const n = await callsApi.names(missing);
          if (!stop) setNames((old) => ({ ...old, ...n }));
        }
        const r = await liveApi.recentReactions(streamId, since.current);
        const fresh = r.filter((x) => !seen.current.has(x.id));
        fresh.forEach((x) => seen.current.add(x.id));
        if (fresh.length && !stop) {
          setBursts((b) => [...b, ...fresh].slice(-12));
          setTimeout(() => !stop && setBursts((b) => b.filter((x) => !fresh.includes(x))), 2500);
        }
      } catch {
        /* retried by the next poll */
      }
    };
    void load();
    const channel = supabase
      .channel(`live-chat:${streamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_chat_messages", filter: `stream_id=eq.${streamId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_reactions", filter: `stream_id=eq.${streamId}` },
        () => void load(),
      )
      .subscribe();
    const t = setInterval(load, 3000);
    return () => {
      stop = true;
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
    // names is a cache; reloading on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId]);

  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    try {
      await liveApi.send(streamId, me, body);
      setText("");
      setMessages(await liveApi.chat(streamId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message not sent.");
    }
  }

  async function moderate(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setMessages(await liveApi.chat(streamId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    }
  }

  return (
    <section className="live-chat" aria-label="Live chat">
      <div className="live-bursts" aria-hidden="true">
        {bursts.map((b) => (
          <span key={b.id} className="burst">
            {REACTIONS.find((r) => r.kind === b.kind)?.label}
          </span>
        ))}
      </div>
      <ol className="live-chat-list" ref={list}>
        {messages.length === 0 && <li className="muted small">No messages yet.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.hidden_at ? "hidden-msg" : ""} data-testid="chat-message">
            <strong>{m.sender_id === me ? "You" : (names[m.sender_id] ?? "Viewer")}</strong>{" "}
            <span>{m.body}</span>
            {m.hidden_at && <em className="muted small"> (hidden)</em>}
            {host && m.sender_id !== me && !m.hidden_at && (
              <span className="chat-mod">
                <button className="link small" onClick={() => void moderate(() => liveApi.hide(m.id))}>
                  Hide
                </button>
                <button
                  className="link small"
                  onClick={() => void moderate(() => liveApi.mute(streamId, m.sender_id, 10))}
                >
                  Mute 10 min
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {error && (
        <p className="alert error small" role="alert">
          {error}
        </p>
      )}
      {live ? (
        <>
          <div className="live-reactions" role="group" aria-label="Reactions">
            {REACTIONS.map((r) => (
              <button
                key={r.kind}
                className="reaction"
                aria-label={r.name}
                onClick={() => void liveApi.react(streamId, r.kind).catch(() => undefined)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <form className="row" onSubmit={send}>
            <input
              aria-label="Chat message"
              placeholder="Say something kind…"
              maxLength={300}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn dark small" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </>
      ) : (
        <p className="muted small">Chat is closed.</p>
      )}
    </section>
  );
}
