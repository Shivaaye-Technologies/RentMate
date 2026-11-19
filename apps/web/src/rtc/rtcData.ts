import { apiBaseUrl } from "../api";
import { supabase } from "../supabase";
import type { CallMode } from "./callState";

export interface CallRecord {
  id: string;
  caller_id: string;
  callee_id: string;
  mode: CallMode;
  status: string;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
}

export interface RoomToken {
  url: string;
  token: string;
  expiresAt: string;
  room: string;
}

/** Plain-language message for a database or server refusal. */
export function rtcError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return "Something went wrong.";
  if (e.code === "42501") return e.message ?? "That isn't allowed.";
  return e.message ?? "Something went wrong.";
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(rtcError(error));
  return data as T;
}

/** Calls the RentMate API with the user's session (room tokens and room control need the server). */
export async function serverApi<T>(path: string, body: unknown = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  let res: Response;
  try {
    res = await fetch(`${apiBaseUrl()}/api/v1${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the RentMate server. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as { error?: string; reasons?: string[] } | null;
  if (!res.ok)
    throw new Error(json?.reasons?.[0] ?? json?.error ?? `The server returned an error (${res.status}).`);
  return json as T;
}

export async function serverGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch(`${apiBaseUrl()}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json().catch(() => null)) as { error?: string; reasons?: string[] } | null;
  if (!res.ok)
    throw new Error(json?.reasons?.[0] ?? json?.error ?? `The server returned an error (${res.status}).`);
  return json as T;
}

export const callsApi = {
  start: (callee: string, mode: CallMode) => rpc<string>("call_start", { p_callee: callee, p_mode: mode }),
  /** Returns the status afterwards: "accepted", "rejected", or "missed"/"cancelled" if it stopped ringing first. */
  answer: (id: string, accept: boolean) => rpc<string>("call_answer", { p_call: id, p_accept: accept }),
  async get(id: string): Promise<CallRecord | null> {
    const { data, error } = await supabase.from("call_sessions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(rtcError(error));
    return (data as CallRecord | null) ?? null;
  },
  async incoming(me: string): Promise<CallRecord | null> {
    const since = new Date(Date.now() - 45_000).toISOString();
    const { data, error } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("callee_id", me)
      .eq("status", "ringing")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(rtcError(error));
    return ((data as CallRecord[] | null) ?? [])[0] ?? null;
  },
  join: (id: string) => serverApi<RoomToken & { mode: CallMode }>(`/calls/${id}/join`),
  end: (id: string) => serverApi<{ ended: boolean }>(`/calls/${id}/end`),
  async names(ids: string[]): Promise<Record<string, string>> {
    const { data } = await supabase.rpc("profiles_by_ids", { ids });
    const out: Record<string, string> = {};
    for (const p of (data as { id: string; display_name: string }[] | null) ?? []) out[p.id] = p.display_name;
    return out;
  },
};

/**
 * Watches for incoming calls: Supabase Realtime when available, plus a short poll so a blocked websocket (some
 * networks) never means a missed call. Returns an unsubscribe function.
 */
export function watchIncoming(me: string, onCall: (c: CallRecord | null) => void, pollMs = 4000): () => void {
  let stopped = false;
  const check = () =>
    callsApi
      .incoming(me)
      .then((c) => !stopped && onCall(c))
      .catch(() => undefined);
  const channel = supabase
    .channel(`calls:${me}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_sessions", filter: `callee_id=eq.${me}` },
      () => void check(),
    )
    .subscribe();
  void check();
  const timer = setInterval(check, pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
    void supabase.removeChannel(channel);
  };
}
