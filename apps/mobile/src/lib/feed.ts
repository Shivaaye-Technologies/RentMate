/** The Discover feed (GET /api/v1/matches), shared by Home, Vibes and Map. */
import { personFromApi, rememberPeople, type Person } from "./people";
import { apiBaseUrl, supabase } from "./supabase";

export async function loadFeed(): Promise<Person[]> {
  if (!supabase) throw new Error("App configuration is missing.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/matches`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error("You're offline. Check your connection and try again.");
  }
  const body = (await response.json().catch(() => ({}))) as { matches?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Could not load profiles.");
  const people = (Array.isArray(body.matches) ? body.matches : []).map((m) =>
    personFromApi(m as Record<string, unknown>),
  );
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
