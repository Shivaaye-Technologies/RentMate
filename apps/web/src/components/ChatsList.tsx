import { useEffect, useState } from "react";
import { personFromRow, type Person } from "../api";
import { otherUserId, type PersonRow } from "../profile";
import { supabase } from "../supabase";
import { Icon } from "./Icon";
import { Photo } from "./Photo";

export interface MatchSummary {
  matchId: string;
  person: Person;
  since: string;
  lastMessage: string | null;
  lastAt: string | null;
  lastFromMe: boolean;
}

export function ChatsList({ me, onOpen }: { me: string; onOpen: (m: MatchSummary) => void }) {
  const [items, setItems] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: rows, error } = await supabase
        .from("matches")
        .select("id, user_a, user_b, created_at")
        .order("created_at", { ascending: false });
      if (error) {
        if (!cancelled) setError(error.message);
        return;
      }
      const matches = rows ?? [];
      const ids = matches.map((m) => otherUserId(m, me));
      const matchIds = matches.map((m) => m.id as string);
      const [people, msgs] = await Promise.all([
        ids.length ? supabase.rpc("profiles_by_ids", { p_ids: ids }) : { data: [], error: null },
        matchIds.length
          ? supabase
              .from("messages")
              .select("match_id, sender_id, body, created_at")
              .in("match_id", matchIds)
              .order("created_at", { ascending: false })
              .limit(500)
          : { data: [], error: null },
      ]);
      if (cancelled) return;
      const byId = new Map(((people.data ?? []) as PersonRow[]).map((p) => [p.id, p]));
      const last = new Map<string, { body: string; created_at: string; sender_id: string }>();
      for (const m of (msgs.data ?? []) as {
        match_id: string;
        body: string;
        created_at: string;
        sender_id: string;
      }[]) {
        if (!last.has(m.match_id)) last.set(m.match_id, m);
      }

      const list = matches.flatMap((m) => {
        const row = byId.get(otherUserId(m, me));
        if (!row) return [];
        const lm = last.get(m.id as string);
        return [
          {
            matchId: m.id as string,
            person: personFromRow(row),
            since: m.created_at as string,
            lastMessage: lm?.body ?? null,
            lastAt: lm?.created_at ?? null,
            lastFromMe: lm?.sender_id === me,
          },
        ];
      });
      list.sort((a, b) => (b.lastAt ?? b.since).localeCompare(a.lastAt ?? a.since));
      setItems(list);
    }

    void load();
    const channel = supabase
      .channel(`chats:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, () => void load())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => void load())
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [me]);

  if (error) return <p className="alert error">{error}</p>;
  if (!items) {
    return (
      <div className="empty">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  const fresh = items.filter((i) => !i.lastMessage);
  const convos = items.filter((i) => i.lastMessage);

  return (
    <section>
      <h2 className="display-md page-title">Chats</h2>
      {items.length === 0 && (
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
                <span>{m.person.displayName}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {convos.length > 0 && (
        <>
          <h3 className="section-label">Conversations</h3>
          <ul className="convo-list">
            {convos.map((m) => (
              <li key={m.matchId}>
                <button className="convo" onClick={() => onOpen(m)}>
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
                    <strong>{m.person.displayName}</strong>
                    <small className="muted">
                      {m.lastFromMe ? "You: " : ""}
                      {m.lastMessage}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
