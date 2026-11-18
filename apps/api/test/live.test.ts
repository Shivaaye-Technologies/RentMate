import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { TokenVerifier } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { classifyHealth, explainProblems, refusalStatus, viewerCountry } from "../src/live/policy.js";
import { buildRegistry, LiveKitProvider, MemoryProvider, verifyJwt } from "../src/live/providers.js";
import { LiveStoreError, type AdminStream, type LiveStore, type StreamRoom } from "../src/live/store.js";
import { MemoryProfileStore } from "../src/store.js";

const SECRET = "test-secret-0123456789abcdef";
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
    expect(admin.video).toMatchObject({ roomAdmin: true, room: "sm-1" });
    expect(Number(admin.exp) - Math.floor(now() / 1000)).toBeLessThanOrEqual(60);
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
});
