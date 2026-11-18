import type { Person } from "../api";

/**
 * Demo Mode simulation. Everything here is fictional and runs only in the
 * visitor's browser: likes, matches and chat replies are computed from a
 * per-browser seed, every record is marked `simulated: true`, and nothing is
 * written to the real likes / matches / messages tables. Real members can never
 * see, receive or be represented by any of it.
 */

export const DEMO_STORAGE_KEY = "soulmate-demo-mode-v1";
/** Simulated replies per conversation; the last one says it is a demo. */
export const MAX_REPLIES = 10;
/** Share of demo profiles that (eventually) like you first, in percent. */
export const LIKES_YOU_PERCENT = 25;
/** Chance a demo profile likes you back when you like first, in percent. */
export const LIKE_BACK_PERCENT = 45;
/** Likes from demo profiles arrive gradually over this many minutes. */
export const LIKE_ARRIVAL_MINUTES = 30;
/** How long a simulated reply "types" before it appears. */
export const REPLY_DELAY_MS = 1500;

export interface DemoMessage {
  id: string;
  from: "you" | "them";
  body: string;
  at: number;
  simulated: true;
}

export interface DemoMatch {
  personId: string;
  at: number;
  simulated: true;
}

export interface DemoState {
  version: 1;
  /** Per-browser seed: the same visitor sees the same simulated behaviour. */
  seed: string;
  startedAt: number;
  liked: string[];
  superLiked: string[];
  passed: string[];
  matches: DemoMatch[];
  messages: Record<string, DemoMessage[]>;
}

/** FNV-1a: small, fast, deterministic string hash. */
export function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const roll = (state: DemoState, kind: string, id: string) => hash(`${state.seed}:${kind}:${id}`) % 100;

export function newState(seed: string, now: number): DemoState {
  return {
    version: 1,
    seed,
    startedAt: now,
    liked: [],
    superLiked: [],
    passed: [],
    matches: [],
    messages: {},
  };
}

export function randomSeed(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Whether this demo profile likes the visitor (decided once per seed). */
export function likesYou(state: DemoState, personId: string): boolean {
  return roll(state, "likes-you", personId) < LIKES_YOU_PERCENT;
}

/** When a demo profile's like arrives, so new likes keep appearing during a visit. */
export function likeArrivesAt(state: DemoState, personId: string): number {
  const minutes = hash(`${state.seed}:like-at:${personId}`) % LIKE_ARRIVAL_MINUTES;
  // A third of the likes are there from the start, so the Likes tab is never empty.
  return state.startedAt + (minutes < LIKE_ARRIVAL_MINUTES / 3 ? 0 : minutes * 60_000);
}

const isMatched = (state: DemoState, id: string) => state.matches.some((m) => m.personId === id);

/** People to swipe on: not yet liked, passed or matched, in a stable shuffled order. */
export function deck(state: DemoState, people: Person[]): Person[] {
  const seen = new Set([...state.liked, ...state.passed]);
  return people
    .filter((p) => !seen.has(p.id) && !isMatched(state, p.id))
    .sort((a, b) => hash(`${state.seed}:order:${a.id}`) - hash(`${state.seed}:order:${b.id}`));
}

/** Simulated likes received so far (not answered yet). */
export function receivedLikes(state: DemoState, people: Person[], now: number): Person[] {
  const answered = new Set([...state.liked, ...state.passed]);
  return people
    .filter((p) => likesYou(state, p.id) && !answered.has(p.id) && likeArrivesAt(state, p.id) <= now)
    .sort((a, b) => likeArrivesAt(state, b.id) - likeArrivesAt(state, a.id) || a.id.localeCompare(b.id));
}

function opener(person: Person): string {
  const topic = person.interests[0]?.toLowerCase() ?? "music";
  return `Hi! I'm ${person.displayName}. Your profile made me smile 😊 Are you into ${topic} too?`;
}

/** The scripted lines a demo profile sends, in order. */
export function replyFor(person: Person, index: number): string {
  const topic = person.interests[0]?.toLowerCase() ?? "music";
  const lines = [
    "Hey! Thanks for the message 😊 How is your day going?",
    `I'm pretty obsessed with ${topic} lately. What got you into the things on your profile?`,
    "Haha, that's great. What do you usually do on weekends?",
    "Nice! I'm more of a slow-morning, good-coffee kind of person.",
    `Have you tried any ${topic} spots around here? I'm always looking for new ones.`,
    "Okay, important question: mountains or beaches?",
    "Good answer 😄 What's one thing on your bucket list?",
    "I love that. Mine is to travel somewhere completely new every year.",
    "This is fun. Do you prefer chatting here or meeting for a coffee sometime?",
    "Heads up: I'm a fictional demo profile, so my replies stop here. Create an account to meet real people! 👋",
  ];
  return lines[Math.min(index, lines.length - 1)];
}

export type Decision = "like" | "super" | "pass";

/** Applies a swipe. Returns the new state and whether it became a (simulated) match. */
export function decide(
  state: DemoState,
  person: Person,
  kind: Decision,
  now: number,
): { state: DemoState; matched: boolean } {
  if (kind === "pass") {
    return { state: { ...state, passed: [...new Set([...state.passed, person.id])] }, matched: false };
  }
  const next: DemoState = {
    ...state,
    liked: [...new Set([...state.liked, person.id])],
    superLiked: kind === "super" ? [...new Set([...state.superLiked, person.id])] : state.superLiked,
  };
  const matched =
    !isMatched(state, person.id) &&
    (kind === "super" ||
      likesYou(state, person.id) ||
      roll(state, "like-back", person.id) < LIKE_BACK_PERCENT);
  if (!matched) return { state: next, matched: false };
  const first: DemoMessage = {
    id: `${person.id}:0`,
    from: "them",
    body: opener(person),
    at: now + REPLY_DELAY_MS,
    simulated: true,
  };
  return {
    state: {
      ...next,
      matches: [...next.matches, { personId: person.id, at: now, simulated: true }],
      messages: { ...next.messages, [person.id]: [first] },
    },
    matched: true,
  };
}

/** Undo the most recent pass. */
export function rewind(state: DemoState): DemoState {
  return { ...state, passed: state.passed.slice(0, -1) };
}

/** You send a message; the demo profile answers with its next scripted line. */
export function sendMessage(state: DemoState, person: Person, body: string, now: number): DemoState {
  const text = body.trim().slice(0, 2000);
  if (!text || !isMatched(state, person.id)) return state;
  const thread = state.messages[person.id] ?? [];
  const mine: DemoMessage = {
    id: `${person.id}:${thread.length}`,
    from: "you",
    body: text,
    at: now,
    simulated: true,
  };
  const replies = thread.filter((m) => m.from === "them" && m.id !== `${person.id}:0`).length;
  const out = [...thread, mine];
  if (replies < MAX_REPLIES) {
    out.push({
      id: `${person.id}:${out.length}`,
      from: "them",
      body: replyFor(person, replies),
      at: now + REPLY_DELAY_MS,
      simulated: true,
    });
  }
  return { ...state, messages: { ...state.messages, [person.id]: out } };
}

/** Messages that have "arrived" by now (replies appear after a short typing delay). */
export function visibleMessages(state: DemoState, personId: string, now: number): DemoMessage[] {
  return (state.messages[personId] ?? []).filter((m) => m.at <= now);
}

export function isTyping(state: DemoState, personId: string, now: number): boolean {
  return (state.messages[personId] ?? []).some((m) => m.from === "them" && m.at > now);
}

function isState(x: unknown): x is DemoState {
  const s = x as DemoState;
  return (
    !!s &&
    s.version === 1 &&
    typeof s.seed === "string" &&
    typeof s.startedAt === "number" &&
    Array.isArray(s.liked) &&
    Array.isArray(s.superLiked) &&
    Array.isArray(s.passed) &&
    Array.isArray(s.matches) &&
    typeof s.messages === "object" &&
    s.messages !== null
  );
}

/** Reads the saved demo state, or starts a fresh one. Storage may be unavailable. */
export function loadState(storage: Pick<Storage, "getItem"> | null, now: number): DemoState {
  try {
    const raw = storage?.getItem(DEMO_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (isState(parsed)) return parsed;
  } catch {
    // Corrupt or blocked storage: start over (it only holds simulated demo data).
  }
  return newState(randomSeed(), now);
}

export function saveState(storage: Pick<Storage, "setItem"> | null, state: DemoState): void {
  try {
    storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing or full storage: the demo still works for this visit.
  }
}
