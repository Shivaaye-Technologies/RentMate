import { useCallback, useEffect, useState } from "react";
import { personFromRow, type Person } from "../api";
import { loadMatches, type MatchSummary } from "../inbox";
import type { PersonRow } from "../profile";
import { supabase } from "../supabase";
import { Icon, VerifiedBadge } from "./Icon";
import { Photo } from "./Photo";
import { DemoBadge } from "./DemoBadge";

export interface ReceivedLike {
  person: Person;
  isSuper: boolean;
  message: string | null;
  at: string;
}

async function peopleByIds(ids: string[]): Promise<Map<string, PersonRow>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc("profiles_by_ids", { p_ids: ids });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as PersonRow[]).map((r) => [r.id, r]));
}

/**
 * People who liked you and you haven't answered yet (no like or pass from you).
 * RLS lets you read likes you received; nothing else about other users' likes.
 */
export async function loadReceivedLikes(me: string): Promise<ReceivedLike[]> {
  const [received, mine, passed] = await Promise.all([
    supabase
      .from("likes")
      .select("liker_id, is_super, message, created_at")
      .eq("liked_id", me)
      .order("created_at", { ascending: false }),
    supabase.from("likes").select("liked_id").eq("liker_id", me),
    supabase.from("passes").select("passed_id").eq("passer_id", me),
  ]);
  const failed = received.error ?? mine.error ?? passed.error;
  if (failed) throw new Error(failed.message);

  const answered = new Set([
    ...(mine.data ?? []).map((l) => l.liked_id as string),
    ...(passed.data ?? []).map((p) => p.passed_id as string),
  ]);
  const pending = (received.data ?? []).filter((l) => !answered.has(l.liker_id as string));
  const byId = await peopleByIds(pending.map((l) => l.liker_id as string));
  return pending.flatMap((l) => {
    const row = byId.get(l.liker_id as string);
    if (!row) return [];
    return [
      {
        person: personFromRow(row),
        isSuper: Boolean(l.is_super),
        message: (l.message as string | null) ?? null,
        at: l.created_at as string,
      },
    ];
  });
}

export interface SentLike {
  person: Person;
  isSuper: boolean;
  at: string;
}

/** People you liked who haven't liked you back yet (no match). */
export async function loadSentLikes(me: string): Promise<SentLike[]> {
  const [mine, back] = await Promise.all([
    supabase
      .from("likes")
      .select("liked_id, is_super, created_at")
      .eq("liker_id", me)
      .order("created_at", { ascending: false }),
    supabase.from("likes").select("liker_id").eq("liked_id", me),
  ]);
  const failed = mine.error ?? back.error;
  if (failed) throw new Error(failed.message);
  const likedMe = new Set((back.data ?? []).map((l) => l.liker_id as string));
  const waiting = (mine.data ?? []).filter((l) => !likedMe.has(l.liked_id as string));
  const byId = await peopleByIds(waiting.map((l) => l.liked_id as string));
  return waiting.flatMap((l) => {
    const row = byId.get(l.liked_id as string);
    return row
      ? [{ person: personFromRow(row), isSuper: Boolean(l.is_super), at: l.created_at as string }]
      : [];
  });
}

type Tab = "received" | "sent" | "matches";

function Tile({
  person,
  onClick,
  tag,
  msg,
  super: isSuper,
}: {
  person: Person;
  onClick: () => void;
  tag?: string;
  msg?: string | null;
  super?: boolean;
}) {
  return (
    <button className={isSuper ? "tile super" : "tile"} onClick={onClick}>
      <Photo id={person.id} name={person.displayName} path={person.photoPath} textSize={44} />
      {tag && (
        <span className={isSuper ? "pill gold tile-tag" : "pill white tile-tag"}>
          {isSuper && <Icon name="star" size={12} />} {tag}
        </span>
      )}
      <span className="tile-name">
        {person.displayName}, {person.age} {person.verified && <VerifiedBadge size={15} />}{" "}
        <DemoBadge id={person.id} />
      </span>
      {msg && <span className="tile-msg">“{msg}”</span>}
    </button>
  );
}

export function LikesView({
  me,
  refreshKey,
  onOpen,
  onOpenMatch,
  onCount,
}: {
  me: string;
  refreshKey: number;
  /** Open a profile; `actions` = can like/pass from the sheet. */
  onOpen: (person: Person, actions: boolean) => void;
  onOpenMatch: (m: MatchSummary) => void;
  onCount: (n: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("received");
  const [received, setReceived] = useState<ReceivedLike[] | null>(null);
  const [sent, setSent] = useState<SentLike[] | null>(null);
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s, m] = await Promise.all([loadReceivedLikes(me), loadSentLikes(me), loadMatches(me)]);
      setReceived(r);
      setSent(s);
      setMatches(m);
      onCount(r.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load likes.");
    } finally {
      setLoading(false);
    }
  }, [me, onCount]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const tabs: { key: Tab; label: string; count: number | null }[] = [
    { key: "received", label: "Liked you", count: received?.length ?? null },
    { key: "sent", label: "You liked", count: sent?.length ?? null },
    { key: "matches", label: "Matches", count: matches?.length ?? null },
  ];

  const empty = (text: string) => (
    <div className="empty small">
      <Icon name="heart" size={40} />
      <p className="muted">{text}</p>
    </div>
  );

  return (
    <section>
      <div className="page-head between">
        <h2 className="display-md page-title">Likes</h2>
        <button className="btn small" disabled={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <div className="segmented" role="tablist" aria-label="Likes">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>

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
      {!error && !received && (
        <div className="empty">
          <div className="spinner" aria-hidden="true" />
        </div>
      )}

      {!error &&
        received &&
        tab === "received" &&
        (received.length === 0 ? (
          empty("No new likes yet. A great photo, a prompt and your city help you get noticed.")
        ) : (
          <>
            <p className="muted">Like them back to match.</p>
            <div className="grid">
              {received.map((l) => (
                <Tile
                  key={l.person.id}
                  person={l.person}
                  super={l.isSuper}
                  tag={l.isSuper ? "Super Like" : undefined}
                  msg={l.message}
                  onClick={() => onOpen(l.person, true)}
                />
              ))}
            </div>
          </>
        ))}

      {!error &&
        sent &&
        tab === "sent" &&
        (sent.length === 0 ? (
          empty("You haven't liked anyone who hasn't replied yet.")
        ) : (
          <>
            <p className="muted">Waiting for them to like you back. When they do, it's a Match.</p>
            <div className="grid">
              {sent.map((l) => (
                <Tile
                  key={l.person.id}
                  person={l.person}
                  super={l.isSuper}
                  tag={l.isSuper ? "Super Like" : "Pending"}
                  onClick={() => onOpen(l.person, false)}
                />
              ))}
            </div>
          </>
        ))}

      {!error &&
        matches &&
        tab === "matches" &&
        (matches.length === 0 ? (
          empty("No matches yet. When you both like each other, they appear here.")
        ) : (
          <div className="grid">
            {matches.map((m) => (
              <Tile key={m.matchId} person={m.person} tag="Match" onClick={() => onOpenMatch(m)} />
            ))}
          </div>
        ))}
    </section>
  );
}
