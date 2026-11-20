// Plain-language text and small pure helpers for RentMate Live screens.

const PROBLEMS: Record<string, string> = {
  stream_not_found: "This stream doesn't exist.",
  not_your_stream: "Only the creator and invited co-performers can broadcast here.",
  only_the_creator_can_start: "Only the creator can start this stream.",
  stream_not_open: "This stream has ended.",
  stream_not_live: "This stream isn't live yet.",
  emergency_stop: "Live streaming is paused for safety right now.",
  creator_not_approved: "Your creator account isn't approved yet.",
  agreement_not_accepted: "Accept the current creator agreement.",
  identity_not_verified: "Complete identity verification.",
  age_not_verified: "Complete age verification.",
  country_not_allowed: "Live streaming isn't available in your country yet.",
  country_unknown: "We couldn't confirm your country.",
  explicit_not_allowed_in_country: "RentMate does not support adult content.",
  explicit_not_allowed_in_creator_country: "RentMate does not support adult content.",
  category_not_in_application: "This category isn't part of your approved application.",
  provider_not_enabled: "The streaming service isn't enabled yet.",
  category_not_permitted_by_provider: "The streaming service doesn't permit this category.",
  country_not_supported_by_provider: "The streaming service doesn't support your country.",
  viewer_age_not_verified: "Age verification is required.",
  blocked: "This isn't available.",
  session_not_found: "This session doesn't exist.",
  session_not_accepted: "The creator hasn't accepted this session yet.",
  creator_not_verified: "This creator isn't verified.",
  creator_country_not_allowed: "Private sessions aren't available for this creator.",
};

/** Turns database problem codes into a short list of things to fix. */
export function explainProblems(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    if (c.startsWith("participant_not_verified:"))
      out.add("Every co-performer must be an approved, verified creator.");
    else if (c.startsWith("participant_consent_missing:")) {
      out.add("Every co-performer must record their own consent for this stream.");
    } else out.add(PROBLEMS[c] ?? "This isn't allowed right now.");
  }
  return [...out];
}

export const CREATOR_STATUS: Record<string, string> = {
  applied: "Application received",
  verifying: "Verification in progress",
  approved: "Approved",
  rejected: "Not approved",
  suspended: "Suspended",
};

export const STREAM_STATUS: Record<string, string> = {
  scheduled: "Scheduled",
  live: "Live",
  ended: "Ended",
  terminated: "Ended by moderators",
  cancelled: "Cancelled",
};

/** Countries offered in the application form (verification confirms the real one). */
export const COUNTRIES: readonly { code: string; name: string }[] = [
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "AU", name: "Australia" },
  { code: "BD", name: "Bangladesh" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
  { code: "LK", name: "Sri Lanka" },
  { code: "NL", name: "Netherlands" },
  { code: "NP", name: "Nepal" },
  { code: "SG", name: "Singapore" },
  { code: "US", name: "United States" },
];

export interface CreatorDraft {
  stageName: string;
  bio: string;
  countryCode: string;
  categories: string[];
}

export type CreatorErrors = Partial<Record<keyof CreatorDraft, string>>;

/** Mirrors the database checks on public.creators. */
export function validateCreator(d: CreatorDraft): CreatorErrors {
  const e: CreatorErrors = {};
  const name = d.stageName.trim();
  if (name.length < 2 || name.length > 40) e.stageName = "Use 2 to 40 characters.";
  if (d.bio.length > 500) e.bio = "Keep it under 500 characters.";
  if (!/^[A-Z]{2}$/.test(d.countryCode)) e.countryCode = "Choose your country.";
  if (d.categories.length === 0) e.categories = "Choose at least one category.";
  return e;
}

/** RentMate does not support adult or sexually explicit content in any country. */
export const NO_ADULT_CONTENT = "RentMate does not support adult, pornographic or sexually explicit content.";

/** Adult categories are never offered, in any country. */
export function categoryAllowedFor(_country: string, explicit: boolean): boolean {
  return !explicit;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** "18:30" -> 1110 minutes; null when invalid. */
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

/** A scheduled time must be in the future (with a minute of slack). */
export function scheduleProblem(local: string, now = Date.now()): string | null {
  if (!local) return null;
  const t = Date.parse(local);
  if (!Number.isFinite(t)) return "Choose a valid date and time.";
  if (t < now - 60_000) return "Choose a time in the future.";
  return null;
}
