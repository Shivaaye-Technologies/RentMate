import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { classifyHealth, explainProblems, refusalStatus, viewerCountry } from "../src/live/policy.js";
import {
  buildRegistry,
  LiveKitProvider,
  MAX_TOKEN_TTL_SECONDS,
  MemoryProvider,
  signJwt,
  verifyJwt,
  type PublishSource,
} from "../src/live/providers.js";
import { LiveStoreError, type AdminStream, type LiveStore, type StreamRoom } from "../src/live/store.js";
import { MemoryProfileStore } from "../src/store.js";

const SECRET = "test-secret-0123456789abcdef-GHIJKLmnop";
const STREAM = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

// ---------- Providers ----------

describe("LiveKit provider", () => {
  const now = () => Date.parse("2026-11-01T00:00:00Z");

  it("signs short-lived room tokens with the right grants", async () => {
    const lk = new LiveKitProvider({
      url: "wss://x.livekit.cloud",
      apiKey: "APIkey",
      apiSecret: SECRET,
      now,
    });
    const viewer = await lk.issueToken({ room: "sm-1", identity: "u1", canPublish: false, ttlSeconds: 600 });
    const claims = verifyJwt(viewer.token, SECRET)!;
    expect(claims).toMatchObject({
      iss: "APIkey",
      sub: "u1",
      video: { room: "sm-1", roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false },
    });
    expect(claims.exp).toBe(Math.floor(now() / 1000) + 600);
    expect(viewer.url).toBe("wss://x.livekit.cloud");
    expect(verifyJwt(viewer.token, "wrong-secret-0123456789")).toBeNull();
    expect(JSON.stringify(viewer)).not.toContain(SECRET);

    const audio = await lk.issueToken({
      room: "ps-1",
      identity: "u2",
      canPublish: true,
      audioOnly: true,
      ttlSeconds: 60,
    });
    expect(verifyJwt(audio.token, SECRET)!.video).toMatchObject({
      canPublish: true,
      canPublishSources: ["microphone"],
    });
  });

  it("produces standard HS256 JWTs (known-answer vector, LiveKit-compatible format)", () => {
    // The published jwt.io HS256 example (secret "your-256-bit-secret"). The expected signature is an HMAC over the
    // exact header and body bytes, so any change to the token format breaks this test. The vector is checked in parts so
    // the repository never holds a complete JWT literal (the policy guard treats those as possible credentials).
    const claims = { sub: "1234567890", name: "John Doe", iat: 1516239022 };
    const token = signJwt(claims, "your-256-bit-secret");
    const [h, b, s] = token.split(".");
    expect(h).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(Buffer.from(b, "base64url").toString("utf8")).toBe(JSON.stringify(claims));
    expect(s).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(verifyJwt(token, "your-256-bit-secret")).toEqual(claims);
  });

  it("rejects tampered, unsigned and malformed tokens", () => {
    const good = signJwt({ sub: "u1", video: { roomJoin: true } }, SECRET);
    const [h, b, s] = good.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sub: "admin", video: { roomAdmin: true } })).toString(
      "base64url",
    );
    expect(verifyJwt(`${h}.${forgedBody}.${s}`, SECRET)).toBeNull();
    const flipped = (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(verifyJwt(`${h}.${b}.${flipped}`, SECRET)).toBeNull();
    expect(verifyJwt(`${h}.${b}.${s.slice(0, -2)}`, SECRET)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const noneSig = signJwt({ sub: "u1" }, SECRET).split(".")[2];
    expect(verifyJwt(`${none}.${b}.`, SECRET)).toBeNull();
    expect(verifyJwt(`${none}.${b}.${noneSig}`, SECRET)).toBeNull();
    expect(verifyJwt("not-a-jwt", SECRET)).toBeNull();
    expect(verifyJwt(`${h}.${b}.${s}.extra`, SECRET)).toBeNull();
    expect(verifyJwt("%%%.%%%.%%%", SECRET)).toBeNull();
    expect(verifyJwt(good, SECRET)).toMatchObject({ sub: "u1" });
  });

  it("issues short-lived, room-scoped tokens that expire and carry the API key as issuer", async () => {
    const lk = new LiveKitProvider({
      url: "wss://x.livekit.cloud",
      apiKey: "APIkey",
      apiSecret: SECRET,
      now,
    });
    const t = await lk.issueToken({ room: "sm-9", identity: "u9", canPublish: false, ttlSeconds: 600 });
    const nowS = Math.floor(now() / 1000);
    const claims = verifyJwt(t.token, SECRET, { nowSeconds: nowS })!;
    expect(claims.iss).toBe("APIkey");
    expect(claims.sub).toBe("u9");
    expect((claims.exp as number) - nowS).toBe(600);
    expect((claims.video as { room: string }).room).toBe("sm-9");
    expect(claims.video).not.toHaveProperty("roomAdmin");
    expect(claims.video).not.toHaveProperty("roomRecord");
    expect(Date.parse(t.expiresAt) / 1000).toBe(claims.exp);
    // Expired, at and after exp; not yet valid, before nbf.
    expect(verifyJwt(t.token, SECRET, { nowSeconds: nowS + 600 })).toBeNull();
    expect(verifyJwt(t.token, SECRET, { nowSeconds: nowS + 3600 })).toBeNull();
    expect(verifyJwt(t.token, SECRET, { nowSeconds: nowS - 60 })).toBeNull();
    // Tokens without an expiry are refused when time is checked.
    expect(verifyJwt(signJwt({ sub: "u9" }, SECRET), SECRET, { nowSeconds: nowS })).toBeNull();
    // A token signed with another project's secret is refused.
    const other = new LiveKitProvider({
      url: "wss://x.livekit.cloud",
      apiKey: "K2",
      apiSecret: "another-secret-9876543210",
      now,
    });
    const foreign = await other.issueToken({
      room: "sm-9",
      identity: "u9",
      canPublish: true,
      ttlSeconds: 600,
    });
    expect(verifyJwt(foreign.token, SECRET, { nowSeconds: nowS })).toBeNull();
    // Header tampering (alg switched to HS512 or none) is refused even with a valid signature over the original header.
    const [, body, sig] = t.token.split(".");
    for (const alg of ["HS512", "none", "RS256"]) {
      const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
      expect(verifyJwt(`${h}.${body}.${sig}`, SECRET)).toBeNull();
    }
  });

  it("refuses to issue tokens without credentials", async () => {
    const lk = new LiveKitProvider({ url: "wss://x.livekit.cloud" });
    expect(lk.configured).toBe(false);
    await expect(
      lk.issueToken({ room: "r", identity: "u", canPublish: false, ttlSeconds: 60 }),
    ).rejects.toThrow(/not configured/);
  });

  it("closes rooms and reads participants through RoomService with a server token", async () => {
    const calls: { url: string; auth: string; body: unknown }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: (init.headers as Record<string, string>).authorization,
        body: JSON.parse(String(init.body)),
      });
      if (url.endsWith("ListParticipants")) {
        return new Response(JSON.stringify({ participants: [{ tracks: [{}] }, { tracks: [] }, {}] }), {
          status: 200,
        });
      }
      if (url.endsWith("DeleteRoom")) return new Response("{}", { status: 404 });
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const lk = new LiveKitProvider({
      url: "wss://x.livekit.cloud/",
      apiKey: "K",
      apiSecret: SECRET,
      fetchFn,
      now,
    });
    await expect(lk.closeRoom("sm-1")).resolves.toBeUndefined();
    expect(await lk.roomStats("sm-1")).toEqual({ participants: 3, publishers: 1 });
    expect(calls[0].url).toBe("https://x.livekit.cloud/twirp/livekit.RoomService/DeleteRoom");
    expect(calls[0].body).toEqual({ room: "sm-1" });
    const admin = verifyJwt(calls[0].auth.replace(/^Bearer /, ""), SECRET)!;
    expect(admin.video).toEqual({ roomCreate: true });
    expect(Number(admin.exp) - Math.floor(now() / 1000)).toBeLessThanOrEqual(60);
  });

  it("gives each RoomService call only the grant LiveKit documents for it, for 60 seconds", async () => {
    const seen: { method: string; token: string; claims: Record<string, unknown> }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>).authorization.replace(/^Bearer /, "");
      seen.push({ method: url.split("/").pop()!, token, claims: verifyJwt(token, SECRET)! });
      if (url.endsWith("GetParticipant"))
        return new Response(JSON.stringify({ tracks: [{ sid: "TR_v", type: "VIDEO" }] }), { status: 200 });
      return new Response(JSON.stringify({ participants: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const lk = new LiveKitProvider({
      url: "wss://x.livekit.cloud",
      apiKey: "APIkey",
      apiSecret: SECRET,
      fetchFn,
      now,
    });
    await lk.closeRoom("sm-1");
    await lk.roomStats("sm-2");
    await lk.removeParticipant("sm-3", "u3");
    await lk.muteParticipant("sm-4", "u4", "video");
    await lk.setPublishSources("sm-5", "u5", ["microphone"]);
    const nowS = Math.floor(now() / 1000);
    expect(seen.map((s) => [s.method, s.claims.video])).toEqual([
      ["DeleteRoom", { roomCreate: true }],
      ["ListParticipants", { roomAdmin: true, room: "sm-2" }],
      ["RemoveParticipant", { roomAdmin: true, room: "sm-3" }],
      ["GetParticipant", { roomAdmin: true, room: "sm-4" }],
      ["MutePublishedTrack", { roomAdmin: true, room: "sm-4" }],
      ["UpdateParticipant", { roomAdmin: true, room: "sm-5" }],
    ]);
    for (const { token, claims } of seen) {
      expect(claims.iss).toBe("APIkey");
      expect(claims.exp).toBe(nowS + 60);
      expect(verifyJwt(token, SECRET, { nowSeconds: nowS + 59 })).not.toBeNull();
      expect(verifyJwt(token, SECRET, { nowSeconds: nowS + 60 })).toBeNull(); // expired after a minute
      expect(claims).not.toHaveProperty("sub"); // a server token, not a participant
      expect(claims.video).not.toHaveProperty("roomJoin");
      expect(claims.video).not.toHaveProperty("roomList");
      expect(claims.video).not.toHaveProperty("roomRecord");
    }
  });

  it("refuses to sign tokens with an invalid room, identity or lifetime", async () => {
    const lk = new LiveKitProvider({
      url: "wss://x.livekit.cloud",
      apiKey: "APIkey",
      apiSecret: SECRET,
      now,
    });
    const base = { room: "sm-1", identity: "u1", canPublish: false, ttlSeconds: 600 };
    for (const ttlSeconds of [0, -1, 1.5, NaN, Infinity, MAX_TOKEN_TTL_SECONDS + 1])
      await expect(lk.issueToken({ ...base, ttlSeconds })).rejects.toThrow(/ttlSeconds/);
    for (const room of ["", "a".repeat(257), "sm-1\nx", "sm\u0000"])
      await expect(lk.issueToken({ ...base, room })).rejects.toThrow(/room/);
    for (const identity of ["", "u".repeat(257), "u1\r"])
      await expect(lk.issueToken({ ...base, identity })).rejects.toThrow(/identity/);
    await expect(lk.issueToken({ ...base, ttlSeconds: 1 })).resolves.toHaveProperty("token");
    await expect(lk.issueToken({ ...base, ttlSeconds: MAX_TOKEN_TTL_SECONDS })).resolves.toHaveProperty(
      "token",
    );
  });

  it("never puts the API secret in responses or error messages", async () => {
    const fetchFn = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const lk = new LiveKitProvider({
      url: "wss://x.livekit.cloud",
      apiKey: "APIkey",
      apiSecret: SECRET,
      fetchFn,
      now,
    });
    const t = await lk.issueToken({ room: "sm-1", identity: "u1", canPublish: true, ttlSeconds: 600 });
    expect(JSON.stringify(t)).not.toContain(SECRET);
    for (const fail of [() => lk.closeRoom("sm-1"), () => lk.removeParticipant("sm-1", "u1")]) {
      const err = await fail().catch((e: unknown) => e);
      expect(String(err)).toMatch(/failed \(500\)/);
      expect(String(err)).not.toContain(SECRET);
    }
    const bad = await lk
      .issueToken({ room: "", identity: "u1", canPublish: false, ttlSeconds: 600 })
      .catch((e: unknown) => e);
    expect(String(bad)).not.toContain(SECRET);
  });

  it("is only registered when configured from the environment", () => {
    expect(buildRegistry({}).size).toBe(0);
    const reg = buildRegistry({ LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: SECRET });
    expect(reg.get("livekit")?.configured).toBe(true);
    expect(buildRegistry({ LIVEKIT_URL: "wss://x" }).get("livekit")?.configured).toBe(false);
  });
});

// ---------- Policy helpers ----------

describe("live policy helpers", () => {
  it("reads the viewer's country safely and fails closed", () => {
    expect(viewerCountry("in")).toBe("IN");
    expect(viewerCountry(["US", "GB"])).toBe("US");
    expect(viewerCountry("XX")).toBeNull();
    expect(viewerCountry("T1")).toBeNull();
    expect(viewerCountry("USA")).toBeNull();
    expect(viewerCountry(undefined)).toBeNull();
  });

  it("explains refusals without revealing blocks", () => {
    expect(explainProblems(["explicit_not_allowed_in_country"])).toEqual([
      "Adult content isn't available in your country.",
    ]);
    expect(
      explainProblems(["participant_consent_missing:abc", "participant_consent_missing:def"]),
    ).toHaveLength(1);
    expect(explainProblems(["blocked"])[0]).not.toMatch(/block/i);
    expect(refusalStatus(["blocked"])).toBe(404);
    expect(refusalStatus(["emergency_stop"])).toBe(503);
    expect(refusalStatus(["age_not_verified"])).toBe(403);
  });

  it("classifies stream health", () => {
    expect(classifyHealth("s", { participants: 5, publishers: 1 }, true, []).status).toBe("ok");
    expect(classifyHealth("s", { participants: 5, publishers: 1 }, true, []).viewers).toBe(4);
    expect(classifyHealth("s", { participants: 2, publishers: 0 }, true, []).status).toBe("no_broadcaster");
    expect(classifyHealth("s", null, true, []).status).toBe("provider_unreachable");
    expect(classifyHealth("s", null, false, []).status).toBe("provider_missing");
    expect(classifyHealth("s", null, true, ["age_not_verified"]).status).toBe("policy_problem");
  });
});

// ---------- Routes ----------

const config = loadConfig({ NODE_ENV: "test" });
const verifier: TokenVerifier = async (t) => (t.startsWith("token-") ? { id: t.slice(6) } : null);

class FakeLiveStore implements LiveStore {
  watch: string[] = [];
  broadcast: string[] = [];
  session: string[] = [];
  room: StreamRoom | null = {
    roomName: "sm-room",
    providerKey: "memory",
    creatorId: "creator",
    explicit: false,
    status: "live",
  };
  moderator = false;
  admin = false;
  terminated: string[] = [];
  emergency: boolean | null = null;
  countries: (string | null)[] = [];
  streams: AdminStream[] = [
    {
      id: STREAM,
      roomName: "sm-room",
      providerKey: "memory",
      status: "live",
      title: "T",
      stageName: "S",
      problems: [],
    },
  ];

  async roles() {
    return [...(this.admin ? ["admin"] : []), ...(this.moderator ? ["moderator"] : [])];
  }
  async listStreams(country: string | null) {
    this.countries.push(country);
    return [];
  }
  async broadcastCheck() {
    return this.broadcast;
  }
  async watchCheck(_id: string, country: string | null) {
    this.countries.push(country);
    return this.watch;
  }
  async streamRoom() {
    return this.room;
  }
  async sessionCheck() {
    return this.session;
  }
  async sessionRoom() {
    return { roomName: "ps-room", providerKey: "memory", mode: "audio" as const };
  }
  private requireMod() {
    if (!this.moderator && !this.admin)
      throw new LiveStoreError("You don't have permission to do that.", 403);
  }
  async terminateStream(id: string) {
    this.requireMod();
    this.terminated.push(id);
  }
  async terminateSession(id: string) {
    this.requireMod();
    this.terminated.push(id);
  }
  async setEmergencyStop(on: boolean) {
    this.requireMod();
    this.emergency = on;
  }
  async adminStreams() {
    this.requireMod();
    return this.streams;
  }
  cap = 300;
  host = false;
  guestsRemoved: string[] = [];
  async callCheck() {
    return ["call_not_found"];
  }
  async callRoom() {
    return null;
  }
  async callHangup() {
    return "";
  }
  async viewerCap() {
    return this.cap;
  }
  async hostCheck() {
    return this.host;
  }
  ended: string[] = [];
  async endStream(id: string) {
    this.ended.push(id);
  }
  async removeGuest(_stream: string, guest: string) {
    if (!this.host) throw new LiveStoreError("You don't have permission to do that.", 403);
    this.guestsRemoved.push(guest);
  }
  /** Mirrors live_set_guest_mute / live_my_publish_sources (proven in supabase/tests/guest_host_mutes.sql). */
  guestMutes = { audio: false, video: false };
  isGuest = true;
  creator = false;
  private allowed(): PublishSource[] {
    const s: PublishSource[] = [];
    if (!this.guestMutes.video) s.push("camera");
    if (!this.guestMutes.audio) s.push("microphone");
    return s;
  }
  async publishSources() {
    if (this.creator) return ["camera", "microphone"] as PublishSource[];
    return this.isGuest ? this.allowed() : [];
  }
  async setGuestMute(_stream: string, _guest: string, kind: "audio" | "video", muted: boolean) {
    if (!this.host) throw new LiveStoreError("You don't have permission to do that.", 403);
    if (!this.isGuest) throw new LiveStoreError("That person is not a guest on this stream.", 409);
    this.guestMutes[kind] = muted;
    return this.allowed();
  }
}

function setup(opts: { countryHeader?: string | null; provider?: MemoryProvider | null } = {}) {
  const store = new FakeLiveStore();
  const provider = opts.provider === undefined ? new MemoryProvider() : opts.provider;
  const providers = new Map(provider ? [[provider.key, provider]] : []);
  const app = createApp({
    config,
    verifyToken: verifier,
    storeFor: () => new MemoryProfileStore(),
    live: {
      liveStoreFor: () => store,
      providers,
      countryHeader: opts.countryHeader === undefined ? "cf-ipcountry" : opts.countryHeader,
    },
  });
  return { app, store, provider };
}

const auth = { Authorization: "Bearer token-viewer" };

describe("live routes", () => {
  it("requires sign-in and returns 503 when live isn't configured", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/v1/live/streams")).status).toBe(401);
    const off = createApp({ config, verifyToken: verifier, storeFor: () => new MemoryProfileStore() });
    expect((await request(off).get("/api/v1/live/streams").set(auth)).status).toBe(503);
  });

  it("issues a viewer token only after the database allows it, using the trusted country header", async () => {
    const { app, store, provider } = setup();
    const res = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .set("cf-ipcountry", "us")
      .send({ as: "viewer" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ room: "sm-room", canPublish: false, url: "wss://memory.invalid" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(store.countries).toEqual(["US"]);
    expect(provider!.issued[0]).toMatchObject({ identity: "viewer", canPublish: false, ttlSeconds: 600 });
  });

  it("refuses with clear reasons and hides blocked streams", async () => {
    const { app, store, provider } = setup();
    store.watch = ["explicit_not_allowed_in_country"];
    const res = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "viewer" });
    expect(res.status).toBe(403);
    expect(res.body.reasons).toEqual(["Adult content isn't available in your country."]);
    store.watch = ["blocked"];
    const hidden = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "viewer" });
    expect(hidden.status).toBe(404);
    expect(provider!.issued).toHaveLength(0);
  });

  it("refuses suspended accounts everywhere a token is issued, without issuing one", async () => {
    const { app, store, provider } = setup();
    store.watch = ["account_suspended"];
    const watch = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "viewer" });
    expect(watch.status).toBe(403);
    expect(watch.body.reasons[0]).toMatch(/suspended/);
    store.broadcast = ["stream_not_live", "account_suspended"];
    const broadcast = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(broadcast.status).toBe(403);
    store.session = ["participant_suspended"];
    const session = await request(app).post(`/api/v1/live/sessions/${SESSION}/join`).set(auth).send({});
    expect(session.status).toBe(403);
    expect(session.body.reasons).toEqual(["This session isn't available right now."]);
    expect(provider!.issued).toHaveLength(0);
  });

  it("lets only the creator end a stream, and closes the room for everyone", async () => {
    const { app, store, provider } = setup();
    store.room = { ...store.room!, creatorId: "someone-else" };
    const denied = await request(app).post(`/api/v1/live/streams/${STREAM}/end`).set(auth).send({});
    expect(denied.status).toBe(403);
    expect(store.ended).toHaveLength(0);
    store.room = { ...store.room!, creatorId: "viewer" };
    const res = await request(app).post(`/api/v1/live/streams/${STREAM}/end`).set(auth).send({});
    expect(res.body).toEqual({ ended: true, roomClosed: true });
    expect(store.ended).toEqual([STREAM]);
    expect(provider!.closed).toContain("sm-room");
  });

  it("caps WebRTC viewers per stream but always lets hosts in", async () => {
    const { app, store, provider } = setup();
    store.cap = 2;
    provider!.stats.set("sm-room", { participants: 3, publishers: 1 }); // 2 viewers already
    const full = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "viewer" });
    expect(full.status).toBe(503);
    expect(full.body.reasons[0]).toMatch(/full/);
    const host = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(host.status).toBe(200);
    provider!.stats.set("sm-room", { participants: 2, publishers: 1 }); // 1 viewer: room for one more
    const ok = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "viewer" });
    expect(ok.status).toBe(200);
  });

  it("lets only the host mute or remove a guest, and removes them from the room at once", async () => {
    const { app, store, provider } = setup();
    const GUEST = "33333333-3333-4333-8333-333333333333";
    const denied = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/guests/${GUEST}/mute`)
      .set(auth)
      .send({ kind: "audio" });
    expect(denied.status).toBe(403);
    const deniedRemove = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/guests/${GUEST}/remove`)
      .set(auth)
      .send({});
    expect(deniedRemove.status).toBe(403);
    expect(provider!.muted).toHaveLength(0);
    expect(provider!.removed).toHaveLength(0);
    store.host = true;
    const muted = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/guests/${GUEST}/mute`)
      .set(auth)
      .send({ kind: "video" });
    expect(muted.status).toBe(200);
    expect(provider!.muted).toEqual([{ room: "sm-room", identity: GUEST, kind: "video" }]);
    const removed = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/guests/${GUEST}/remove`)
      .set(auth)
      .send({});
    expect(removed.body).toEqual({ removed: true, disconnected: true });
    expect(store.guestsRemoved).toEqual([GUEST]);
    expect(provider!.removed).toEqual([{ room: "sm-room", identity: GUEST }]);
    const bad = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/guests/not-a-uuid/mute`)
      .set(auth)
      .send({ kind: "audio" });
    expect(bad.status).toBe(400);
  });

  it("host mutes persist and are enforced by the media server: camera and microphone, mute and unmute", async () => {
    const { app, store, provider } = setup();
    const GUEST = "33333333-3333-4333-8333-333333333333";
    store.host = true;
    const post = (kind: "audio" | "video", muted?: boolean) =>
      request(app)
        .post(`/api/v1/live/streams/${STREAM}/guests/${GUEST}/mute`)
        .set(auth)
        .send(muted === undefined ? { kind } : { kind, muted });
    // Mute camera: live camera tracks muted now, and the camera source taken away on the server.
    let r = await post("video");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ muted: 1, hostMuted: true, sources: ["microphone"], inRoom: true });
    expect(provider!.muted.at(-1)).toEqual({ room: "sm-room", identity: GUEST, kind: "video" });
    expect(provider!.sources.at(-1)).toEqual({ room: "sm-room", identity: GUEST, sources: ["microphone"] });
    // Mute microphone too: nothing left to publish.
    r = await post("audio", true);
    expect(r.body).toMatchObject({ muted: 1, sources: [] });
    expect(provider!.sources.at(-1)!.sources).toEqual([]);
    // A rejoin while muted gets a token that cannot publish anything.
    store.broadcast = [];
    const rejoin = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(rejoin.status).toBe(200);
    expect(rejoin.body).toMatchObject({ canPublish: false, publishSources: [] });
    expect(provider!.issued.at(-1)).toMatchObject({ canPublish: false });
    // Unmute camera: the permission comes back; nothing is switched on remotely (no new mute calls, no unmute call).
    const mutesBefore = provider!.muted.length;
    r = await post("video", false);
    expect(r.body).toMatchObject({ muted: 0, hostMuted: false, sources: ["camera"] });
    expect(provider!.muted).toHaveLength(mutesBefore);
    expect(provider!.sources.at(-1)!.sources).toEqual(["camera"]);
    const rejoinCamera = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(rejoinCamera.body).toMatchObject({ canPublish: true, publishSources: ["camera"] });
    expect(provider!.issued.at(-1)).toMatchObject({ canPublish: true, publishSources: ["camera"] });
    // Unmute microphone: both sources back.
    r = await post("audio", false);
    expect(r.body.sources).toEqual(["camera", "microphone"]);
    // Muting someone who is not a guest is refused without touching the media server.
    store.isGuest = false;
    const sourcesBefore = provider!.sources.length;
    r = await post("video");
    expect(r.status).toBe(409);
    expect(provider!.sources).toHaveLength(sourcesBefore);
    // Invalid body.
    expect((await post("screen" as "video")).status).toBe(400);
  });

  it("a creator's broadcaster token can publish camera and microphone; viewers publish nothing", async () => {
    const { app, store, provider } = setup();
    store.creator = true;
    store.broadcast = [];
    const b = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(b.body).toMatchObject({ canPublish: true, publishSources: ["camera", "microphone"] });
    const v = await request(app).post(`/api/v1/live/streams/${STREAM}/join`).set(auth).send({ as: "viewer" });
    expect(v.body).toMatchObject({ canPublish: false, publishSources: [] });
    expect(provider!.issued.at(-1)).toMatchObject({ canPublish: false });
  });

  it("treats a missing country header as unknown (fails closed)", async () => {
    const { app, store } = setup({ countryHeader: null });
    await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .set("cf-ipcountry", "US")
      .send({ as: "viewer" });
    expect(store.countries).toEqual([null]);
  });

  it("lets a broadcaster connect before going live but not with other problems", async () => {
    const { app, store, provider } = setup();
    store.broadcast = ["stream_not_live"];
    const ok = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(ok.status).toBe(200);
    expect(provider!.issued[0].canPublish).toBe(true);
    store.broadcast = ["age_not_verified"];
    const no = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "broadcaster" });
    expect(no.status).toBe(403);
  });

  it("validates input", async () => {
    const { app } = setup();
    expect(
      (await request(app).post("/api/v1/live/streams/not-a-uuid/join").set(auth).send({ as: "viewer" }))
        .status,
    ).toBe(400);
    expect(
      (await request(app).post(`/api/v1/live/streams/${STREAM}/join`).set(auth).send({ as: "admin" })).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/api/v1/live/streams/${STREAM}/join`)
          .set(auth)
          .send({ as: "viewer", room: "x" })
      ).status,
    ).toBe(400);
  });

  it("returns 503 when the stream's provider has no credentials on this server", async () => {
    const { app } = setup({ provider: null });
    const res = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/join`)
      .set(auth)
      .send({ as: "viewer" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/isn't set up/);
  });

  it("joins private audio sessions with microphone-only publishing", async () => {
    const { app, provider } = setup();
    const res = await request(app).post(`/api/v1/live/sessions/${SESSION}/join`).set(auth).send({});
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("audio");
    expect(provider!.issued[0]).toMatchObject({ canPublish: true, audioOnly: true, room: "ps-room" });
  });

  it("shows viewer counts only to people who may watch", async () => {
    const { app, store, provider } = setup();
    provider!.stats.set("sm-room", { participants: 7, publishers: 2 });
    const res = await request(app).get(`/api/v1/live/streams/${STREAM}/stats`).set(auth);
    expect(res.body).toEqual({ status: "live", viewers: 5 });
    store.watch = ["viewer_age_not_verified"];
    expect((await request(app).get(`/api/v1/live/streams/${STREAM}/stats`).set(auth)).status).toBe(403);
  });

  it("terminates streams for moderators and closes the provider room", async () => {
    const { app, store, provider } = setup();
    const denied = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/terminate`)
      .set(auth)
      .send({ reason: "Policy violation" });
    expect(denied.status).toBe(403);
    expect(provider!.closed).toHaveLength(0);
    store.moderator = true;
    const res = await request(app)
      .post(`/api/v1/live/streams/${STREAM}/terminate`)
      .set(auth)
      .send({ reason: "Policy violation" });
    expect(res.body).toEqual({ terminated: true, roomClosed: true });
    expect(store.terminated).toEqual([STREAM]);
    expect(provider!.closed).toEqual(["sm-room"]);
  });

  it("emergency stop closes every live room", async () => {
    const { app, store, provider } = setup();
    store.moderator = true;
    const res = await request(app)
      .post("/api/v1/live/emergency-stop")
      .set(auth)
      .send({ on: true, reason: "Incident" });
    expect(res.body).toEqual({ emergencyStop: true, roomsClosed: 1, roomsFailed: [] });
    expect(store.emergency).toBe(true);
    expect(provider!.closed).toEqual(["sm-room"]);
  });

  it("reports stream health to moderators", async () => {
    const { app, store, provider } = setup();
    store.moderator = true;
    provider!.stats.set("sm-room", { participants: 3, publishers: 0 });
    const res = await request(app).get("/api/v1/live/admin/health").set(auth);
    expect(res.body.streams[0]).toMatchObject({ streamId: STREAM, status: "no_broadcaster", viewers: 3 });
  });

  it("shows admins which providers are configured, never their secrets", async () => {
    const reg = buildRegistry({
      LIVEKIT_URL: "wss://x",
      LIVEKIT_API_KEY: "key-id",
      LIVEKIT_API_SECRET: SECRET,
    });
    const store = new FakeLiveStore();
    const app = createApp({
      config,
      verifyToken: verifier,
      storeFor: () => new MemoryProfileStore(),
      live: { liveStoreFor: () => store, providers: reg, countryHeader: null },
    });
    expect((await request(app).get("/api/v1/live/admin/providers").set(auth)).status).toBe(403);
    store.admin = true;
    const res = await request(app).get("/api/v1/live/admin/providers").set(auth);
    expect(res.body).toEqual({ providers: [{ key: "livekit", configured: true }] });
    expect(JSON.stringify(res.body)).not.toMatch(/key-id|test-secret/);
  });
});

describe("live configuration", () => {
  it("accepts LiveKit settings and rejects unsafe values without echoing secrets", () => {
    const ok = loadConfig({
      NODE_ENV: "test",
      LIVEKIT_URL: "wss://x.livekit.cloud",
      LIVEKIT_API_KEY: "k",
      LIVEKIT_API_SECRET: SECRET,
      LIVE_COUNTRY_HEADER: "cf-ipcountry",
    });
    expect(ok.LIVE_COUNTRY_HEADER).toBe("cf-ipcountry");
    expect(() => loadConfig({ NODE_ENV: "test", LIVEKIT_URL: "http://insecure" })).toThrow(/LIVEKIT_URL/);
    try {
      loadConfig({ NODE_ENV: "test", LIVEKIT_API_SECRET: "short-secret" });
      throw new Error("should have failed");
    } catch (e) {
      expect(String(e)).toMatch(/LIVEKIT_API_SECRET/);
      expect(String(e)).not.toContain("short-secret");
    }
  });

  it("refuses empty, short, repetitive or whitespace LiveKit secrets without echoing them", () => {
    for (const weak of [
      "",
      "0123456789abcdefghijklmnopqrstu", // 31 characters
      "a".repeat(64), // long but guessable
      "abababababababababababababababab", // 32 characters, 2 distinct
      "abcdefghij klmnopqrstuvwxyz012345", // whitespace
    ]) {
      let message = "";
      try {
        loadConfig({ NODE_ENV: "test", LIVEKIT_API_SECRET: weak });
      } catch (e) {
        message = String(e);
      }
      expect(message, `accepted ${JSON.stringify(weak)}`).toMatch(/LIVEKIT_API_SECRET/);
      if (weak) expect(message).not.toContain(weak);
    }
    // A LiveKit-generated style secret (43 characters) is accepted, and so is the test fixture.
    const generated = "Zq3xK9pW2mT7vL4nB8cR1sD6fG0hJ5aE3yU9iO2kQwE";
    expect(loadConfig({ NODE_ENV: "test", LIVEKIT_API_SECRET: generated }).LIVEKIT_API_SECRET).toBe(
      generated,
    );
    expect(loadConfig({ NODE_ENV: "test", LIVEKIT_API_SECRET: SECRET }).LIVEKIT_API_SECRET).toBe(SECRET);
  });
});
