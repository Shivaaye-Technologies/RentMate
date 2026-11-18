import { useCallback, useEffect, useState, type FormEvent } from "react";
import { marketApi, namesFor, type ChatMessage, type Conversation } from "./marketData";

/** Member ↔ companion conversations (separate from dating matches). */
export function MarketChat({ me, initial }: { me: string; initial?: string | null }) {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [open, setOpen] = useState<string | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const cs = await marketApi.conversations();
      // Load names and unread counts first so the list never flashes placeholder names.
      const [n, u] = await Promise.all([
        namesFor(cs.flatMap((c) => [c.member_id, c.companion_id])),
        marketApi.unread(me),
      ]);
      setNames(n);
      setUnread(u);
      setConvs(cs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load messages.");
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <p className="alert error">{error}</p>;
  if (!convs) return <div className="spinner" aria-hidden="true" />;
  const current = convs.find((c) => c.id === open);
  if (current) {
    const other = current.member_id === me ? current.companion_id : current.member_id;
    return (
      <Thread
        me={me}
        conversation={current}
        otherName={names[other] ?? "Member"}
        onBack={() => {
          setOpen(null);
          void reload();
        }}
      />
    );
  }
  if (convs.length === 0) {
    return (
      <p className="muted">
        No conversations yet. Open a companion's profile and tap “Message” to ask about an activity before
        booking.
      </p>
    );
  }
  return (
    <ul className="plain-list conv-list">
      {convs.map((c) => {
        const other = c.member_id === me ? c.companion_id : c.member_id;
        return (
          <li key={c.id}>
            <button className="menu-row" onClick={() => setOpen(c.id)}>
              <strong>{names[other] ?? "Member"}</strong>
              <span className="muted small">
                {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : "No messages yet"}
              </span>
              {unread[c.id] ? <span className="pill status-requested">{unread[c.id]} new</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Thread({
  me,
  conversation,
  otherName,
  onBack,
}: {
  me: string;
  conversation: Conversation;
  otherName: string;
  onBack: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMsgs(await marketApi.messages(conversation.id));
      await marketApi.markRead(conversation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this conversation.");
    }
  }, [conversation.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await marketApi.send(conversation.id, me, body);
      setText("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel thread">
      <div className="row between">
        <button className="btn small" onClick={onBack}>
          ← Conversations
        </button>
        <strong>{otherName}</strong>
      </div>
      <p className="muted small">Keep plans to public places. Never share your home address.</p>
      {!msgs ? (
        <div className="spinner" aria-hidden="true" />
      ) : msgs.length === 0 ? (
        <p className="muted">Say hello and ask about the activity.</p>
      ) : (
        <ul className="plain-list thread-list">
          {msgs.map((m) => (
            <li key={m.id} className={m.sender_id === me ? "mine" : "theirs"}>
              <span>{m.body}</span>
              <small className="muted">
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {m.sender_id === me && m.read_at ? " · read" : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <form className="row" onSubmit={send}>
        <input
          aria-label="Message"
          placeholder="Write a message…"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn dark" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
