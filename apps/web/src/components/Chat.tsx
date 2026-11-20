import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Person } from "../api";
import { dayLabel, markRead, startsNewDay } from "../inbox";
import { storyDate } from "../profile";
import { supabase } from "../supabase";
import { Icon, VerifiedBadge } from "./Icon";
import { Photo } from "./Photo";
import { DemoBadge } from "./DemoBadge";
import { POLICY_TEXT_BLOCKED } from "../safety";
import { CallButtons } from "../rtc/CallButtons";

interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /** Local only: a message that didn't send, kept so it can be retried. */
  failed?: boolean;
}

interface MatchRow {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
  ready_a: boolean;
  ready_b: boolean;
}

interface Props {
  me: string;
  myProfile: { id: string; display_name: string; photo_path?: string | null };
  matchId: string;
  person: Person;
  onBack: () => void;
  onProfile: () => void;
  /** Opens report / block / unmatch options. */
  onSafety: () => void;
}

function addUnique(list: Message[], m: Message): Message[] {
  return list.some((x) => x.id === m.id) ? list : [...list, m];
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Chat({ me, myProfile, matchId, person, onBack, onProfile, onSafety }: Props) {
  const [match, setMatch] = useState<MatchRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("matches")
      .select("id, user_a, user_b, created_at, ready_a, ready_b")
      .eq("id", matchId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(`Could not load this match: ${error.message}`);
        else if (data) setMatch(data as MatchRow);
      });
    void supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true })
      .limit(300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else {
          setMessages(data ?? []);
          void markRead(matchId, me);
        }
      });

    const channel = supabase
      .channel(`chat:${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${matchId}` },
        (payload) => {
          setMessages((list) => addUnique(list, payload.new as Message));
          if ((payload.new as Message).sender_id !== me) void markRead(matchId, me);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => setMatch(payload.new as MatchRow),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [matchId, me]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, match?.ready_a, match?.ready_b]);

  const iAmA = match ? match.user_a === me : false;
  const myReady = match ? (iAmA ? match.ready_a : match.ready_b) : false;
  const theirReady = match ? (iAmA ? match.ready_b : match.ready_a) : false;

  async function toggleReady() {
    if (!match) return;
    setError(null);
    const next = !myReady;
    setMatch({ ...match, ...(iAmA ? { ready_a: next } : { ready_b: next }) });
    const { error } = await supabase.rpc("set_ready_to_meet", { p_match_id: matchId, p_ready: next });
    if (error) {
      setError(error.message);
      setMatch(match);
    }
  }

  async function deliver(body: string, localId: string) {
    setSending(true);
    setError(null);
    const { data, error } = await supabase
      .from("messages")
      .insert({ match_id: matchId, sender_id: me, body: body.slice(0, 2000) })
      .select("id, sender_id, body, created_at")
      .single();
    setSending(false);
    if (error) {
      // Keep the message on screen, marked as failed, so it can be retried.
      setMessages((list) =>
        list.some((m) => m.id === localId)
          ? list.map((m) => (m.id === localId ? { ...m, failed: true } : m))
          : [
              ...list,
              { id: localId, sender_id: me, body, created_at: new Date().toISOString(), failed: true },
            ],
      );
      setError(
        /too fast/i.test(error.message)
          ? error.message
          : /RentMate does not allow/i.test(error.message)
            ? POLICY_TEXT_BLOCKED
            : "Message not sent. Tap Retry to try again.",
      );
      return;
    }
    setMessages((list) =>
      addUnique(
        list.filter((m) => m.id !== localId),
        data as Message,
      ),
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setDraft("");
    await deliver(body, `local-${crypto.randomUUID()}`);
  }

  return (
    <section className="chat">
      <header className="chat-head">
        <button className="icon-btn" aria-label="Back to chats" onClick={onBack}>
          <Icon name="back" />
        </button>
        <button className="chat-who" onClick={onProfile}>
          <Photo
            id={person.id}
            name={person.displayName}
            path={person.photoPath}
            className="mini"
            textSize={15}
          />
          <span>
            <strong>
              {person.displayName}, {person.age} {person.verified && <VerifiedBadge size={15} />}{" "}
              <DemoBadge id={person.id} />
            </strong>
            <small>{person.online ? "Online · View profile" : "View profile"}</small>
          </span>
        </button>
        <CallButtons personId={person.id} name={person.displayName} />
        <button
          className="icon-btn more"
          aria-label={`Safety options for ${person.displayName}`}
          onClick={onSafety}
        >
          <Icon name="more" />
        </button>
      </header>

      <div className="chat-body">
        <div className="story">
          <div className="duo">
            <Photo
              id={myProfile.id}
              name={myProfile.display_name}
              path={myProfile.photo_path}
              className="mini"
              textSize={15}
            />
            <Photo
              id={person.id}
              name={person.displayName}
              path={person.photoPath}
              className="mini"
              textSize={15}
            />
          </div>
          <p>{match ? `Your story began on ${storyDate(match.created_at)}` : " "}</p>
        </div>

        {messages.map((m, i) => (
          <div key={m.id} className="msg-wrap">
            {startsNewDay(messages, i) && <p className="stamp">{dayLabel(m.created_at)}</p>}
            <div
              className={m.sender_id === me ? (m.failed ? "bubble mine failed" : "bubble mine") : "bubble"}
            >
              {m.body}
              <small className="time">{m.failed ? "Not sent" : timeOf(m.created_at)}</small>
            </div>
            {m.failed && (
              <button
                className="btn small retry"
                disabled={sending}
                onClick={() => void deliver(m.body, m.id)}
              >
                Retry
              </button>
            )}
          </div>
        ))}

        {myReady && theirReady && (
          <div className="meet-banner">
            <div className="duo">
              <Photo
                id={myProfile.id}
                name={myProfile.display_name}
                path={myProfile.photo_path}
                className="mini"
                textSize={15}
              />
              <Photo
                id={person.id}
                name={person.displayName}
                path={person.photoPath}
                className="mini"
                textSize={15}
              />
            </div>
            <p className="display-sm">You are both ready to meet IRL</p>
            <p>Now it's your turn! Pick a public place for your first date.</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="alert error">{error}</p>}

      <div className="chat-foot">
        {match && !(myReady && theirReady) && (
          <button className={myReady ? "ready-btn on" : "ready-btn"} onClick={() => void toggleReady()}>
            <Icon name={myReady ? "check" : "sparkle"} size={16} />
            {myReady
              ? `You're ready to meet · waiting for ${person.displayName}`
              : theirReady
                ? `${person.displayName} is ready to meet. Are you?`
                : "I'm ready to meet in real life"}
          </button>
        )}
        <form className="composer" onSubmit={send}>
          <input
            aria-label="Message"
            placeholder="Write a message…"
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="send" aria-label="Send" disabled={sending || !draft.trim()}>
            <Icon name="back" size={20} />
          </button>
        </form>
      </div>
    </section>
  );
}
