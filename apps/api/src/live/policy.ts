// Pure helpers for live decisions. The database makes the binding decision
// (live_*_check functions); these turn its answers into responses people can
// act on, and read the viewer's country safely.

/** Two-letter country from a trusted proxy header, or null (unknown = fail closed). */
export function viewerCountry(headerValue: string | string[] | undefined): string | null {
  const v = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!v) return null;
  const cc = v.trim().toUpperCase();
  // "XX" / "T1" are what some CDNs send for unknown or Tor traffic.
  if (!/^[A-Z]{2}$/.test(cc) || cc === "XX" || cc === "T1") return null;
  return cc;
}

const MESSAGES: Record<string, string> = {
  stream_not_found: "This stream doesn't exist.",
  not_your_stream: "Only the creator and invited co-performers can broadcast here.",
  only_the_creator_can_start: "Only the creator can start this stream.",
  stream_not_open: "This stream has ended.",
  stream_not_live: "This stream isn't live right now.",
  emergency_stop: "Live streaming is paused for safety. Please try again later.",
  creator_not_approved: "Your creator account isn't approved.",
  agreement_not_accepted: "Accept the current creator agreement first.",
  identity_not_verified: "Identity verification is required.",
  age_not_verified: "Age verification is required.",
  country_not_allowed: "Live streaming isn't available in your country.",
  country_unknown: "We couldn't confirm your country, so this can't be shown.",
  explicit_not_allowed_in_country: "Adult content isn't available in your country.",
  explicit_not_allowed_in_creator_country: "This stream isn't available.",
  category_not_in_application: "This category isn't part of your approved application.",
  provider_not_enabled: "The streaming service for this stream isn't enabled.",
  category_not_permitted_by_provider: "The streaming service doesn't permit this category.",
  country_not_supported_by_provider: "The streaming service doesn't support your country.",
  stream_not_in_country: "This stream isn't available in your country.",
  viewer_age_not_verified: "Verify your age to watch adult content.",
  blocked: "This stream isn't available.",
  session_not_found: "This session doesn't exist.",
  session_not_accepted: "The creator hasn't accepted this session yet.",
  creator_not_verified: "This creator isn't verified.",
  creator_country_not_allowed: "Private sessions aren't available for this creator.",
  account_suspended: "Your account is suspended. You can appeal from your account settings.",
  participant_suspended: "This session isn't available right now.",
  stream_full: "This stream is full right now. Please try again in a moment.",
  call_not_found: "This call doesn't exist.",
  call_not_active: "This call isn't ringing or connected any more.",
  not_matched: "You can only call people you've matched with.",
};

/** Human messages for problem codes, without leaking who blocked whom. */
export function explainProblems(codes: string[]): string[] {
  const out = new Set<string>();
  for (const c of codes) {
    if (c.startsWith("participant_not_verified:"))
      out.add("Every co-performer must be an approved, verified creator.");
    else if (c.startsWith("participant_consent_missing:"))
      out.add("Every co-performer must record their consent for this stream.");
    else out.add(MESSAGES[c] ?? "This isn't allowed right now.");
  }
  return [...out];
}

/** Status code for a refusal: 404 hides streams people shouldn't know about. */
export function refusalStatus(codes: string[]): number {
  if (
    codes.includes("stream_not_found") ||
    codes.includes("session_not_found") ||
    codes.includes("call_not_found") ||
    codes.includes("blocked")
  )
    return 404;
  if (codes.includes("stream_full")) return 503;
  if (codes.includes("explicit_not_allowed_in_creator_country")) return 404;
  if (codes.includes("emergency_stop")) return 503;
  return 403;
}

export const TOKEN_TTL_SECONDS = 600;

export interface HealthFinding {
  streamId: string;
  status: "ok" | "no_broadcaster" | "provider_unreachable" | "provider_missing" | "policy_problem";
  viewers: number | null;
  problems: string[];
}

/** Classifies a live stream's health from provider stats and current policy problems. */
export function classifyHealth(
  streamId: string,
  stats: { participants: number; publishers: number } | null,
  providerAvailable: boolean,
  problems: string[],
): HealthFinding {
  const viewers = stats ? Math.max(0, stats.participants - stats.publishers) : null;
  const relevant = problems.filter((p) => p !== "stream_not_open");
  if (relevant.length > 0) return { streamId, status: "policy_problem", viewers, problems: relevant };
  if (!providerAvailable) return { streamId, status: "provider_missing", viewers, problems: [] };
  if (!stats) return { streamId, status: "provider_unreachable", viewers, problems: [] };
  if (stats.publishers === 0) return { streamId, status: "no_broadcaster", viewers, problems: [] };
  return { streamId, status: "ok", viewers, problems: [] };
}
