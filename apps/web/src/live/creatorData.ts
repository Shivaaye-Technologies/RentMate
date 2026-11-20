import { supabase } from "../supabase";

export interface CreatorRow {
  user_id: string;
  stage_name: string;
  bio: string;
  country_code: string;
  categories: string[];
  status: string;
  agreement_version: string | null;
  agreement_accepted_at: string | null;
  status_reason: string | null;
}

export interface Verification {
  kind: "identity" | "age";
  status: string;
  provider: string;
  checked_at: string;
}

export interface Category {
  key: string;
  label: string;
  explicit: boolean;
}

export interface Agreement {
  version: string;
  title: string;
  document_url: string;
}

export interface StreamRow {
  id: string;
  creator_id: string;
  title: string;
  category: string;
  scheduled_at: string | null;
  status: string;
  participants: string[];
  started_at: string | null;
}

export interface ConsentRow {
  stream_id: string;
  participant_id: string;
  consent_scope: string;
  document_ref: string;
  signed_at: string;
  revoked_at: string | null;
}

export interface AvailabilityRow {
  id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
}

export interface SessionRow {
  id: string;
  viewer_id: string;
  mode: "video" | "audio";
  category: string;
  requested_for: string | null;
  status: string;
  created_at: string;
}

export interface TicketRow {
  id: string;
  subject: string;
  body: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
}

export interface AppealRow {
  id: string;
  statement: string;
  status: string;
  decision_note: string | null;
  created_at: string;
}

export interface CreatorState {
  creator: CreatorRow | null;
  verifications: Verification[];
  categories: Category[];
  agreement: Agreement | null;
  myStreams: StreamRow[];
  invitedStreams: StreamRow[];
  consents: ConsentRow[];
  availability: AvailabilityRow[];
  sessions: SessionRow[];
  tickets: TicketRow[];
  appeals: AppealRow[];
}

/** A list result (missing data = empty list). */
function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
}

/** A single-row result: null stays null (no row), never an empty list. */
function one<T>(r: { data: T | null; error: { message: string } | null }): T | null {
  if (r.error) throw new Error(r.error.message);
  return r.data ?? null;
}

/** Everything the creator studio shows, read with your own permissions (RLS). */
export async function loadCreatorState(me: string): Promise<CreatorState> {
  const [
    creator,
    verifications,
    categories,
    agreement,
    streams,
    consents,
    availability,
    sessions,
    tickets,
    appeals,
  ] = await Promise.all([
    supabase
      .from("creators")
      .select(
        "user_id, stage_name, bio, country_code, categories, status, agreement_version, agreement_accepted_at, status_reason",
      )
      .eq("user_id", me)
      .maybeSingle(),
    supabase
      .from("creator_verifications")
      .select("kind, status, provider, checked_at")
      .eq("user_id", me)
      .order("checked_at", { ascending: false }),
    supabase.from("content_categories").select("key, label, explicit").order("explicit").order("label"),
    supabase
      .from("creator_agreements")
      .select("version, title, document_url")
      .eq("active", true)
      .maybeSingle(),
    supabase
      .from("live_streams")
      .select("id, creator_id, title, category, scheduled_at, status, participants, started_at")
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(200),
    supabase
      .from("performer_consents")
      .select("stream_id, participant_id, consent_scope, document_ref, signed_at, revoked_at"),
    supabase
      .from("creator_availability")
      .select("id, weekday, start_minute, end_minute, timezone")
      .eq("creator_id", me),
    supabase
      .from("private_sessions")
      .select("id, viewer_id, mode, category, requested_for, status, created_at")
      .eq("creator_id", me)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("creator_tickets")
      .select("id, subject, body, status, admin_reply, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("creator_appeals")
      .select("id, statement, status, decision_note, created_at")
      .order("created_at", { ascending: false }),
  ]);
  const all = check(streams) as StreamRow[];
  return {
    creator: one(creator) as CreatorRow | null,
    verifications: check(verifications) as Verification[],
    categories: check(categories) as Category[],
    agreement: one(agreement) as Agreement | null,
    myStreams: all.filter((s) => s.creator_id === me),
    invitedStreams: all.filter((s) => s.creator_id !== me && s.participants.includes(me)),
    consents: check(consents) as ConsentRow[],
    availability: check(availability) as AvailabilityRow[],
    sessions: check(sessions) as SessionRow[],
    tickets: check(tickets) as TicketRow[],
    appeals: check(appeals) as AppealRow[],
  };
}

const ok = (r: { error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
};

/** Latest result for a kind of verification ("none" if never started). */
export function latestVerification(list: Verification[], kind: Verification["kind"]): string {
  return list.find((v) => v.kind === kind)?.status ?? "none";
}

export const creatorApi = {
  apply: async (
    me: string,
    d: { stageName: string; bio: string; countryCode: string; categories: string[] },
  ) =>
    ok(
      await supabase.from("creators").insert({
        user_id: me,
        stage_name: d.stageName.trim(),
        bio: d.bio.trim(),
        country_code: d.countryCode,
        categories: d.categories,
      }),
    ),
  update: async (me: string, d: { stageName: string; bio: string; categories: string[] }) =>
    ok(
      await supabase
        .from("creators")
        .update({ stage_name: d.stageName.trim(), bio: d.bio.trim(), categories: d.categories })
        .eq("user_id", me),
    ),
  acceptAgreement: async (version: string) =>
    ok(await supabase.rpc("live_accept_agreement", { p_version: version })),
  schedule: async (
    me: string,
    d: { title: string; category: string; scheduledAt: string | null; participants: string[] },
  ) =>
    ok(
      await supabase.from("live_streams").insert({
        creator_id: me,
        provider_key: "livekit",
        title: d.title.trim(),
        category: d.category,
        scheduled_at: d.scheduledAt,
        participants: d.participants,
      }),
    ),
  readiness: async (streamId: string): Promise<string[]> => {
    const { data, error } = await supabase.rpc("live_broadcast_check", { p_stream: streamId });
    if (error) throw new Error(error.message);
    return (data as string[] | null) ?? [];
  },
  start: async (streamId: string): Promise<string[]> => {
    const { data, error } = await supabase.rpc("live_start_stream", { p_stream: streamId });
    if (error) throw new Error(error.message);
    return (data as string[] | null) ?? [];
  },
  end: async (streamId: string) => ok(await supabase.rpc("live_end_stream", { p_stream: streamId })),
  giveConsent: async (streamId: string, scope: string, documentRef: string) =>
    ok(
      await supabase.rpc("live_give_consent", {
        p_stream: streamId,
        p_scope: scope,
        p_document_ref: documentRef,
      }),
    ),
  revokeConsent: async (streamId: string) =>
    ok(await supabase.rpc("live_revoke_consent", { p_stream: streamId })),
  addAvailability: async (me: string, weekday: number, start: number, end: number, timezone: string) =>
    ok(
      await supabase
        .from("creator_availability")
        .insert({ creator_id: me, weekday, start_minute: start, end_minute: end, timezone }),
    ),
  removeAvailability: async (id: string) =>
    ok(await supabase.from("creator_availability").delete().eq("id", id)),
  answerSession: async (id: string, accept: boolean) =>
    ok(await supabase.rpc("live_answer_session", { p_session: id, p_accept: accept })),
  endSession: async (id: string) => ok(await supabase.rpc("live_end_session", { p_session: id })),
  openTicket: async (me: string, subject: string, body: string) =>
    ok(
      await supabase
        .from("creator_tickets")
        .insert({ creator_id: me, subject: subject.trim(), body: body.trim() }),
    ),
  appeal: async (me: string, statement: string) =>
    ok(await supabase.from("creator_appeals").insert({ creator_id: me, statement: statement.trim() })),
  approvedCreators: async (): Promise<{ user_id: string; stage_name: string }[]> => {
    const { data, error } = await supabase
      .from("creators")
      .select("user_id, stage_name")
      .eq("status", "approved")
      .order("stage_name")
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as { user_id: string; stage_name: string }[];
  },
};
