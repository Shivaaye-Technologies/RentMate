/**
 * Booking rules the Android screens use for display and button choice. The server decides everything that matters
 * (price, holds, refunds, settlement, who may do what); these helpers only avoid offering actions it would refuse.
 */
export type BookingStatus =
  "requested" | "pending" | "accepted" | "rejected" | "cancelled" | "completed" | "disputed" | "expired";

export type Booking = {
  id: string;
  reference: string;
  member_id: string | null;
  companion_id: string | null;
  service_title: string;
  starts_at: string;
  ends_at: string;
  meeting_point: string;
  status: BookingStatus;
  checked_in_at?: string | null;
};

export type BookingAction = "accept" | "reject" | "cancel" | "complete" | "dispute";

const OPEN: BookingStatus[] = ["requested", "pending"];

export function roleIn(b: Booking, me: string): "member" | "companion" | null {
  if (b.member_id === me) return "member";
  if (b.companion_id === me) return "companion";
  return null;
}

/** Actions the server would accept now, for this person. */
export function allowedActions(b: Booking, me: string, now = new Date()): BookingAction[] {
  const role = roleIn(b, me);
  if (!role) return [];
  const started = new Date(b.starts_at) <= now;
  const ended = new Date(b.ends_at) <= now;
  const out: BookingAction[] = [];
  if (role === "companion" && OPEN.includes(b.status) && !started) out.push("accept", "reject");
  if (OPEN.includes(b.status) || (b.status === "accepted" && !started)) out.push("cancel");
  if (b.status === "accepted" && ended) out.push("complete");
  if (b.status === "accepted" && started) out.push("dispute");
  return out;
}

/** Check-in opens 30 minutes before the start and closes at the end (mirrors private.checkin_window_open). */
export const CHECKIN_OPENS_MINUTES = 30;

export type CheckInStep = "show_code" | "enter_code" | "checked_in" | "not_yet" | null;

/**
 * What the check-in card shows. The member shows a one-time code; the companion types it in. Outside the window,
 * or for anything but an accepted booking, there is nothing to do (null), except a reminder shortly before.
 */
export function checkInStep(b: Booking, me: string, now = new Date()): CheckInStep {
  const role = roleIn(b, me);
  if (!role || b.status !== "accepted") return b.checked_in_at && role ? "checked_in" : null;
  if (b.checked_in_at) return "checked_in";
  const opens = new Date(b.starts_at).getTime() - CHECKIN_OPENS_MINUTES * 60_000;
  const closes = new Date(b.ends_at).getTime();
  const t = now.getTime();
  if (t > closes) return null;
  if (t < opens) return "not_yet";
  return role === "member" ? "show_code" : "enter_code";
}

/** Six digits, spaces and dashes ignored. Returns null if it cannot be a code. */
export function normaliseCheckInCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^[0-9]{6}$/.test(digits) ? digits : null;
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  requested: "Waiting for the companion",
  pending: "Seen by the companion",
  accepted: "Accepted",
  rejected: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  disputed: "Under review",
  expired: "Expired (no answer in time)",
};

export const HOLD_LABEL: Record<string, string> = {
  held: "Tokens reserved for this booking",
  frozen: "Tokens frozen while RentMate reviews this booking",
  released: "Tokens returned to your wallet",
  settled: "Tokens used for this completed booking",
};

/** Wallet ledger reasons in plain words. Tokens are app units only, never cash. */
export const LEDGER_LABEL: Record<string, string> = {
  registration_bonus: "Welcome bonus",
  booking_hold: "Reserved for a booking",
  booking_refund: "Returned from a booking",
  sandbox_grant: "Test tokens (sandbox)",
  voice_call: "Voice call",
  video_call: "Video call",
  like: "Like",
  message: "Message",
  admin_adjustment: "Adjustment by RentMate",
  refund: "Refund",
};

/**
 * One key per booking attempt. The screen creates it once and reuses it for every retry of that attempt, so a retry
 * after an uncertain network answer returns the same booking instead of reserving tokens twice.
 */
export function newRequestKey(random: () => number = Math.random, now: () => number = Date.now): string {
  const r = Array.from({ length: 4 }, () =>
    Math.floor(random() * 0x10000)
      .toString(16)
      .padStart(4, "0"),
  ).join("");
  return `rm-${now().toString(36)}-${r}`;
}

/** Duration choices in 30-minute steps within the service's limits. */
export function durationOptions(min: number, max: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(min / 30) * 30; m <= max; m += 30) out.push(m);
  return out.length ? out : [min];
}

/** Start times on the hour, from tomorrow, for `days` days between `firstHour` and `lastHour` (device time). */
export function startOptions(now: Date, days = 7, firstHour = 9, lastHour = 20): Date[] {
  const out: Date[] = [];
  for (let d = 1; d <= days; d++) {
    for (let h = firstHour; h <= lastHour; h++) {
      const t = new Date(now);
      t.setDate(now.getDate() + d);
      t.setHours(h, 0, 0, 0);
      out.push(t);
    }
  }
  return out;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "Time unavailable"
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** Turns a database error into a message for the member (server messages are already written for people). */
export function bookingErrorMessage(e: unknown): string {
  const m = (e as { message?: string } | null)?.message ?? "";
  if (/fetch|network|timeout/i.test(m)) return "No connection. Your request was not confirmed; try again.";
  if (m && m.length < 200 && !/syntax|relation|column|function .* does not exist/i.test(m)) return m;
  return "Something went wrong. Please try again.";
}
