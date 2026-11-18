import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Monogram } from "../components/Monogram";
import type { Person } from "../api";
import { CrushStack } from "../components/CrushStack";
import { DiscoverHub } from "../components/DiscoverHub";
import { Icon, type IconName } from "../components/Icon";
import { Photo } from "../components/Photo";
import { MatchOverlay, ProfileSheet, SuperLikeSheet } from "../components/Sheets";
import { DemoBadge } from "../components/DemoBadge";
import { loadDemoIds, setDemoIds } from "../demo";
import { loadDemoPeople } from "./data";
import {
  decide,
  deck,
  isTyping,
  loadState,
  newState,
  randomSeed,
  receivedLikes,
  rewind,
  saveState,
  sendMessage,
  visibleMessages,
  type Decision,
  type DemoState,
} from "./sim";

type Tab = "crush" | "discover" | "likes" | "chats";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "crush", label: "Crush", icon: "cards" },
  { key: "discover", label: "Discover", icon: "grid" },
  { key: "likes", label: "Likes", icon: "heart" },
  { key: "chats", label: "Chats", icon: "chat" },
];

export const SIMULATED_NOTE = "Simulated: demo profiles are fictional and nothing here reaches real members.";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Re-renders every few seconds so simulated likes and replies arrive on their own. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Banner shown on every Demo Mode screen. */
export function DemoBanner({
  signedIn,
  onExit,
  onReset,
}: {
  signedIn: boolean;
  onExit: () => void;
  onReset: () => void;
}) {
  return (
    <div className="demo-banner" role="note" aria-label="Demo Mode">
      <p>
        <strong>Demo Mode</strong> · Every profile, like, match and message here is{" "}
        <b>fictional and simulated</b>. Nothing is saved to real accounts or shown to real members.
      </p>
      <div className="demo-banner-actions">
        <button className="btn small" onClick={onReset}>
          Start over
        </button>
        <button className="btn small dark" onClick={onExit}>
          {signedIn ? "Back to the app" : "Exit demo"}
        </button>
      </div>
    </div>
  );
}

export function DemoMode({ signedIn, onExit }: { signedIn: boolean; onExit: () => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DemoState>(() => loadState(browserStorage(), Date.now()));
  const [tab, setTab] = useState<Tab>("crush");
  const [sheet, setSheet] = useState<{ person: Person; actions: boolean } | null>(null);
  const [superFor, setSuperFor] = useState<Person | null>(null);
  const [matched, setMatched] = useState<Person | null>(null);
  const [chatWith, setChatWith] = useState<Person | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const now = useNow(1000);

  const load = useCallback(async () => {
    setError(null);
    setPeople(null);
    try {
      const list = await loadDemoPeople();
      setPeople(list);
      setDemoIds(list.map((p) => p.id));
    } catch (e) {
      console.error("Demo Mode failed to load", e);
      setError(e instanceof Error ? e.message : "Could not load demo profiles.");
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      // Leaving Demo Mode: drop the labels (testers get theirs back from the database).
      setDemoIds([]);
      if (signedIn) void loadDemoIds();
    };
  }, [load, signedIn]);

  useEffect(() => saveState(browserStorage(), state), [state]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const all = useMemo(() => people ?? [], [people]);
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const stack = useMemo(() => deck(state, all), [state, all]);
  const likes = useMemo(() => receivedLikes(state, all, now), [state, all, now]);
  const matches = state.matches.flatMap((m) => {
    const p = byId.get(m.personId);
    return p ? [{ person: p, at: m.at }] : [];
  });

  const act = (person: Person, kind: Decision) => {
    const result = decide(state, person, kind, Date.now());
    setState(result.state);
    setSheet(null);
    setSuperFor(null);
    if (result.matched) setMatched(person);
    else if (kind !== "pass") flash(`You liked ${person.displayName} (simulated).`);
  };

  const reset = () => {
    setState(newState(randomSeed(), Date.now()));
    setChatWith(null);
    setTab("crush");
    flash("Demo restarted.");
  };

  const banner = <DemoBanner signedIn={signedIn} onExit={onExit} onReset={reset} />;

  if (error) {
    return (
      <div className="app demo">
        {banner}
        <main className="empty full">
          <p className="alert error" role="alert">
            {error}
          </p>
          <button className="btn dark" onClick={() => void load()}>
            Try again
          </button>
        </main>
      </div>
    );
  }
  if (!people) {
    return (
      <div className="app demo">
        {banner}
        <main className="empty full">
          <div className="spinner" aria-hidden="true" />
          <p>Loading fictional demo profiles…</p>
        </main>
      </div>
    );
  }

  if (chatWith) {
    return (
      <div className="app demo">
        {banner}
        <DemoChat
          person={chatWith}
          state={state}
          now={now}
          onSend={(text) => setState((s) => sendMessage(s, chatWith, text, Date.now()))}
          onBack={() => setChatWith(null)}
          onProfile={() => setSheet({ person: chatWith, actions: false })}
        />
        {sheet && <ProfileSheet person={sheet.person} onClose={() => setSheet(null)} />}
      </div>
    );
  }

  return (
    <div className={tab === "discover" ? "app demo dark-top" : "app demo"}>
      {banner}
      <header className="topbar">
        <span className="brand">
          <Monogram />
          RentMate <span className="demo-badge">Demo</span>
        </span>
      </header>

      <main className={tab === "discover" ? "shell flush" : "shell"}>
        {tab === "crush" && (
          <CrushStack
            people={stack}
            summary={{ candidates: all.length, outsideAgeRange: 0 }}
            onEditProfile={() => undefined}
            busy={false}
            canRewind={state.passed.length > 0}
            onPass={(p) => act(p, "pass")}
            onLike={(p) => act(p, "like")}
            onSuper={(p) => setSuperFor(p)}
            onRewind={() => setState(rewind(state))}
            onRefresh={reset}
          />
        )}

        {tab === "discover" && (
          <DiscoverHub
            people={stack}
            summary={{ candidates: all.length, outsideAgeRange: 0 }}
            onEditProfile={() => undefined}
            likesCount={likes.length}
            onOpenLikes={() => setTab("likes")}
            onOpen={(p) => setSheet({ person: p, actions: true })}
          />
        )}

        {tab === "likes" && (
          <section>
            <h2 className="display-md page-title">Likes</h2>
            <p className="muted">
              Fictional demo profiles that “liked” you. Like them back to see a simulated match.
            </p>
            {likes.length === 0 ? (
              <div className="empty small">
                <Icon name="heart" size={40} />
                <p className="muted">No simulated likes yet. New ones arrive every few minutes.</p>
              </div>
            ) : (
              <div className="grid">
                {likes.map((p) => (
                  <button key={p.id} className="tile" onClick={() => setSheet({ person: p, actions: true })}>
                    <Photo id={p.id} name={p.displayName} path={p.photoPath} textSize={44} />
                    <span className="pill tile-tag sim-tag">Simulated like</span>
                    <span className="tile-name">
                      {p.displayName}, {p.age} <DemoBadge id={p.id} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "chats" && (
          <section>
            <h2 className="display-md page-title">Chats</h2>
            <p className="muted">Simulated matches and conversations with fictional profiles.</p>
            {matches.length === 0 ? (
              <div className="empty small">
                <Icon name="chat" size={40} />
                <p className="muted">Like someone in Crush or Discover to get a simulated match.</p>
              </div>
            ) : (
              <ul className="convo-list">
                {[...matches]
                  .sort((a, b) => b.at - a.at)
                  .map(({ person: p }) => {
                    const last = visibleMessages(state, p.id, now).at(-1);
                    return (
                      <li key={p.id}>
                        <button className="convo" onClick={() => setChatWith(p)}>
                          <span className="convo-photo">
                            <Photo id={p.id} name={p.displayName} path={p.photoPath} textSize={20} />
                          </span>
                          <span className="convo-text">
                            <strong>
                              {p.displayName} <span className="pill sim-tag">Simulated</span>
                            </strong>
                            <small className="muted">
                              {isTyping(state, p.id, now)
                                ? "typing…"
                                : last
                                  ? `${last.from === "you" ? "You: " : ""}${last.body}`
                                  : "New simulated match"}
                            </small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>
        )}
      </main>

      <nav className="tabbar" aria-label="Demo Mode">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            aria-current={tab === t.key ? "page" : undefined}
            aria-label={t.label}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={24} />
            {t.key === "likes" && likes.length > 0 && <i className="badge-dot" />}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {sheet && (
        <ProfileSheet
          person={sheet.person}
          onClose={() => setSheet(null)}
          onPass={sheet.actions ? () => act(sheet.person, "pass") : undefined}
          onLike={sheet.actions ? () => act(sheet.person, "like") : undefined}
          onSuper={
            sheet.actions
              ? () => {
                  setSuperFor(sheet.person);
                  setSheet(null);
                }
              : undefined
          }
        />
      )}

      {superFor && (
        <SuperLikeSheet
          person={superFor}
          busy={false}
          onClose={() => setSuperFor(null)}
          onSend={() => act(superFor, "super")}
        />
      )}

      {matched && (
        <MatchOverlay
          person={matched}
          note={SIMULATED_NOTE}
          onClose={() => setMatched(null)}
          onProfile={() => {
            setSheet({ person: matched, actions: false });
            setMatched(null);
          }}
          onChat={() => {
            setChatWith(matched);
            setMatched(null);
          }}
        />
      )}
    </div>
  );
}

function DemoChat({
  person,
  state,
  now,
  onSend,
  onBack,
  onProfile,
}: {
  person: Person;
  state: DemoState;
  now: number;
  onSend: (text: string) => void;
  onBack: () => void;
  onProfile: () => void;
}) {
  const [draft, setDraft] = useState("");
  const messages = visibleMessages(state, person.id, now);
  const typing = isTyping(state, person.id, now);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, typing]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <section className="chat demo-chat">
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
              {person.displayName}, {person.age} <DemoBadge id={person.id} />
            </strong>
            <small>{typing ? "typing…" : "Simulated chat"}</small>
          </span>
        </button>
      </header>

      <div className="chat-body">
        <p className="sim-note">{SIMULATED_NOTE} Replies are scripted.</p>
        {messages.map((m) => (
          <div key={m.id} className="msg-wrap">
            <div className={m.from === "you" ? "bubble mine" : "bubble"}>{m.body}</div>
            {m.from === "them" && <span className="sim-label">Simulated reply</span>}
          </div>
        ))}
        {typing && (
          <div className="msg-wrap">
            <div className="bubble typing" aria-label={`${person.displayName} is typing`}>
              …
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-foot">
        <form className="composer" onSubmit={submit}>
          <input
            aria-label="Message"
            placeholder="Write a message… (simulated)"
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="send" aria-label="Send" disabled={!draft.trim()}>
            <Icon name="back" size={20} />
          </button>
        </form>
      </div>
    </section>
  );
}
