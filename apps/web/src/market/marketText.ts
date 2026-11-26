// Pure helpers and wording for the RentMate companionship marketplace (unit-tested).

export const BOOKING_STATUS: Record<string, string> = {
  requested: "Requested",
  pending: "Being considered",
  accepted: "Accepted",
  rejected: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
  disputed: "Disputed",
};

export const COMPANION_STATUS: Record<string, string> = {
  pending: "Waiting for approval",
  approved: "Approved and visible",
  rejected: "Not approved",
  suspended: "Suspended",
  paused: "Paused (hidden from search)",
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const MARKET_RULES =
  "RentMate companionship is non-sexual: public places and approved activities only. Escorting, sexual services and sexual solicitation are prohibited and lead to removal.";

/**
 * 1,50,000 — Indian digit grouping (last three digits, then pairs). Done by hand because runtimes built without
 * full ICU data (small-icu Node builds, some Android JS engines) ignore "en-IN" and print 150,000.
 */
export function formatIndianNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n);
  const digits = String(Math.abs(rounded));
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (rounded < 0 ? "-" : "") + (rest ? `${rest},${last3}` : last3);
}

/** ₹1,600 */
export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `₹${formatIndianNumber(n)}`;
}

/** Mirrors private.booking_price; the server always computes the real price. */
export function priceEstimate(pricing: "hourly" | "session", price: number, minutes: number): number {
  return pricing === "session" ? price : Math.ceil((price * minutes) / 60);
}

/** Mirrors private.looks_like_address so people see the problem before sending. */
export function looksLikeAddress(text: string): boolean {
  return /(\b(flat|house|h\.? ?no|plot|apt|apartment|room no|floor|pin ?code|pincode)\b|\b\d{6}\b|#\s*\d)/i.test(
    text,
  );
}

export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "18:30" -> 1110; null when invalid. 24:00 allowed as an end time. */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export function fromMinutes(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

export interface CompanionDraft {
  headline: string;
  about: string;
  city: string;
  area: string;
  languages: string;
  interests: string;
}

export function splitList(text: string, max: number): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ].slice(0, max);
}

/** Mirrors the companion_profiles checks. */
export function validateCompanion(d: CompanionDraft): Partial<Record<keyof CompanionDraft, string>> {
  const e: Partial<Record<keyof CompanionDraft, string>> = {};
  const h = d.headline.trim();
  if (h.length < 5 || h.length > 80) e.headline = "Use 5 to 80 characters.";
  if (d.about.length > 1500) e.about = "Keep it under 1,500 characters.";
  const c = d.city.trim();
  if (c.length < 2 || c.length > 60) e.city = "Enter your city.";
  if (d.area.length > 80) e.area = "Keep it short (a neighbourhood).";
  else if (looksLikeAddress(d.area)) e.area = "Name a neighbourhood only — never a home address or PIN code.";
  if (splitList(d.languages, 99).length > 8) e.languages = "Up to 8 languages.";
  if (splitList(d.interests, 99).length > 12) e.interests = "Up to 12 interests.";
  return e;
}

export interface ServiceDraft {
  category: string;
  title: string;
  description: string;
  pricing: "hourly" | "session";
  price: string;
  minMinutes: string;
  maxMinutes: string;
}

/** Mirrors the companion_services checks. */
export function validateService(d: ServiceDraft): Partial<Record<keyof ServiceDraft, string>> {
  const e: Partial<Record<keyof ServiceDraft, string>> = {};
  if (!d.category) e.category = "Choose an activity.";
  const t = d.title.trim();
  if (t.length < 3 || t.length > 80) e.title = "Use 3 to 80 characters.";
  if (d.description.length > 800) e.description = "Keep it under 800 characters.";
  const p = Number(d.price);
  if (!Number.isInteger(p) || p < 100 || p > 100000) e.price = "Enter a whole amount from ₹100 to ₹1,00,000.";
  const min = Number(d.minMinutes);
  const max = Number(d.maxMinutes);
  if (!Number.isInteger(min) || min < 30 || min > 480) e.minMinutes = "30 to 480 minutes.";
  if (!Number.isInteger(max) || max < min || max > 720)
    e.maxMinutes = "At least the minimum, up to 720 minutes.";
  return e;
}

/** Checks a booking request before it is sent (the server checks everything again). */
export function bookingProblem(
  startLocal: string,
  minutes: number,
  meetingPoint: string,
  limits: { minMinutes: number; maxMinutes: number; minNoticeHours: number },
  now = Date.now(),
): string | null {
  if (!startLocal) return "Choose a date and time.";
  const t = Date.parse(startLocal);
  if (!Number.isFinite(t)) return "Choose a valid date and time.";
  if (t < now + limits.minNoticeHours * 3600_000)
    return `Bookings need at least ${limits.minNoticeHours} hours notice.`;
  if (minutes < limits.minMinutes || minutes > limits.maxMinutes) {
    return `Choose between ${minutesLabel(limits.minMinutes)} and ${minutesLabel(limits.maxMinutes)}.`;
  }
  const mp = meetingPoint.trim();
  if (mp.length < 3) return "Name a public meeting place (a cafe, restaurant or venue).";
  if (looksLikeAddress(mp)) return "Meeting points must be public places — never a home address.";
  return null;
}

/** What each side may do with a booking right now (the server enforces the same rules). */
export function bookingActions(
  b: {
    status: string;
    starts_at: string;
    ends_at: string;
    member_id: string | null;
    companion_id: string | null;
  },
  me: string,
  now = Date.now(),
): { respond: boolean; cancel: boolean; complete: boolean; dispute: boolean } {
  const isCompanion = b.companion_id === me;
  const started = Date.parse(b.starts_at) <= now;
  const ended = Date.parse(b.ends_at) <= now;
  return {
    respond: isCompanion && (b.status === "requested" || b.status === "pending") && !started,
    cancel: ["requested", "pending", "accepted"].includes(b.status) && !started,
    complete: b.status === "accepted" && ended,
    dispute: b.status === "accepted" && started,
  };
}

/** Friendly wording for database refusals (keeps the server's own explanation where it wrote one). */
export function marketError(e: { code?: string; message?: string }): string {
  const m = e.message ?? "";
  if (/RentMate does not allow/i.test(m)) {
    return "RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.";
  }
  if (e.code === "42501" && /row-level security/i.test(m)) return "You can't do that.";
  if (e.code === "23514" && /not_an_address|meeting_point_public/i.test(m)) {
    return "Use a neighbourhood or a public place — never a home address or PIN code.";
  }
  if (e.code === "23514") return "One of the values isn't allowed. Check the form and try again.";
  if (e.code === "23505") return "That already exists.";
  if (/does not exist|schema cache/i.test(m)) return "The RentMate marketplace isn't switched on yet.";
  return m || "Something went wrong. Please try again.";
}
