import { supabase } from "../supabase";
import { marketError } from "./marketText";

export interface Category {
  key: string;
  label: string;
  description: string;
}

export interface CompanionCard {
  user_id: string;
  display_name: string;
  photo_path: string | null;
  headline: string;
  city: string;
  area: string;
  languages: string[];
  interests: string[];
  verified: boolean;
  min_price_inr: number;
  categories: string[];
  rating: number | null;
  review_count: number;
}

export interface CompanionProfile {
  user_id: string;
  headline: string;
  about: string;
  city: string;
  area: string;
  languages: string[];
  interests: string[];
  status: string;
  verified: boolean;
  status_reason: string | null;
}

export interface Service {
  id: string;
  companion_id: string;
  category: string;
  title: string;
  description: string;
  pricing: "hourly" | "session";
  price_inr: number;
  min_minutes: number;
  max_minutes: number;
  active: boolean;
}

export interface Availability {
  id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  timezone: string;
}

export interface Booking {
  id: string;
  reference: string;
  member_id: string | null;
  companion_id: string | null;
  service_title: string;
  category: string;
  pricing: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  timezone: string;
  price_inr: number;
  commission_pct: number;
  meeting_point: string;
  note: string;
  status: string;
  cancellation_policy: string;
  late_cancellation: boolean;
  payment_status: string;
  created_at: string;
}

export interface Review {
  id: string;
  booking_id: string | null;
  reviewer_id: string | null;
  companion_id: string;
  rating: number;
  comment: string;
  status: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  member_id: string;
  companion_id: string;
  last_message_at: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Settings {
  commission_pct: number;
  payments_enabled: boolean;
  min_notice_hours: number;
  max_advance_days: number;
  free_cancel_hours: number;
}

type Result<T> = { data: T | null; error: { code?: string; message: string } | null };

function list<T>(r: Result<T[]>): T[] {
  if (r.error) throw new Error(marketError(r.error));
  return r.data ?? [];
}
function one<T>(r: Result<T>): T | null {
  if (r.error) throw new Error(marketError(r.error));
  return r.data ?? null;
}
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(marketError(error));
  return data as T;
}
function ok(r: { error: { code?: string; message: string } | null }) {
  if (r.error) throw new Error(marketError(r.error));
}

export interface SearchFilters {
  city: string;
  category: string;
  maxPrice: string;
  language: string;
  interest: string;
  verifiedOnly: boolean;
  minRating: string;
  onDate: string;
}

export const EMPTY_FILTERS: SearchFilters = {
  city: "",
  category: "",
  maxPrice: "",
  language: "",
  interest: "",
  verifiedOnly: false,
  minRating: "",
  onDate: "",
};

/** Names for a set of user ids (RLS hides blocked people). */
export async function namesFor(ids: (string | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  const rows = list(
    (await supabase.from("profiles").select("id, display_name").in("id", unique)) as Result<
      { id: string; display_name: string }[]
    >,
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.display_name]));
}

export const marketApi = {
  settings: async () =>
    one(
      (await supabase
        .from("platform_settings")
        .select("commission_pct, payments_enabled, min_notice_hours, max_advance_days, free_cancel_hours")
        .single()) as Result<Settings>,
    ),
  categories: async () =>
    list(
      (await supabase
        .from("activity_categories")
        .select("key, label, description")
        .eq("active", true)
        .order("sort")) as Result<Category[]>,
    ),
  search: (f: SearchFilters) =>
    rpc<CompanionCard[]>("companions_search", {
      p_city: f.city.trim() || null,
      p_category: f.category || null,
      p_max_price: f.maxPrice ? Number(f.maxPrice) : null,
      p_language: f.language.trim() || null,
      p_interest: f.interest.trim() || null,
      p_verified_only: f.verifiedOnly,
      p_min_rating: f.minRating ? Number(f.minRating) : null,
      p_on_date: f.onDate || null,
      p_limit: 50,
      p_offset: 0,
    }),
  companion: async (id: string) =>
    one(
      (await supabase
        .from("companion_profiles")
        .select("user_id, headline, about, city, area, languages, interests, status, verified, status_reason")
        .eq("user_id", id)
        .maybeSingle()) as Result<CompanionProfile>,
    ),
  services: async (companion: string, activeOnly = true) => {
    let q = supabase
      .from("companion_services")
      .select(
        "id, companion_id, category, title, description, pricing, price_inr, min_minutes, max_minutes, active",
      )
      .eq("companion_id", companion)
      .order("price_inr");
    if (activeOnly) q = q.eq("active", true);
    return list((await q) as Result<Service[]>);
  },
  availability: async (companion: string) =>
    list(
      (await supabase
        .from("companion_availability")
        .select("id, weekday, start_minute, end_minute, timezone")
        .eq("companion_id", companion)
        .order("weekday")
        .order("start_minute")) as Result<Availability[]>,
    ),
  rating: async (companion: string) => {
    const rows = await rpc<{ rating: number | null; review_count: number }[]>("companion_rating", {
      p_companion: companion,
    });
    return rows[0] ?? { rating: null, review_count: 0 };
  },
  reviewsFor: async (companion: string) =>
    list(
      (await supabase
        .from("reviews")
        .select("id, booking_id, reviewer_id, companion_id, rating, comment, status, created_at")
        .eq("companion_id", companion)
        .eq("status", "visible")
        .order("created_at", { ascending: false })
        .limit(50)) as Result<Review[]>,
    ),
  shortlist: async (me: string) =>
    list(
      (await supabase.from("shortlists").select("companion_id").eq("member_id", me)) as Result<
        { companion_id: string }[]
      >,
    ).map((r) => r.companion_id),
  addShortlist: async (me: string, companion: string) =>
    ok(await supabase.from("shortlists").insert({ member_id: me, companion_id: companion })),
  removeShortlist: async (me: string, companion: string) =>
    ok(await supabase.from("shortlists").delete().eq("member_id", me).eq("companion_id", companion)),
  requestBooking: (a: {
    service: string;
    startsAt: string;
    minutes: number;
    meetingPoint: string;
    note: string;
    key: string;
  }) =>
    rpc<string>("booking_request", {
      p_service: a.service,
      p_starts_at: a.startsAt,
      p_minutes: a.minutes,
      p_meeting_point: a.meetingPoint.trim(),
      p_note: a.note.trim(),
      p_idempotency_key: a.key,
    }),
  myBookings: async () =>
    list(
      (await supabase
        .from("bookings")
        .select(
          "id, reference, member_id, companion_id, service_title, category, pricing, starts_at, ends_at, duration_minutes, timezone, price_inr, commission_pct, meeting_point, note, status, cancellation_policy, late_cancellation, payment_status, created_at",
        )
        .order("starts_at", { ascending: false })
        .limit(300)) as Result<Booking[]>,
    ),
  respond: (id: string, action: "pending" | "accept" | "reject", note?: string) =>
    rpc<void>("booking_respond", { p_booking: id, p_action: action, p_note: note ?? null }),
  cancel: (id: string, reason: string) =>
    rpc<void>("booking_cancel", { p_booking: id, p_reason: reason || null }),
  complete: (id: string) => rpc<void>("booking_complete", { p_booking: id }),
  dispute: (id: string, reason: string) => rpc<void>("booking_dispute", { p_booking: id, p_reason: reason }),
  review: (booking: string, rating: number, comment: string) =>
    rpc<string>("review_create", { p_booking: booking, p_rating: rating, p_comment: comment }),
  myReviews: async (me: string) =>
    list(
      (await supabase
        .from("reviews")
        .select("id, booking_id, reviewer_id, companion_id, rating, comment, status, created_at")
        .or(`reviewer_id.eq.${me},companion_id.eq.${me}`)) as Result<Review[]>,
    ),
  openConversation: (companion: string) => rpc<string>("conversation_open", { p_companion: companion }),
  conversations: async () =>
    list(
      (await supabase
        .from("conversations")
        .select("id, member_id, companion_id, last_message_at")
        .order("last_message_at", { ascending: false, nullsFirst: false })) as Result<Conversation[]>,
    ),
  messages: async (conversation: string) =>
    list(
      (await supabase
        .from("conversation_messages")
        .select("id, conversation_id, sender_id, body, created_at, read_at")
        .eq("conversation_id", conversation)
        .order("created_at")
        .limit(500)) as Result<ChatMessage[]>,
    ),
  unread: async (me: string) => {
    const rows = list(
      (await supabase
        .from("conversation_messages")
        .select("conversation_id")
        .is("read_at", null)
        .neq("sender_id", me)) as Result<{ conversation_id: string }[]>,
    );
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.conversation_id] = (counts[r.conversation_id] ?? 0) + 1;
    return counts;
  },
  send: async (conversation: string, me: string, body: string) =>
    ok(
      await supabase
        .from("conversation_messages")
        .insert({ conversation_id: conversation, sender_id: me, body }),
    ),
  markRead: (conversation: string) => rpc<void>("conversation_mark_read", { p_conversation: conversation }),
  notifications: async () =>
    list(
      (await supabase
        .from("notifications")
        .select("id, kind, title, body, booking_id, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100)) as Result<
        {
          id: string;
          kind: string;
          title: string;
          body: string;
          booking_id: string | null;
          read_at: string | null;
          created_at: string;
        }[]
      >,
    ),
  markNotificationsRead: async (me: string) =>
    ok(
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", me)
        .is("read_at", null),
    ),
  suspension: async (me: string) =>
    one(
      (await supabase
        .from("account_suspensions")
        .select("id, reason, created_at")
        .eq("user_id", me)
        .is("lifted_at", null)
        .maybeSingle()) as Result<{ id: string; reason: string; created_at: string }>,
    ),
  appeal: (statement: string) => rpc<string>("appeal_suspension", { p_statement: statement }),

  // Companion side
  applyCompanion: async (
    me: string,
    d: Omit<CompanionProfile, "user_id" | "status" | "verified" | "status_reason">,
  ) => ok(await supabase.from("companion_profiles").insert({ user_id: me, ...d })),
  updateCompanion: async (
    me: string,
    d: Omit<CompanionProfile, "user_id" | "status" | "verified" | "status_reason">,
  ) => ok(await supabase.from("companion_profiles").update(d).eq("user_id", me)),
  setPaused: (paused: boolean) => rpc<void>("companion_set_paused", { p_paused: paused }),
  addService: async (me: string, s: Omit<Service, "id" | "companion_id">) =>
    ok(await supabase.from("companion_services").insert({ companion_id: me, ...s })),
  setServiceActive: async (id: string, active: boolean) =>
    ok(await supabase.from("companion_services").update({ active }).eq("id", id)),
  addAvailability: async (me: string, weekday: number, start: number, end: number, timezone: string) =>
    ok(
      await supabase
        .from("companion_availability")
        .insert({ companion_id: me, weekday, start_minute: start, end_minute: end, timezone }),
    ),
  removeAvailability: async (id: string) =>
    ok(await supabase.from("companion_availability").delete().eq("id", id)),
  earnings: async () => {
    const rows = await rpc<
      {
        completed_bookings: number;
        booked_value_inr: number;
        commission_inr: number;
        estimated_earnings_inr: number;
      }[]
    >("companion_earnings");
    return (
      rows[0] ?? { completed_bookings: 0, booked_value_inr: 0, commission_inr: 0, estimated_earnings_inr: 0 }
    );
  },
};

/** A random key so a double tap on "Send request" never creates two bookings. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  return `req-${c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
