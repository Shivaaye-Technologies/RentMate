import { useEffect, useState } from "react";
import { personFromRow, type Person } from "../api";
import type { PersonRow } from "../profile";
import { supabase } from "../supabase";
import { Icon, VerifiedBadge } from "./Icon";
import { Photo } from "./Photo";

export interface ReceivedLike {
  person: Person;
  isSuper: boolean;
  message: string | null;
  at: string;
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
  if (pending.length === 0) return [];

  const { data: rows, error } = await supabase.rpc("profiles_by_ids", {
    p_ids: pending.map((l) => l.liker_id as string),
  });
  if (error) throw new Error(error.message);
  const byId = new Map(((rows ?? []) as PersonRow[]).map((r) => [r.id, r]));

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

export function LikesView({
  me,
  refreshKey,
  onOpen,
  onCount,
}: {
  me: string;
  refreshKey: number;
  onOpen: (like: ReceivedLike) => void;
  onCount: (n: number) => void;
}) {
  const [likes, setLikes] = useState<ReceivedLike[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadReceivedLikes(me)
      .then((l) => {
        if (cancelled) return;
        setLikes(l);
        onCount(l.length);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [me, refreshKey, onCount]);

  if (error) return <p className="alert error">{error}</p>;
  if (!likes) {
    return (
      <div className="empty">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <section>
      <h2 className="display-md page-title">Likes</h2>
      <p className="muted">People who liked you. Like them back to match.</p>
      {likes.length === 0 ? (
        <div className="empty small">
          <Icon name="heart" size={40} />
          <p className="muted">No new likes yet. A great photo and bio help you get noticed.</p>
        </div>
      ) : (
        <div className="grid">
          {likes.map((l) => (
            <button key={l.person.id} className={l.isSuper ? "tile super" : "tile"} onClick={() => onOpen(l)}>
              <Photo id={l.person.id} name={l.person.displayName} path={l.person.photoPath} textSize={44} />
              {l.isSuper && (
                <span className="pill gold tile-tag">
                  <Icon name="star" size={12} /> Super Like
                </span>
              )}
              <span className="tile-name">
                {l.person.displayName}, {l.person.age} {l.person.verified && <VerifiedBadge size={15} />}
              </span>
              {l.message && <span className="tile-msg">“{l.message}”</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
