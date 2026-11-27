/** The Discover feed (GET /api/v1/matches), shared by Home, Vibes and Map. */
import { API_ROUTES } from "./api";
import { authedApiRequest, supabaseSessionAuth } from "./authedApi";
import { dbFailure, record } from "./diagnostics";
import { personFromApi, rememberPeople, type Person } from "./people";
import { apiBaseUrl, supabase } from "./supabase";

/**
 * Throws on every failure (offline, signed out, server auth problem): an error is never shown as "no one nearby".
 * An empty array means the server really found no eligible profiles.
 */
export async function loadFeed(): Promise<Person[]> {
  if (!supabase || !apiBaseUrl) throw new Error("App configuration is missing.");
  const body = await authedApiRequest<{ matches?: unknown }>(supabaseSessionAuth(supabase.auth), {
    base: apiBaseUrl,
    method: "GET",
    path: API_ROUTES.matches,
  });
  const people = (Array.isArray(body?.matches) ? body.matches : []).map((m) =>
    personFromApi(m as Record<string, unknown>),
  );
  record("feed", "loaded", { count: people.length });
  rememberPeople(people);
  return people;
}

/** Like, special like or pass. Database rules (blocks, the daily special-like limit, 18+) still apply. */
export async function react(person: Person, kind: "like" | "super" | "pass"): Promise<void> {
  if (!supabase) throw new Error("App configuration is missing.");
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id;
  if (!me) throw new Error("Please sign in again.");
  const result =
    kind === "pass"
      ? await supabase.from("passes").insert({ passer_id: me, passed_id: person.id })
      : await supabase
          .from("likes")
          .insert({ liker_id: me, liked_id: person.id, is_super: kind === "super", message: null });
  if (result.error) {
    dbFailure(kind === "pass" ? "passes" : "likes", result.error);
    if (/super/i.test(result.error.message))
      throw new Error("You've used today's special like. Try again tomorrow.");
    throw new Error("That action could not be saved. Please try again.");
  }
}

let stale = false;
/** Preferences changed: Home reloads the next time it is shown. */
export const markFeedStale = () => {
  stale = true;
};
export const takeFeedStale = () => {
  const was = stale;
  stale = false;
  return was;
};
