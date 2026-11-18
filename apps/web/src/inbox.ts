import { personFromRow, type Person } from "./api";
import { isMissingColumn } from "./profileApi";
import { otherUserId, type NotifyPrefs, type PersonRow } from "./profile";
import { supabase } from "./supabase";

export interface MatchSummary {
  matchId: string;
  person: Person;
  since: string;
  lastMessage: string | null;
  lastAt: string | null;
  lastFromMe: boolean;
  /** Messages from them after you last opened the chat; null when read markers aren't available. */
  unread: number | null;
}

interface Msg {
  match_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/** Messages from the other person newer than your read marker (all of theirs if never opened). */
export function unreadCount(
  messages: Pick<Msg, "sender_id" | "created_at">[],
  me: string,
  readAt: string | null,
) {
  const since = readAt ? Date.parse(readAt) : -Infinity;
  return messages.filter((m) => m.sender_id !== me && Date.parse(m.created_at) > since).length;
}

/** Your matches with the latest message and real unread counts, newest activity first. */
export async function loadMatches(me: string): Promise<MatchSummary[]> {
  const { data: rows, error } = await supabase
    .from("matches")
    .select("id, user_a, user_b, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const matches = rows ?? [];
  if (matches.length === 0) return [];
  const ids = matches.map((m) => otherUserId(m, me));
  const matchIds = matches.map((m) => m.id as string);

  const [people, msgs, reads] = await Promise.all([
    supabase.rpc("profiles_by_ids", { p_ids: ids }),
    supabase
      .from("messages")
      .select("match_id, sender_id, body, created_at")
      .in("match_id", matchIds)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("match_reads").select("match_id, read_at").eq("user_id", me),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (msgs.error) throw new Error(msgs.error.message);
  // Before the read-marker migration the table is missing: show no counts rather than wrong ones.
  const readsOk = !reads.error;
  if (
    reads.error &&
    !isMissingColumn(reads.error) &&
    reads.error.code !== "42P01" &&
    reads.error.code !== "PGRST205"
  ) {
    console.error("Could not load read markers", reads.error.message);
  }

  const byId = new Map(((people.data ?? []) as PersonRow[]).map((p) => [p.id, p]));
  const readAt = new Map(
    ((reads.data ?? []) as { match_id: string; read_at: string }[]).map((r) => [r.match_id, r.read_at]),
  );
  const perMatch = new Map<string, Msg[]>();
  for (const m of (msgs.data ?? []) as Msg[]) {
    const list = perMatch.get(m.match_id) ?? [];
    list.push(m);
    perMatch.set(m.match_id, list);
  }

  const list = matches.flatMap((m) => {
    const row = byId.get(otherUserId(m, me));
    if (!row) return [];
    const thread = perMatch.get(m.id as string) ?? [];
    const lm = thread[0];
    return [
      {
        matchId: m.id as string,
        person: personFromRow(row),
        since: m.created_at as string,
        lastMessage: lm?.body ?? null,
        lastAt: lm?.created_at ?? null,
        lastFromMe: lm?.sender_id === me,
        unread: readsOk ? unreadCount(thread, me, readAt.get(m.id as string) ?? null) : null,
      },
    ];
  });
  list.sort((a, b) => (b.lastAt ?? b.since).localeCompare(a.lastAt ?? a.since));
  return list;
}

/** Records that you've read a chat up to now. Silently skipped before the migration. */
export async function markRead(matchId: string, me: string): Promise<void> {
  const { error } = await supabase
    .from("match_reads")
    .upsert(
      { match_id: matchId, user_id: me, read_at: new Date().toISOString() },
      { onConflict: "match_id,user_id" },
    );
  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.error("Could not save read marker", error.message);
  }
}

export type NoticeKind = "like" | "super" | "match" | "message";

export interface Notice {
  id: string;
  kind: NoticeKind;
  at: string;
  person: Person;
  text: string;
  matchId: string | null;
}

export const DEFAULT_PREFS: Required<NotifyPrefs> = { likes: true, matches: true, messages: true };

export function prefsOf(p: NotifyPrefs | null | undefined): Required<NotifyPrefs> {
  return { ...DEFAULT_PREFS, ...(p ?? {}) };
}

interface LikeLike {
  person: Person;
  isSuper: boolean;
  at: string;
}

/** Notifications built only from real records: likes you received, matches and unread messages. */
export function buildNotices(
  likes: LikeLike[],
  matches: MatchSummary[],
  prefs: NotifyPrefs | null | undefined,
) {
  const p = prefsOf(prefs);
  const out: Notice[] = [];
  if (p.likes) {
    for (const l of likes) {
      out.push({
        id: `like:${l.person.id}`,
        kind: l.isSuper ? "super" : "like",
        at: l.at,
        person: l.person,
        text: l.isSuper
          ? `${l.person.displayName} sent you a Super Like`
          : `${l.person.displayName} likes you`,
        matchId: null,
      });
    }
  }
  for (const m of matches) {
    if (p.matches) {
      out.push({
        id: `match:${m.matchId}`,
        kind: "match",
        at: m.since,
        person: m.person,
        text: `It's a Match with ${m.person.displayName}`,
        matchId: m.matchId,
      });
    }
    if (p.messages && m.unread && m.unread > 0 && m.lastAt) {
      out.push({
        id: `msg:${m.matchId}`,
        kind: "message",
        at: m.lastAt,
        person: m.person,
        text:
          m.unread === 1
            ? `New message from ${m.person.displayName}`
            : `${m.unread} new messages from ${m.person.displayName}`,
        matchId: m.matchId,
      });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

export interface Counts {
  likes: number;
  matches: number;
  unread: number;
}

/** Alert texts for what increased since the last check (nothing on the first check). */
export function alertsFor(
  prev: Counts | null,
  next: Counts,
  prefs: NotifyPrefs | null | undefined,
): string[] {
  if (!prev) return [];
  const p = prefsOf(prefs);
  const out: string[] = [];
  if (p.likes && next.likes > prev.likes) out.push("Someone new likes you on SOULMATE.AI");
  if (p.matches && next.matches > prev.matches) out.push("You have a new Match on SOULMATE.AI");
  if (p.messages && next.unread > prev.unread) out.push("You have a new message on SOULMATE.AI");
  return out;
}

const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "14:05" today, "Yesterday", a weekday within a week, otherwise a date. */
export function shortTime(iso: string, now = Date.now(), locale?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const today = startOfDay(now);
  if (t >= today) return new Date(t).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (t >= today - DAY) return "Yesterday";
  if (t >= today - 6 * DAY) return new Date(t).toLocaleDateString(locale, { weekday: "short" });
  return new Date(t).toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/** Label for a date separator in a chat. */
export function dayLabel(iso: string, now = Date.now(), locale?: string): string {
  const t = Date.parse(iso);
  const today = startOfDay(now);
  if (t >= today) return "Today";
  if (t >= today - DAY) return "Yesterday";
  return new Date(t).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** True when a separator belongs before message i (first message or a new day). */
export function startsNewDay(list: { created_at: string }[], i: number): boolean {
  if (i === 0) return true;
  return startOfDay(Date.parse(list[i].created_at)) !== startOfDay(Date.parse(list[i - 1].created_at));
}
