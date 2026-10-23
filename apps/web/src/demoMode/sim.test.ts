import { describe, expect, it } from "vitest";
import type { Person } from "../api";
import {
  DEMO_STORAGE_KEY,
  MAX_REPLIES,
  decide,
  deck,
  isTyping,
  likeArrivesAt,
  likesYou,
  loadState,
  newState,
  receivedLikes,
  rewind,
  saveState,
  sendMessage,
  visibleMessages,
} from "./sim";

const person = (i: number): Person => ({
  id: `00000000-0000-5000-8000-${String(i).padStart(12, "0")}`,
  score: 0,
  sharedInterests: [],
  displayName: `Demo ${i}`,
  age: 20 + (i % 20),
  bio: "Fictional",
  interests: ["Hiking"],
  lookingFor: "relationship",
  photoPath: `demo/avatars/${String(i).padStart(3, "0")}.svg`,
  verified: false,
  online: false,
  distanceKm: 3,
  joinedAt: null,
});
const people = Array.from({ length: 100 }, (_, i) => person(i + 1));
const T0 = 1_800_000_000_000;

describe("Demo Mode simulation", () => {
  it("is deterministic for a visitor and differs between visitors", () => {
    const a = newState("seed-a", T0);
    const b = newState("seed-b", T0);
    expect(people.map((p) => likesYou(a, p.id))).toEqual(
      people.map((p) => likesYou(newState("seed-a", 0), p.id)),
    );
    expect(deck(a, people).map((p) => p.id)).toEqual(deck(newState("seed-a", T0), people).map((p) => p.id));
    expect(deck(a, people).map((p) => p.id)).not.toEqual(deck(b, people).map((p) => p.id));
  });

  it("shows every demo profile in the deck until you decide", () => {
    let s = newState("seed", T0);
    expect(deck(s, people)).toHaveLength(100);
    s = decide(s, people[0], "pass", T0).state;
    s = decide(s, people[1], "like", T0).state;
    expect(deck(s, people)).toHaveLength(98);
    s = rewind(s);
    expect(deck(s, people)).toHaveLength(99);
  });

  it("delivers simulated likes gradually and about a quarter of profiles like you", () => {
    const s = newState("seed", T0);
    const fans = people.filter((p) => likesYou(s, p.id));
    expect(fans.length).toBeGreaterThan(10);
    expect(fans.length).toBeLessThan(45);
    const early = receivedLikes(s, people, T0).length;
    const later = receivedLikes(s, people, T0 + 60 * 60_000).length;
    expect(early).toBeGreaterThan(0);
    expect(later).toBe(fans.length);
    expect(early).toBeLessThan(later);
    for (const p of fans) expect(likeArrivesAt(s, p.id)).toBeGreaterThanOrEqual(T0);
  });

  it("matches when they liked you, on Super Likes, and sometimes otherwise", () => {
    const s = newState("seed", T0);
    const fan = people.find((p) => likesYou(s, p.id))!;
    expect(decide(s, fan, "like", T0).matched).toBe(true);
    const other = people.find((p) => !likesYou(s, p.id))!;
    expect(decide(s, other, "super", T0).matched).toBe(true);
    const outcomes = people.filter((p) => !likesYou(s, p.id)).map((p) => decide(s, p, "like", T0).matched);
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
    expect(decide(s, fan, "pass", T0).matched).toBe(false);
  });

  it("marks every match and message as simulated and stops replies after the limit", () => {
    let s = newState("seed", T0);
    const p = people.find((x) => likesYou(s, x.id))!;
    s = decide(s, p, "like", T0).state;
    expect(s.matches).toEqual([{ personId: p.id, at: T0, simulated: true }]);
    expect(isTyping(s, p.id, T0)).toBe(true);
    expect(visibleMessages(s, p.id, T0)).toHaveLength(0);
    expect(visibleMessages(s, p.id, T0 + 2000)).toHaveLength(1);

    for (let i = 0; i < MAX_REPLIES + 3; i++) s = sendMessage(s, p, `hello ${i}`, T0 + 10_000 * (i + 1));
    const thread = s.messages[p.id];
    expect(thread.every((m) => m.simulated === true)).toBe(true);
    expect(thread.filter((m) => m.from === "you")).toHaveLength(MAX_REPLIES + 3);
    expect(thread.filter((m) => m.from === "them")).toHaveLength(MAX_REPLIES + 1); // opener + 10 replies
    expect(thread.filter((m) => m.from === "them").at(-1)?.body).toMatch(/fictional demo profile/);
    expect(thread.slice(-3).every((m) => m.from === "you")).toBe(true);
  });

  it("does not let you message someone you have not matched, or send blank text", () => {
    const s = newState("seed", T0);
    expect(sendMessage(s, people[5], "hi", T0)).toBe(s);
    const matched = decide(s, people[5], "super", T0).state;
    expect(sendMessage(matched, people[5], "   ", T0)).toBe(matched);
  });

  it("saves only under the demo key and survives broken storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const s = decide(newState("seed", T0), people[0], "super", T0).state;
    saveState(storage, s);
    expect([...store.keys()]).toEqual([DEMO_STORAGE_KEY]);
    expect(loadState(storage, T0)).toEqual(s);

    store.set(DEMO_STORAGE_KEY, "{not json");
    expect(loadState(storage, T0).matches).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadState(throwing, T0).liked).toEqual([]);
    expect(() => saveState(throwing, s)).not.toThrow();
  });
});
