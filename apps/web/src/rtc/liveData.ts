import { supabase } from "../supabase";
import { rtcError, serverApi, serverGet, type RoomToken } from "./rtcData";

export interface StreamListing {
  id: string;
  stageName: string;
  title: string;
  category: string;
  status: string;
  startedAt: string | null;
  scheduledAt: string | null;
}

export interface StreamInfo {
  id: string;
  title: string;
  category: string;
  status: string;
  creator_id: string;
  participants: string[];
}

export interface ChatMessage {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  hidden_at: string | null;
}

export interface GuestInvite {
  id: string;
  stream_id: string;
  guest_id: string;
  status: string;
}

export const REACTIONS = [
  { kind: "heart", label: "♥", name: "Love it" },
  { kind: "clap", label: "👏", name: "Applause" },
  { kind: "laugh", label: "😄", name: "Funny" },
  { kind: "wow", label: "😮", name: "Wow" },
  { kind: "fire", label: "🔥", name: "Fire" },
] as const;

/** Reasons a viewer can report a live stream for (a subset of the database's live_reports reasons). */
export const LIVE_REPORT_REASONS = [
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate speech"],
  ["violence", "Violence or threats"],
  ["sexual_content", "Sexual content"], // policy-guard: allow (report reason for prohibited content)
  ["sexual_solicitation", "Offering or asking for sexual services"], // policy-guard: allow (report reason for prohibited content)
  ["minor", "Someone under 18"],
  ["spam_or_scam", "Spam or scam"],
  ["other", "Something else"],
] as const;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(rtcError(error));
  return data as T;
}

export const liveApi = {
  list: () => serverGet<{ streams: StreamListing[] }>("/live/streams").then((r) => r.streams),
  async stream(id: string): Promise<StreamInfo | null> {
    const { data, error } = await supabase
      .from("live_streams")
      .select("id,title,category,status,creator_id,participants")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(rtcError(error));
    return (data as StreamInfo | null) ?? null;
  },
  join: (id: string, as: "viewer" | "broadcaster") =>
    serverApi<RoomToken & { canPublish: boolean }>(`/live/streams/${id}/join`, { as }),
  stats: (id: string) => serverGet<{ status: string; viewers: number | null }>(`/live/streams/${id}/stats`),
  start: (id: string) => rpc<string[]>("live_start_stream", { p_stream: id }),
  end: (id: string) => serverApi<{ ended: boolean }>(`/live/streams/${id}/end`),
  // Chat and reactions: the database checks who may read and post (RLS), screens text and limits the rate.
  async chat(id: string): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from("live_chat_messages")
      .select("id,sender_id,body,created_at,hidden_at")
      .eq("stream_id", id)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) throw new Error(rtcError(error));
    return ((data as ChatMessage[] | null) ?? []).reverse();
  },
  async send(id: string, me: string, body: string) {
    const { error } = await supabase
      .from("live_chat_messages")
      .insert({ stream_id: id, sender_id: me, body });
    if (error) throw new Error(rtcError(error));
  },
  react: (id: string, kind: string) => rpc<void>("live_react", { p_stream: id, p_kind: kind }),
  async recentReactions(id: string, sinceIso: string): Promise<{ id: number; kind: string }[]> {
    const { data } = await supabase
      .from("live_reactions")
      .select("id,kind")
      .eq("stream_id", id)
      .gt("created_at", sinceIso)
      .order("id");
    return (data as { id: number; kind: string }[] | null) ?? [];
  },
  hide: (messageId: string) => rpc<void>("live_chat_hide", { p_message: messageId }),
  mute: (id: string, user: string, minutes: number) =>
    rpc<void>("live_chat_mute", { p_stream: id, p_user: user, p_minutes: minutes }),
  async report(id: string, creatorId: string, me: string, reason: string, details: string) {
    const { error } = await supabase
      .from("live_reports")
      .insert({ stream_id: id, creator_id: creatorId, reporter_id: me, reason, details });
    if (error) throw new Error(rtcError(error));
  },
  async block(me: string, other: string) {
    const { error } = await supabase.from("blocks").insert({ blocker_id: me, blocked_id: other });
    if (error && error.code !== "23505") throw new Error(rtcError(error));
  },
  // Guests
  async invites(id: string): Promise<GuestInvite[]> {
    const { data, error } = await supabase
      .from("live_guest_invites")
      .select("id,stream_id,guest_id,status")
      .eq("stream_id", id);
    if (error) throw new Error(rtcError(error));
    return (data as GuestInvite[] | null) ?? [];
  },
  async myInvites(me: string): Promise<GuestInvite[]> {
    const { data, error } = await supabase
      .from("live_guest_invites")
      .select("id,stream_id,guest_id,status")
      .eq("guest_id", me)
      .eq("status", "invited");
    if (error) throw new Error(rtcError(error));
    return (data as GuestInvite[] | null) ?? [];
  },
  async findCreators(q: string): Promise<{ user_id: string; stage_name: string }[]> {
    const { data, error } = await supabase
      .from("creators")
      .select("user_id,stage_name")
      .eq("status", "approved")
      .ilike("stage_name", `%${q.replace(/[%_]/g, "")}%`)
      .limit(8);
    if (error) throw new Error(rtcError(error));
    return (data as { user_id: string; stage_name: string }[] | null) ?? [];
  },
  invite: (id: string, guest: string) => rpc<string>("live_invite_guest", { p_stream: id, p_guest: guest }),
  async acceptInvite(invite: GuestInvite) {
    await rpc<void>("live_answer_guest_invite", { p_invite: invite.id, p_accept: true });
    // Consent is recorded per stream, after joining it as a co-host. No recording happens on RentMate.
    await rpc<void>("live_give_consent", {
      p_stream: invite.stream_id,
      p_scope: "Appear live on this stream as a guest. No recording.",
      p_document_ref: "in-app-consent",
    });
  },
  declineInvite: (invite: GuestInvite) =>
    rpc<void>("live_answer_guest_invite", { p_invite: invite.id, p_accept: false }),
  muteGuest: (id: string, guest: string, kind: "audio" | "video") =>
    serverApi<{ muted: number }>(`/live/streams/${id}/guests/${guest}/mute`, { kind }),
  removeGuest: (id: string, guest: string) =>
    serverApi<{ removed: boolean }>(`/live/streams/${id}/guests/${guest}/remove`),
  async stageNames(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const { data } = await supabase.from("creators").select("user_id,stage_name").in("user_id", ids);
    const out: Record<string, string> = {};
    for (const c of (data as { user_id: string; stage_name: string }[] | null) ?? [])
      out[c.user_id] = c.stage_name;
    return out;
  },
};
