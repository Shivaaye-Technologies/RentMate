import { useCallback, useEffect, useState } from "react";
import { loadMatches, shortTime, type MatchSummary } from "../inbox";
import { supabase } from "../supabase";
import { Icon } from "./Icon";
import { Photo } from "./Photo";
import { DemoBadge } from "./DemoBadge";

export type { MatchSummary };

/** Official welcome from the SOULMATE.AI team (an in-app card, not a dating profile). */
export function WelcomeCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <article className="welcome-card" aria-label="Welcome from the SOULMATE.AI team">
      <header>
        <span className="logo-mark small" aria-hidden="true">
          <Icon name="heart" size={14} />
        </span>
        <span>
          <strong>SOULMATE.AI Team</strong>
          <small>Official message · not a member profile</small>
        </span>
      </header>
      <p>Welcome! A few tips to get started:</p>
      <ul className="tips">
        <li>Complete your profile: photos, a prompt and your city help people say hello.</li>
        <li>Crush and Discover show real members whose age preferences fit yours.</li>
        <li>When you both like each other it's a Match, and your chat appears here.</li>
        <li>Choose your notifications in Profile → Notifications.</li>
        <li>Stay safe: chat here first, meet in public, and use Report or block if anything feels wrong.</li>
      </ul>
      <button className="btn small dark" onClick={onDismiss}>
        Got it
      </button>
    </article>
  );
}

export function ChatsList({
  me,
  showWelcome,
  onDismissWelcome,
  onOpen,
  onUnread,
}: {
  me: string;
  showWelcome: boolean;
  onDismissWelcome: () => void;
  onOpen: (m: MatchSummary) => void;
  /** Total unread messages (null when unknown). */
  onUnread?: (n: number | null) => void;
}) {
  const [items, setItems] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await loadMatches(me);
      setItems(list);
      setError(null);
      const known = list.filter((m) => m.unread !== null);
      onUnread?.(known.length === list.length ? known.reduce((n, m) => n + (m.unread ?? 0), 0) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your chats.");
    }
  }, [me, onUnread]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`chats:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, () => void load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me, load]);

  const fresh = (items ?? []).filter((i) => !i.lastMessage);
  const convos = (items ?? []).filter((i) => i.lastMessage);

  return (
    <section>
      <h2 className="display-md page-title">Chats</h2>
      {showWelcome && <WelcomeCard onDismiss={onDismissWelcome} />}

      {error && (
        <div className="empty small">
          <p className="alert error" role="alert">
            {error}
          </p>
          <button className="btn dark" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {!items && !error && (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {items && items.length === 0 && (
        <div className="empty small">
          <Icon name="chat" size={40} />
          <p className="muted">When you and someone like each other, you can chat here.</p>
        </div>
      )}

      {fresh.length > 0 && (
        <>
          <h3 className="section-label">New matches</h3>
          <div className="new-matches">
            {fresh.map((m) => (
              <button key={m.matchId} className="new-match" onClick={() => onOpen(m)}>
                <Photo id={m.person.id} name={m.person.displayName} path={m.person.photoPath} textSize={26} />
                <span>
                  {m.person.displayName} <DemoBadge id={m.person.id} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {convos.length > 0 && (
        <>
          <h3 className="section-label">Conversations</h3>
          <ul className="convo-list">
            {convos.map((m) => {
              const unread = m.unread ?? 0;
              return (
                <li key={m.matchId}>
                  <button
                    className={unread > 0 ? "convo unread" : "convo"}
                    onClick={() => onOpen(m)}
                    aria-label={`${m.person.displayName}${unread > 0 ? `, ${unread} unread` : ""}`}
                  >
                    <span className="convo-photo">
                      <Photo
                        id={m.person.id}
                        name={m.person.displayName}
                        path={m.person.photoPath}
                        textSize={20}
                      />
                      {m.person.online && <i className="dot-online" />}
                    </span>
                    <span className="convo-text">
                      <strong>
                        {m.person.displayName} <DemoBadge id={m.person.id} />
                      </strong>
                      <small className="muted">
                        {m.lastFromMe ? "You: " : ""}
                        {m.lastMessage}
                      </small>
                    </span>
                    <span className="convo-meta">
                      {m.lastAt && <small className="muted">{shortTime(m.lastAt)}</small>}
                      {unread > 0 && <b className="count">{unread > 9 ? "9+" : unread}</b>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
