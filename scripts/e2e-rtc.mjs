/* global document, window -- used inside page.evaluate() / init scripts, which run in the browser */
// Real-time media end-to-end test: voice calls, video calls, public broadcast, viewers, chat, guests, removal and
// webhooks, through a REAL LiveKit server and the REAL RentMate API code, in real Chromium with fake camera and
// microphone devices. Only Supabase is replaced by a small in-memory stand-in (the database rules themselves are tested
// by the SQL suites in npm run test:db). Never touches a real account, database or provider.
//
// Needs: a LiveKit server (LIVEKIT_TEST_URL, default ws://127.0.0.1:7880) with key LIVEKIT_TEST_KEY / secret
// LIVEKIT_TEST_SECRET and a webhook pointing at http://127.0.0.1:4555/api/v1/live/webhook, plus Playwright.
// Run: npm run test:e2e:rtc   (CI starts livekit-server in the rtc job.)
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error(
    "Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium",
  );
  process.exit(1);
}

const root = new URL("..", import.meta.url).pathname;
const LK_URL = process.env.LIVEKIT_TEST_URL ?? "ws://127.0.0.1:7880";
const LK_KEY = process.env.LIVEKIT_TEST_KEY ?? "rmtestkey";
const LK_SECRET = process.env.LIVEKIT_TEST_SECRET ?? "rm-local-test-secret-0123456789abcdef";
const API_PORT = 4555;
const SB_PORT = 54400;
const WEB_PORT = 54401;
let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, step = 250) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* keep waiting */
    }
    await sleep(step);
  }
  return last;
}

// ---------- Builds ----------
const work = mkdtempSync(join(tmpdir(), "rentmate-rtc-"));
execFileSync("npm", ["run", "build", "-w", "apps/api"], { cwd: root, stdio: "inherit" });
const webDir = join(work, "web");
execFileSync("npx", ["vite", "build", "--outDir", webDir, "--emptyOutDir", "--logLevel", "error"], {
  cwd: join(root, "apps/web"),
  env: {
    ...process.env,
    VITE_SUPABASE_URL: `http://127.0.0.1:${SB_PORT}`,
    VITE_SUPABASE_ANON_KEY: "test-publishable-key",
    VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
  },
  stdio: "inherit",
});
const { createApp } = await import(join(root, "apps/api/dist/app.js"));
const { LiveKitProvider, signJwt } = await import(join(root, "apps/api/dist/live/providers.js"));
const { drainKicks } = await import(join(root, "apps/api/dist/live/webhook.js"));

// ---------- In-memory data (stand-in for Supabase) ----------
const U = {
  asha: randomUUID(),
  bina: randomUUID(),
  chen: randomUUID(), // outsider
  cara: randomUUID(), // creator
  gia: randomUUID(), // guest creator
  vik: randomUUID(), // viewer
};
const NAMES = {
  [U.asha]: "Asha",
  [U.bina]: "Bina",
  [U.chen]: "Chen",
  [U.cara]: "Cara",
  [U.gia]: "Gia",
  [U.vik]: "Vik",
};
const db = {
  call_sessions: [],
  live_streams: [],
  creators: [
    { user_id: U.cara, stage_name: "Cara Sings", status: "approved" },
    { user_id: U.gia, stage_name: "Gia Guitar", status: "approved" },
  ],
  live_chat_messages: [],
  live_reactions: [],
  live_guest_invites: [],
  live_reports: [],
  blocks: [],
  performer_consents: [],
};
const kicks = [];
const webhookEvents = [];
let kickId = 1;

const newCall = (caller, callee, mode) => {
  const row = {
    id: randomUUID(),
    caller_id: caller,
    callee_id: callee,
    mode,
    status: "ringing",
    room_name: `call-${randomUUID().replace(/-/g, "")}`,
    created_at: new Date().toISOString(),
    answered_at: null,
    ended_at: null,
    end_reason: null,
  };
  db.call_sessions.push(row);
  return row;
};
const stream = {
  id: randomUUID(),
  title: "Evening songs",
  category: "music",
  status: "scheduled",
  creator_id: U.cara,
  participants: [],
  room_name: `sm-${randomUUID().replace(/-/g, "")}`,
  provider_key: "livekit",
  started_at: null,
  scheduled_at: null,
};
db.live_streams.push(stream);

// Minimal PostgREST: eq / gt / gte / in / ilike filters, order, limit, single-object responses.
function filterRows(rows, params) {
  let out = rows.slice();
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    if (op === "eq") out = out.filter((r) => String(r[k]) === val);
    else if (op === "gt") out = out.filter((r) => String(r[k]) > val);
    else if (op === "gte") out = out.filter((r) => String(r[k]) >= val);
    else if (op === "in") {
      const set = val
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((s) => s.replace(/"/g, ""));
      out = out.filter((r) => set.includes(String(r[k])));
    } else if (op === "ilike") {
      const needle = val.replace(/[%*]/g, "").toLowerCase();
      out = out.filter((r) => String(r[k]).toLowerCase().includes(needle));
    }
  }
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1));
  }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

function userOf(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.replace(/^Bearer /, "");
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub ?? null;
  } catch {
    return null;
  }
}

const RPC = {
  call_answer(me, { p_call, p_accept }) {
    const c = db.call_sessions.find((x) => x.id === p_call);
    if (!c || c.callee_id !== me) throw Object.assign(new Error("Call not found."), { code: "42501" });
    if (c.status !== "ringing") return c.status;
    c.status = p_accept ? "accepted" : "rejected";
    c.answered_at = new Date().toISOString();
    return c.status;
  },
  profiles_by_ids(_me, { ids }) {
    return ids.map((id) => ({ id, display_name: NAMES[id] ?? "Member" }));
  },
  live_start_stream(me, { p_stream }) {
    const s = db.live_streams.find((x) => x.id === p_stream);
    if (!s || s.creator_id !== me) return ["only_the_creator_can_start"];
    s.status = "live";
    s.started_at = new Date().toISOString();
    return [];
  },
  live_react(me, { p_stream, p_kind }) {
    db.live_reactions.push({
      id: db.live_reactions.length + 1,
      stream_id: p_stream,
      user_id: me,
      kind: p_kind,
      created_at: new Date().toISOString(),
    });
    return null;
  },
  live_answer_guest_invite(me, { p_invite, p_accept }) {
    const i = db.live_guest_invites.find((x) => x.id === p_invite && x.guest_id === me);
    if (!i) throw Object.assign(new Error("Invitation not found."), { code: "42501" });
    i.status = p_accept ? "accepted" : "declined";
    if (p_accept) stream.participants.push(me);
    return null;
  },
  live_give_consent(me, { p_stream }) {
    db.performer_consents.push({ stream_id: p_stream, participant_id: me });
    return null;
  },
};

const sb = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "content-range");
  if (req.method === "OPTIONS") return res.end();
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const me = userOf(req);
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
    if (rpc) {
      const fn = RPC[rpc[1]];
      if (!fn) return send(200, null);
      try {
        return send(200, fn(me, raw ? JSON.parse(raw) : {}));
      } catch (e) {
        return send(403, { code: e.code ?? "P0001", message: e.message });
      }
    }
    const table = /^\/rest\/v1\/(\w+)$/.exec(url.pathname)?.[1];
    if (table && db[table]) {
      if (req.method === "POST") {
        const rows = [].concat(JSON.parse(raw || "[]"));
        for (const r of rows) {
          if (table === "live_chat_messages")
            Object.assign(r, { id: randomUUID(), created_at: new Date().toISOString(), hidden_at: null });
          db[table].push(r);
        }
        return send(201, undefined);
      }
      let rows = filterRows(db[table], url.searchParams);
      // Mirrors the "calls read own" RLS policy (proven in supabase/tests/calls_and_live_rooms.sql).
      if (table === "call_sessions") rows = rows.filter((c) => [c.caller_id, c.callee_id].includes(me));
      if (table === "live_chat_messages")
        rows = rows.filter(
          (m) => !db.blocks.some((b) => b.blocker_id === me && b.blocked_id === m.sender_id),
        );
      if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
        return rows.length === 1 ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "0 rows" });
      }
      return send(200, rows);
    }
    return send(404, { message: "not found" });
  });
});
await new Promise((r) => sb.listen(SB_PORT, "127.0.0.1", r));

// ---------- The RentMate API (real code), with a live store over the in-memory data ----------
const provider = new LiveKitProvider({ url: LK_URL, apiKey: LK_KEY, apiSecret: LK_SECRET });
const liveStore = (me) => ({
  roles: async () => [],
  listStreams: async () =>
    db.live_streams
      .filter(
        (s) =>
          ["live", "scheduled"].includes(s.status) &&
          !db.blocks.some((b) => b.blocker_id === me && b.blocked_id === s.creator_id),
      )
      .map((s) => ({
        id: s.id,
        creatorId: s.creator_id,
        stageName: "Cara Sings",
        title: s.title,
        category: s.category,
        explicit: false,
        status: s.status,
        scheduledAt: null,
        startedAt: s.started_at,
      })),
  broadcastCheck: async (id) => {
    const s = db.live_streams.find((x) => x.id === id);
    return s && (s.creator_id === me || s.participants.includes(me))
      ? s.status === "live"
        ? []
        : ["stream_not_live"]
      : ["not_your_stream"];
  },
  watchCheck: async (id) => {
    const s = db.live_streams.find((x) => x.id === id);
    if (!s) return ["stream_not_found"];
    if (
      db.blocks.some(
        (b) =>
          (b.blocker_id === me && b.blocked_id === s.creator_id) ||
          (b.blocker_id === s.creator_id && b.blocked_id === me),
      )
    )
      return ["blocked"];
    return s.status === "live" ? [] : ["stream_not_live"];
  },
  streamRoom: async (id) => {
    const s = db.live_streams.find((x) => x.id === id);
    return s
      ? {
          roomName: s.room_name,
          providerKey: "livekit",
          creatorId: s.creator_id,
          explicit: false,
          status: s.status,
        }
      : null;
  },
  sessionCheck: async () => ["session_not_found"],
  sessionRoom: async () => null,
  terminateStream: async () => undefined,
  terminateSession: async () => undefined,
  setEmergencyStop: async () => undefined,
  adminStreams: async () => [],
  callCheck: async (id) => {
    const c = db.call_sessions.find((x) => x.id === id);
    if (!c || ![c.caller_id, c.callee_id].includes(me)) return ["call_not_found"];
    const ok = c.status === "accepted" || (c.status === "ringing" && me === c.caller_id);
    return ok ? [] : ["call_not_active"];
  },
  callRoom: async (id) => {
    const c = db.call_sessions.find((x) => x.id === id && [x.caller_id, x.callee_id].includes(me));
    return c
      ? {
          roomName: c.room_name,
          mode: c.mode,
          status: c.status,
          callerId: c.caller_id,
          calleeId: c.callee_id,
        }
      : null;
  },
  callHangup: async (id) => {
    const c = db.call_sessions.find((x) => x.id === id && [x.caller_id, x.callee_id].includes(me));
    if (!c) throw new Error("Call not found.");
    c.status = c.status === "ringing" ? (me === c.caller_id ? "cancelled" : "rejected") : "ended";
    c.ended_at = new Date().toISOString();
    return c.room_name;
  },
  viewerCap: async () => 300,
  hostCheck: async (id) => db.live_streams.some((s) => s.id === id && s.creator_id === me),
  removeGuest: async (id, guest) => {
    const s = db.live_streams.find((x) => x.id === id);
    if (!s || s.creator_id !== me) throw new Error("Not allowed.");
    s.participants = s.participants.filter((g) => g !== guest);
    for (const i of db.live_guest_invites)
      if (i.guest_id === guest && i.stream_id === id) i.status = "removed";
    kicks.push({ id: kickId++, roomName: s.room_name, identity: guest, reason: "removed_by_host" });
  },
  endStream: async (id) => {
    const s = db.live_streams.find((x) => x.id === id && x.creator_id === me);
    if (s) s.status = "ended";
  },
});
const integration = {
  ingest: async (event) => {
    if (webhookEvents.some((e) => e.id === event.id)) return { kick: false, duplicate: true };
    webhookEvents.push(event);
    // Same rule as private.room_allowed: in a call room only its two parties may stay.
    const room = event.room?.name ?? "";
    const who = event.participant?.identity;
    const call = db.call_sessions.find((c) => c.room_name === room);
    const kick =
      event.event === "participant_joined" && call ? ![call.caller_id, call.callee_id].includes(who) : false;
    return { kick, duplicate: false };
  },
  claimKicks: async () => kicks.splice(0, kicks.length),
  doneKicks: async () => undefined,
};
const providers = new Map([["livekit", provider]]);
const app = createApp({
  config: { NODE_ENV: "test", PORT: API_PORT, CORS_ORIGINS: [`http://127.0.0.1:${WEB_PORT}`] },
  verifyToken: async (token) => {
    try {
      const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
      return sub ? { id: sub } : null;
    } catch {
      return null;
    }
  },
  storeFor: () => ({
    upsertProfile: async () => undefined,
    getProfile: async () => null,
    listCandidates: async () => [],
  }),
  live: { providers, countryHeader: null, liveStoreFor: (req) => liveStore(req.user.id) },
  webhook: { providers, integration },
});
const api = await new Promise((r) => {
  const s = app.listen(API_PORT, "127.0.0.1", () => r(s));
});

// ---------- Static web server (SPA fallback) ----------
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
};
const web = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  let file = join(webDir, path);
  if (!file.startsWith(webDir) || !existsSync(file) || path === "/") file = join(webDir, "index.html");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => web.listen(WEB_PORT, "127.0.0.1", r));

// ---------- Browsers ----------
const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const pageErrors = [];
function fakeJwt(sub) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "none", typ: "JWT" })}.${b({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
}
async function personPage(who, { media = true, viewport } = {}) {
  const context = await browser.newContext({
    permissions: media ? ["microphone", "camera"] : [],
    viewport: viewport ?? { width: 1280, height: 800 },
  });
  const token = fakeJwt(U[who]);
  const session = {
    access_token: token,
    refresh_token: "test-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: U[who],
      aud: "authenticated",
      role: "authenticated",
      email: `${who}@rtc.test`,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["sb-127-auth-token", JSON.stringify(session)],
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${who}: ${e.message}`));
  return { context, page };
}
const base = `http://127.0.0.1:${WEB_PORT}/`;
const text = (page, sel) =>
  page
    .locator(sel)
    .first()
    .innerText()
    .catch(() => "");
const mediaState = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const src = el && el.srcObject;
    if (!src) return { attached: false };
    const tracks = src.getTracks();
    return {
      attached: true,
      live: tracks.some((t) => t.readyState === "live" && !t.muted),
      width: el.videoWidth ?? 0,
      kinds: tracks.map((t) => t.kind),
    };
  }, sel);

try {
  // ===== 1. LiveKit enforces token validity itself (expired and foreign tokens) =====
  const nowS = Math.floor(Date.now() / 1000);
  const twirp = (token) =>
    fetch(`${LK_URL.replace(/^ws/, "http")}/twirp/livekit.RoomService/ListRooms`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}",
    }).then((r) => r.status);
  const valid = signJwt({ iss: LK_KEY, nbf: nowS - 5, exp: nowS + 60, video: { roomList: true } }, LK_SECRET);
  const expired = signJwt(
    { iss: LK_KEY, nbf: nowS - 120, exp: nowS - 60, video: { roomList: true } },
    LK_SECRET,
  );
  const foreign = signJwt(
    { iss: LK_KEY, nbf: nowS - 5, exp: nowS + 60, video: { roomList: true } },
    "some-other-secret-0123456789",
  );
  check("LiveKit accepts a valid server token", (await twirp(valid)) === 200);
  check("LiveKit rejects an expired token", (await twirp(expired)) === 401);
  check("LiveKit rejects a token signed with another secret", (await twirp(foreign)) === 401);

  // ===== 2. Voice call =====
  const asha = await personPage("asha");
  const bina = await personPage("bina", { viewport: { width: 390, height: 844 } });
  const voice = newCall(U.asha, U.bina, "voice");
  await bina.page.goto(`${base}#live`); // any screen: the incoming-call banner is global
  await asha.page.goto(`${base}#call/${voice.id}`);
  check(
    "voice: caller sees ringing",
    Boolean(await until(async () => (await text(asha.page, ".call-status")) === "Ringing…")),
  );
  const banner = await until(() => bina.page.locator(".incoming-call").isVisible());
  check("voice: callee gets an incoming-call notification", Boolean(banner), "no banner");
  check(
    "voice: banner names the caller and the call type",
    /Asha[\s\S]*voice call/i.test(await text(bina.page, ".incoming-call")),
  );
  await bina.page.getByRole("button", { name: "Accept" }).click();
  await until(() => bina.page.url().includes(`#call/${voice.id}`));
  const bothConnected = await until(
    async () =>
      /^\d+:\d\d$/.test(await text(asha.page, ".call-status")) &&
      /^\d+:\d\d$/.test(await text(bina.page, ".call-status")),
    20000,
  );
  check(
    "voice: both sides reach connected with a running duration",
    Boolean(bothConnected),
    `${await text(asha.page, ".call-status")} / ${await text(bina.page, ".call-status")}`,
  );
  const heard = await until(
    async () => (await mediaState(bina.page, "[data-testid=remote-audio]")).live,
    15000,
  );
  check("voice: callee receives the caller's live audio over WebRTC", Boolean(heard));
  const heardBack = await until(
    async () => (await mediaState(asha.page, "[data-testid=remote-audio]")).live,
    15000,
  );
  check("voice: caller receives the callee's live audio", Boolean(heardBack));
  check(
    "voice: no camera is published on a voice call",
    (await asha.page.locator("[data-testid=local-video]").count()) === 0,
  );
  await asha.page.getByRole("button", { name: "Mute" }).click();
  const mutedRemote = await until(
    async () => !(await mediaState(bina.page, "[data-testid=remote-audio]")).attached,
    10000,
  );
  check("voice: muting stops the audio the other side receives", Boolean(mutedRemote));
  await asha.page.getByRole("button", { name: "Unmute" }).click();
  check(
    "voice: unmuting restores it",
    Boolean(await until(async () => (await mediaState(bina.page, "[data-testid=remote-audio]")).live, 10000)),
  );
  const d1 = await text(asha.page, ".call-status");
  await sleep(2200);
  const d2 = await text(asha.page, ".call-status");
  check("voice: the duration counts up", d1 !== d2 && /^\d+:\d\d$/.test(d2), `${d1} → ${d2}`);
  await bina.page.getByRole("button", { name: "End call" }).click();
  check(
    "voice: hanging up ends the call for the other person too (room closed by the server)",
    Boolean(await until(async () => /Call ended/.test(await text(asha.page, ".call-screen")), 15000)),
  );
  check("voice: the call record is ended", voice.status === "ended");

  // Webhooks from the real LiveKit server reached the API, verified (signature + body hash).
  const evs = await until(() => {
    const room = webhookEvents.filter((e) => e.room?.name === voice.room_name);
    return room.some((e) => e.event === "room_finished") ? room : null;
  }, 20000);
  const kinds = (evs ?? []).map(
    (e) =>
      `${e.event}:${e.participant?.identity === U.asha ? "asha" : e.participant?.identity === U.bina ? "bina" : ""}`,
  );
  check(
    "webhooks: signed LiveKit events (joined, left, room finished) were verified and recorded",
    ["participant_joined:asha", "participant_joined:bina", "room_finished:"].every((k) => kinds.includes(k)),
    kinds.join(","),
  );

  // ===== 3. Video call =====
  const video = newCall(U.bina, U.asha, "video");
  await asha.page.goto(`${base}#live`);
  await bina.page.goto(`${base}#call/${video.id}`);
  await until(() => asha.page.locator(".incoming-call").isVisible());
  await asha.page.getByRole("button", { name: "Accept" }).click();
  const seesVideo = await until(
    async () => (await mediaState(asha.page, "[data-testid=remote-video]")).width > 0,
    20000,
  );
  check(
    "video: each side sees the other's camera (decoded frames)",
    Boolean(seesVideo) &&
      Boolean(
        await until(async () => (await mediaState(bina.page, "[data-testid=remote-video]")).width > 0, 15000),
      ),
  );
  check(
    "video: local preview shows my own camera",
    (await mediaState(asha.page, "[data-testid=local-video]")).width > 0,
  );
  await bina.page.getByRole("button", { name: "Camera off" }).click();
  check(
    "video: turning the camera off shows 'Camera off' to the other side",
    Boolean(await until(async () => /Camera off/.test(await text(asha.page, ".call-stage")), 10000)),
  );
  await bina.page.getByRole("button", { name: "Camera on" }).click();
  check(
    "video: turning it back on restores the picture",
    Boolean(
      await until(async () => (await mediaState(asha.page, "[data-testid=remote-video]")).width > 0, 10000),
    ),
  );
  const mobileOverflow = await bina.page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  check("video: phone layout (390 px) has no horizontal scrolling", !mobileOverflow);
  // Network interruption: the signalling connection drops and comes back.
  await asha.context.setOffline(true);
  const sawReconnect = await until(
    async () => /Reconnecting/.test(await text(asha.page, ".call-status")),
    20000,
    200,
  );
  await asha.context.setOffline(false);
  const backAgain = await until(async () => /^\d+:\d\d$/.test(await text(asha.page, ".call-status")), 30000);
  check(
    "video: a network interruption shows 'Reconnecting…' and the call recovers",
    Boolean(sawReconnect) && Boolean(backAgain),
    `reconnect=${Boolean(sawReconnect)} recovered=${Boolean(backAgain)}`,
  );
  await asha.page.getByRole("button", { name: "End call" }).click();
  check(
    "video: ending closes it for both",
    Boolean(await until(async () => /Call ended/.test(await text(bina.page, ".call-screen")), 15000)),
  );

  // ===== 4. Declined call and an outsider =====
  const declined = newCall(U.asha, U.bina, "voice");
  await bina.page.goto(`${base}#live`);
  await asha.page.goto(`${base}#call/${declined.id}`);
  await until(() => bina.page.locator(".incoming-call").isVisible());
  await bina.page.getByRole("button", { name: "Decline" }).click();
  check(
    "decline: the caller is told the call was declined",
    Boolean(await until(async () => /declined/.test(await text(asha.page, ".call-screen")), 10000)),
  );
  const chen = await personPage("chen");
  const target = newCall(U.asha, U.bina, "voice");
  await chen.page.goto(`${base}#call/${target.id}`);
  check(
    "outsider: someone else cannot open or join a call",
    Boolean(
      await until(
        async () => /doesn't exist|isn't allowed|failed/i.test(await text(chen.page, ".call-screen")),
        10000,
      ),
    ),
  );
  target.status = "cancelled";

  // ===== 5. Permission denied =====
  // What the browser reports when the person refuses (or has blocked) microphone and camera access.
  // Without media permission Chromium hides local IPs behind mDNS names, which a loopback-only test server cannot
  // resolve (real deployments use public or TURN candidates). Turn that off so only the permission path is tested.
  const noMediaBrowser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
  const ctx = await noMediaBrowser.newContext();
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  const deniedSession = {
    access_token: fakeJwt(U.asha),
    refresh_token: "r",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: U.asha,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
  await ctx.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    ["sb-127-auth-token", JSON.stringify(deniedSession)],
  );
  const deniedPage = await ctx.newPage();
  const dcall = newCall(U.asha, U.bina, "video");
  await deniedPage.goto(`${base}#call/${dcall.id}`);
  check(
    "permissions: a blocked microphone/camera shows how to allow it",
    Boolean(
      await until(
        async () => /can't use your microphone or camera/i.test(await text(deniedPage, ".call-screen")),
        20000,
      ),
    ),
    await text(deniedPage, ".call-screen"),
  );
  await noMediaBrowser.close();
  dcall.status = "cancelled";

  // ===== 6. Broadcast, viewers, chat, guests, removal =====
  const cara = await personPage("cara");
  await cara.page.goto(`${base}#broadcast/${stream.id}`);
  check(
    "broadcast: the creator gets a camera preview before going live",
    Boolean(
      await until(async () => (await mediaState(cara.page, "[data-testid=preview-video]")).width > 0, 20000),
    ),
  );
  check(
    "broadcast: nothing is live during preview",
    stream.status === "scheduled" && /Preview/.test(await text(cara.page, "[data-testid=broadcast-status]")),
  );
  await cara.page.getByRole("button", { name: "Go live" }).click();
  check(
    "broadcast: Go live starts the stream and publishes",
    Boolean(
      await until(async () => (await text(cara.page, "[data-testid=broadcast-status]")) === "LIVE", 20000),
    ) && stream.status === "live",
  );

  const vik = await personPage("vik", { viewport: { width: 360, height: 780 } });
  await vik.page.goto(`${base}#live`);
  const link = await until(() => vik.page.locator("[data-testid=live-stream-link]").isVisible(), 15000);
  check("viewer: the live stream appears in live discovery", Boolean(link));
  await vik.page.locator("[data-testid=live-stream-link]").first().click();
  check(
    "viewer: watches the creator's video and audio",
    Boolean(
      await until(async () => (await mediaState(vik.page, "[data-testid=live-video]")).width > 0, 20000),
    ),
  );
  check(
    "viewer: phone layout (360 px) has no horizontal scrolling",
    !(await vik.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
  );
  check(
    "broadcast: the creator sees the viewer count from the media server",
    Boolean(
      await until(
        async () => /1 watching/.test(await text(cara.page, "[data-testid=broadcast-viewers]")),
        20000,
      ),
    ),
    await text(cara.page, "[data-testid=broadcast-viewers]"),
  );
  await vik.page.getByLabel("Chat message").fill("Lovely song!");
  await vik.page.getByRole("button", { name: "Send" }).click();
  check(
    "chat: the creator sees a viewer's message",
    Boolean(await until(async () => /Lovely song!/.test(await text(cara.page, ".live-chat-list")), 10000)),
  );
  await vik.page.getByRole("button", { name: "Love it" }).click();
  check(
    "reactions: a viewer's reaction is recorded",
    Boolean(
      await until(() => db.live_reactions.some((r) => r.user_id === U.vik && r.kind === "heart"), 5000),
    ),
  );
  await vik.page.getByRole("button", { name: "Report" }).click();
  await vik.page.getByRole("button", { name: "Harassment or bullying" }).click();
  check(
    "report: viewers can report a live stream",
    Boolean(
      await until(
        () => db.live_reports.some((r) => r.reporter_id === U.vik && r.reason === "harassment"),
        5000,
      ),
    ),
  );

  // Guest: invited, accepts (with consent), joins as a co-host.
  db.live_guest_invites.push({ id: randomUUID(), stream_id: stream.id, guest_id: U.gia, status: "invited" });
  const gia = await personPage("gia");
  await gia.page.goto(`${base}#live`);
  await until(() => gia.page.getByRole("button", { name: "Accept" }).isVisible(), 10000);
  await gia.page.getByRole("button", { name: "Accept" }).click();
  check(
    "guest: accepting records consent and opens the studio",
    Boolean(await until(() => gia.page.url().includes(`#broadcast/${stream.id}`), 10000)) &&
      db.performer_consents.some((c) => c.participant_id === U.gia),
  );
  await until(async () => (await mediaState(gia.page, "[data-testid=preview-video]")).width > 0, 20000);
  await gia.page.getByRole("button", { name: "Join as guest" }).click();
  check(
    "guest: joins the broadcast as a publisher",
    Boolean(
      await until(async () => (await text(gia.page, "[data-testid=broadcast-status]")) === "LIVE", 20000),
    ),
  );
  check(
    "viewer: sees both the creator and the guest",
    Boolean(
      await until(async () => (await vik.page.locator("[data-testid=live-video]").count()) === 2, 20000),
    ),
    String(await vik.page.locator("[data-testid=live-video]").count()),
  );
  // Host mutes the guest's camera through the API → LiveKit MutePublishedTrack.
  const muteRes = await fetch(
    `http://127.0.0.1:${API_PORT}/api/v1/live/streams/${stream.id}/guests/${U.gia}/mute`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fakeJwt(U.cara)}` },
      body: JSON.stringify({ kind: "video" }),
    },
  ).then((r) => r.json());
  check(
    "host controls: muting a guest's camera mutes it on the media server",
    muteRes.muted === 1,
    JSON.stringify(muteRes),
  );
  const notHost = await fetch(
    `http://127.0.0.1:${API_PORT}/api/v1/live/streams/${stream.id}/guests/${U.cara}/mute`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fakeJwt(U.gia)}` },
      body: JSON.stringify({ kind: "audio" }),
    },
  );
  check("host controls: a guest cannot mute the host", notHost.status === 403);
  // Host removes the guest → queued removal → drained by the API → LiveKit RemoveParticipant.
  await fetch(`http://127.0.0.1:${API_PORT}/api/v1/live/streams/${stream.id}/guests/${U.gia}/remove`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${fakeJwt(U.cara)}` },
    body: "{}",
  });
  await drainKicks(providers, integration);
  check(
    "guest removal: the guest is disconnected at once",
    Boolean(await until(async () => /removed you/i.test(await text(gia.page, ".broadcast")), 15000)),
    await text(gia.page, "[data-testid=broadcast-status]"),
  );

  // A suspended or blocked viewer already in the room is removed (kick queue → LiveKit).
  kicks.push({ id: kickId++, roomName: stream.room_name, identity: U.vik, reason: "suspended" });
  await drainKicks(providers, integration);
  check(
    "safety: a viewer suspended mid-stream is removed from the room",
    Boolean(
      await until(async () => /removed from this stream/i.test(await text(vik.page, ".live-viewer")), 15000),
    ),
  );

  // End broadcast → room closed for everyone.
  const vik2 = await personPage("vik");
  await vik2.page.goto(`${base}#live/${stream.id}`);
  await until(async () => (await mediaState(vik2.page, "[data-testid=live-video]")).width > 0, 20000);
  await cara.page.getByRole("button", { name: "End broadcast" }).click();
  check(
    "broadcast: ending closes the room and viewers see it ended",
    Boolean(
      await until(async () => /Ended/.test(await text(vik2.page, "[data-testid=viewer-status]")), 15000),
    ) && stream.status === "ended",
  );
} catch (e) {
  check("unexpected error", false, e instanceof Error ? e.stack : String(e));
} finally {
  check("no uncaught JavaScript errors on any page", pageErrors.length === 0, pageErrors.join(" | "));
  console.log(results.join("\n"));
  console.log(failures ? `\n${failures} check(s) failed` : `\nall ${results.length} real-time checks passed`);
  await browser.close().catch(() => undefined);
  api.close();
  sb.close();
  web.close();
  rmSync(work, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}
