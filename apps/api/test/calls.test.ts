import { createHash } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { LiveKitProvider, MemoryProvider, signJwt, verifyJwt } from "../src/live/providers.js";
import {
  LiveStoreError,
  type CallRoom,
  type IntegrationStore,
  type LiveStore,
  type RoomKick,
} from "../src/live/store.js";
import { drainKicks } from "../src/live/webhook.js";
import { MemoryProfileStore } from "../src/store.js";

const SECRET = "test-secret-0123456789abcdef";
const CALL = "44444444-4444-4444-8444-444444444444";
const config = loadConfig({ NODE_ENV: "test" });
const verifier: TokenVerifier = async (t) => (t === "good" ? { id: "u-caller" } : null);
const auth = { Authorization: "Bearer good" };

/** Only the call methods matter here; anything else would be a test bug. */
class CallStore implements LiveStore {
  problems: string[] = [];
  room: CallRoom | null = {
    roomName: "call-abc",
    mode: "voice",
    status: "accepted",
    callerId: "u-caller",
    calleeId: "u-callee",
  };
  hungUp: string[] = [];
  async callCheck() {
    return this.problems;
  }
  async callRoom() {
    return this.room;
  }
  async callHangup(id: string) {
    if (!this.room) throw new LiveStoreError("Call not found.", 403);
    this.hungUp.push(id);
    return this.room.roomName;
  }
  private no(): never {
    throw new Error("not used in call tests");
  }
  roles = async () => [];
  listStreams = async () => this.no();
  broadcastCheck = async () => this.no();
  watchCheck = async () => this.no();
  streamRoom = async () => this.no();
  sessionCheck = async () => this.no();
  sessionRoom = async () => this.no();
  terminateStream = async () => this.no();
  terminateSession = async () => this.no();
  setEmergencyStop = async () => this.no();
  adminStreams = async () => this.no();
  viewerCap = async () => this.no();
  hostCheck = async () => this.no();
  removeGuest = async () => this.no();
  endStream = async () => this.no();
}

function setup(provider: MemoryProvider | null = new MemoryProvider("livekit")) {
  const store = new CallStore();
  const providers = new Map(provider ? [[provider.key, provider]] : []);
  const app = createApp({
    config,
    verifyToken: verifier,
    storeFor: () => new MemoryProfileStore(),
    live: { liveStoreFor: () => store, providers, countryHeader: null },
  });
  return { app, store, provider };
}

describe("call routes", () => {
  it("require sign-in", async () => {
    const { app } = setup();
    expect((await request(app).post(`/api/v1/calls/${CALL}/join`).send({})).status).toBe(401);
    expect((await request(app).post(`/api/v1/calls/${CALL}/end`).send({})).status).toBe(401);
  });

  it("issue a microphone-only token for voice calls after the database allows it", async () => {
    const { app, provider } = setup();
    const res = await request(app).post(`/api/v1/calls/${CALL}/join`).set(auth).send({});
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ room: "call-abc", mode: "voice" });
    expect(provider!.issued).toEqual([
      { room: "call-abc", identity: "u-caller", canPublish: true, audioOnly: true, ttlSeconds: 600 },
    ]);
  });

  it("issue a camera-and-microphone token for video calls", async () => {
    const { app, store, provider } = setup();
    store.room = { ...store.room!, mode: "video" };
    await request(app).post(`/api/v1/calls/${CALL}/join`).set(auth).send({});
    expect(provider!.issued[0].audioOnly).toBe(false);
  });

  it("refuse with reasons and issue no token when the database says no", async () => {
    const { app, store, provider } = setup();
    for (const [codes, status, text] of [
      [["call_not_found"], 404, /doesn't exist/],
      [["blocked"], 404, /isn't available/],
      [["account_suspended"], 403, /suspended/],
      [["participant_suspended"], 403, /isn't available/],
      [["not_matched"], 403, /matched/],
      [["call_not_active"], 403, /ringing or connected/],
      [["provider_not_enabled"], 403, /isn't enabled/],
    ] as const) {
      store.problems = [...codes];
      const res = await request(app).post(`/api/v1/calls/${CALL}/join`).set(auth).send({});
      expect(res.status).toBe(status);
      expect(res.body.reasons[0]).toMatch(text);
    }
    expect(provider!.issued).toHaveLength(0);
  });

  it("validate the call id", async () => {
    const { app } = setup();
    expect((await request(app).post("/api/v1/calls/nope/join").set(auth).send({})).status).toBe(400);
  });

  it("end the call in the database, then close the room for both people", async () => {
    const { app, store, provider } = setup();
    const res = await request(app).post(`/api/v1/calls/${CALL}/end`).set(auth).send({});
    expect(res.body).toEqual({ ended: true, roomClosed: true });
    expect(store.hungUp).toEqual([CALL]);
    expect(provider!.closed).toEqual(["call-abc"]);
  });

  it("return 503 when the server has no LiveKit credentials", async () => {
    const { app } = setup(null);
    const res = await request(app).post(`/api/v1/calls/${CALL}/join`).set(auth).send({});
    expect(res.status).toBe(503);
  });
});

// ---------- Webhooks ----------

class FakeIntegration implements IntegrationStore {
  events: Record<string, unknown>[] = [];
  kickNext = false;
  seen = new Set<string>();
  kicks: RoomKick[] = [];
  done: number[] = [];
  async ingest(event: Record<string, unknown>) {
    const id = String(event.id);
    const duplicate = this.seen.has(id);
    this.seen.add(id);
    if (!duplicate) this.events.push(event);
    return { kick: !duplicate && this.kickNext, duplicate };
  }
  async claimKicks() {
    const k = this.kicks;
    this.kicks = [];
    return k;
  }
  async doneKicks(ids: number[]) {
    this.done.push(...ids);
  }
}

const NOW = Date.parse("2026-11-21T10:00:00Z");

function liveKit(calls: { method: string; body: Record<string, unknown> }[], fail = false) {
  return new LiveKitProvider({
    url: "wss://lk.example",
    apiKey: "APIkey",
    apiSecret: SECRET,
    now: () => NOW,
    fetchFn: (async (url: string, init: RequestInit) => {
      const method = url.split("/").pop()!;
      calls.push({ method, body: JSON.parse(String(init.body)) });
      if (fail) return new Response("{}", { status: 500 });
      if (method === "GetParticipant") {
        return new Response(
          JSON.stringify({
            tracks: [
              { sid: "TR_audio", type: "AUDIO" },
              { sid: "TR_video", type: "VIDEO" },
              { sid: "TR_audio2", type: "AUDIO", muted: true },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
}

function signedWebhook(
  body: string,
  opts: { secret?: string; iss?: string; exp?: number; hash?: string } = {},
) {
  const sha256 = opts.hash ?? createHash("sha256").update(body).digest("base64");
  const nowS = Math.floor(NOW / 1000);
  return signJwt(
    { iss: opts.iss ?? "APIkey", nbf: nowS - 5, exp: opts.exp ?? nowS + 300, sha256 },
    opts.secret ?? SECRET,
  );
}

function webhookApp(integration: FakeIntegration | null, lk: LiveKitProvider) {
  return createApp({
    config,
    verifyToken: verifier,
    storeFor: () => new MemoryProfileStore(),
    webhook: { providers: new Map([["livekit", lk]]), integration },
  });
}

const joined = JSON.stringify({
  event: "participant_joined",
  id: "EV_1",
  createdAt: "1795255200",
  room: { name: "call-abc" },
  participant: { identity: "u-outsider" },
});

describe("LiveKit webhook", () => {
  it("accepts a correctly signed event and records it once", async () => {
    const integration = new FakeIntegration();
    const app = webhookApp(integration, liveKit([]));
    const send = () =>
      request(app)
        .post("/api/v1/live/webhook")
        .set("content-type", "application/webhook+json")
        .set("authorization", signedWebhook(joined))
        .send(joined);
    const first = await send();
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, duplicate: false, kicked: false });
    const again = await send();
    expect(again.body.duplicate).toBe(true);
    expect(integration.events).toHaveLength(1);
  });

  it("removes a joining identity the database no longer allows", async () => {
    const integration = new FakeIntegration();
    integration.kickNext = true;
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const app = webhookApp(integration, liveKit(calls));
    const res = await request(app)
      .post("/api/v1/live/webhook")
      .set("content-type", "application/webhook+json")
      .set("authorization", signedWebhook(joined))
      .send(joined);
    expect(res.body.kicked).toBe(true);
    expect(calls).toEqual([
      { method: "RemoveParticipant", body: { room: "call-abc", identity: "u-outsider" } },
    ]);
  });

  it("refuses unsigned, tampered, expired, foreign and wrong-issuer events and stores nothing", async () => {
    const integration = new FakeIntegration();
    const app = webhookApp(integration, liveKit([]));
    const post = (auth: string | null, body = joined) => {
      const r = request(app).post("/api/v1/live/webhook").set("content-type", "application/webhook+json");
      return (auth ? r.set("authorization", auth) : r).send(body);
    };
    const tampered = joined.replace("u-outsider", "u-caller");
    const nowS = Math.floor(NOW / 1000);
    for (const res of [
      await post(null),
      await post(signedWebhook(joined), tampered), // body changed after signing
      await post(signedWebhook(joined, { exp: nowS - 1 })), // expired
      await post(signedWebhook(joined, { secret: "another-secret-0123456789" })), // another project
      await post(signedWebhook(joined, { iss: "someone-else" })), // wrong key id
      await post(signedWebhook(joined, { hash: "AAAA" })), // wrong hash length
      await post("not-a-jwt"),
    ]) {
      expect(res.status).toBe(401);
    }
    expect(integration.events).toHaveLength(0);
  });

  it("answers 503 when the database secret is not configured", async () => {
    const app = webhookApp(null, liveKit([]));
    const res = await request(app)
      .post("/api/v1/live/webhook")
      .set("authorization", signedWebhook(joined))
      .send(joined);
    expect(res.status).toBe(503);
  });
});

describe("room removal queue", () => {
  it("removes queued people and marks only successful removals done", async () => {
    const integration = new FakeIntegration();
    integration.kicks = [
      { id: 1, roomName: "call-abc", identity: "u-a", reason: "blocked" },
      { id: 2, roomName: "sm-room", identity: "u-b", reason: "suspended" },
    ];
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    expect(await drainKicks(new Map([["livekit", liveKit(calls)]]), integration)).toBe(2);
    expect(calls.map((c) => c.body)).toEqual([
      { room: "call-abc", identity: "u-a" },
      { room: "sm-room", identity: "u-b" },
    ]);
    expect(integration.done).toEqual([1, 2]);

    const failing = new FakeIntegration();
    failing.kicks = [{ id: 3, roomName: "call-x", identity: "u-c", reason: "blocked" }];
    expect(await drainKicks(new Map([["livekit", liveKit([], true)]]), failing)).toBe(0);
    expect(failing.done).toEqual([]); // retried after the claim expires
  });
});

describe("LiveKit RoomService controls", () => {
  it("mutes only unmuted tracks of the requested kind, with a room-scoped admin token", async () => {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const lk = liveKit(calls);
    expect(await lk.muteParticipant("sm-room", "u-guest", "audio")).toBe(1);
    expect(calls.map((c) => c.method)).toEqual(["GetParticipant", "MutePublishedTrack"]);
    expect(calls[1].body).toEqual({
      room: "sm-room",
      identity: "u-guest",
      track_sid: "TR_audio",
      muted: true,
    });
  });

  it("signs webhooks it can verify (round trip with the shared JWT code)", () => {
    const claims = verifyJwt(signedWebhook("x"), SECRET, { nowSeconds: Math.floor(NOW / 1000) });
    expect(claims?.sha256).toBe(createHash("sha256").update("x").digest("base64"));
  });
});
