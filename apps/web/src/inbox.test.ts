import { describe, expect, it } from "vitest";
import { EMPTY_DETAILS } from "./details";
import type { Person } from "./api";
import {
  alertsFor,
  buildNotices,
  dayLabel,
  shortTime,
  startsNewDay,
  unreadCount,
  type MatchSummary,
} from "./inbox";

const person = (id: string, name: string): Person => ({
  id,
  score: 0,
  sharedInterests: [],
  displayName: name,
  age: 28,
  bio: "",
  interests: [],
  lookingFor: "relationship",
  photoPath: null,
  verified: false,
  online: false,
  distanceKm: null,
  joinedAt: null,
  details: EMPTY_DETAILS,
  photos: [],
});

const match = (id: string, p: Person, unread: number | null, lastAt: string | null): MatchSummary => ({
  matchId: id,
  person: p,
  since: "2026-10-20T10:00:00Z",
  lastMessage: lastAt ? "hi" : null,
  lastAt,
  lastFromMe: false,
  unread,
});

describe("unreadCount", () => {
  const msgs = [
    { sender_id: "them", created_at: "2026-10-23T10:00:00Z" },
    { sender_id: "me", created_at: "2026-10-23T10:05:00Z" },
    { sender_id: "them", created_at: "2026-10-23T10:10:00Z" },
  ];
  it("counts only their messages after your read marker", () => {
    expect(unreadCount(msgs, "me", "2026-10-23T10:01:00Z")).toBe(1);
    expect(unreadCount(msgs, "me", null)).toBe(2);
    expect(unreadCount(msgs, "me", "2026-10-23T11:00:00Z")).toBe(0);
  });
});

describe("buildNotices", () => {
  const asha = person("a", "Asha");
  const ravi = person("r", "Ravi");
  it("lists only real likes, matches and unread messages, newest first", () => {
    const n = buildNotices(
      [{ person: asha, isSuper: true, at: "2026-10-23T09:00:00Z" }],
      [match("m1", ravi, 2, "2026-10-23T12:00:00Z"), match("m2", asha, 0, "2026-10-21T12:00:00Z")],
      null,
    );
    expect(n.map((x) => x.kind)).toEqual(["message", "super", "match", "match"]);
    expect(n[0].text).toBe("2 new messages from Ravi");
  });

  it("respects saved preferences and unknown unread counts", () => {
    const n = buildNotices(
      [{ person: asha, isSuper: false, at: "2026-10-23T09:00:00Z" }],
      [match("m1", ravi, null, "2026-10-23T12:00:00Z")],
      { likes: false, matches: false },
    );
    expect(n).toEqual([]);
  });
});

describe("alertsFor", () => {
  it("alerts only on increases after the first check", () => {
    expect(alertsFor(null, { likes: 5, matches: 1, unread: 3 }, null)).toEqual([]);
    expect(
      alertsFor(
        { likes: 1, matches: 1, unread: 0 },
        { likes: 2, matches: 1, unread: 1 },
        { messages: false },
      ),
    ).toEqual(["Someone new likes you on SOULMATE.AI"]);
  });
});

describe("time labels", () => {
  const now = new Date(2026, 9, 23, 15, 0).getTime();
  it("formats recent times compactly", () => {
    expect(shortTime(new Date(2026, 9, 23, 9, 5).toISOString(), now, "en-GB")).toBe("09:05");
    expect(shortTime(new Date(2026, 9, 22, 9, 5).toISOString(), now, "en-GB")).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 23, 1, 0).toISOString(), now)).toBe("Today");
  });
  it("puts separators where the day changes", () => {
    const list = [
      { created_at: new Date(2026, 9, 22, 23, 0).toISOString() },
      { created_at: new Date(2026, 9, 22, 23, 30).toISOString() },
      { created_at: new Date(2026, 9, 23, 0, 10).toISOString() },
    ];
    expect([0, 1, 2].map((i) => startsNewDay(list, i))).toEqual([true, false, true]);
  });
});
