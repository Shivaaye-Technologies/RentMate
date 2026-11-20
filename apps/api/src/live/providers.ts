import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** What a joining person is allowed to do in a room. */
export interface JoinGrant {
  room: string;
  /** Stable id for the person (their user id). */
  identity: string;
  displayName?: string;
  canPublish: boolean;
  /** Audio-only rooms (private audio sessions) publish the microphone only. */
  audioOnly?: boolean;
  /** When set, the only sources this person may publish (live guests a host has muted lose that source). */
  publishSources?: PublishSource[];
  ttlSeconds: number;
}

export type PublishSource = "camera" | "microphone";

export interface JoinToken {
  /** Where the browser connects (never a secret). */
  url: string;
  token: string;
  expiresAt: string;
}

export interface RoomStats {
  participants: number;
  publishers: number;
}

/**
 * Provider-independent streaming adapter. Implementations run on the server
 * only; they hold the provider credentials and never return them.
 */
export interface StreamingProvider {
  readonly key: string;
  /** True when the server has the credentials it needs. */
  readonly configured: boolean;
  issueToken(grant: JoinGrant): Promise<JoinToken>;
  /** Ends a room for everyone (moderation and emergency stop). */
  closeRoom(room: string): Promise<void>;
  roomStats(room: string): Promise<RoomStats | null>;
  /** Disconnects one person from a room now (blocking, suspension, guest removal). Missing = already gone. */
  removeParticipant(room: string, identity: string): Promise<void>;
  /** Mutes every published track of one kind for one person (host controls). Returns how many were muted. */
  muteParticipant(room: string, identity: string, kind: "audio" | "video"): Promise<number>;
  /**
   * Sets which sources a connected person may publish, enforced by the media server (host mutes). Tracks of a removed
   * source are taken down by the server and cannot be republished. Returns false when the person is not in the room.
   */
  setPublishSources(room: string, identity: string, sources: PublishSource[]): Promise<boolean>;
}

// ---------- JWT (HS256) ----------
//
// LiveKit access tokens are JWTs signed with HMAC-SHA256 (HS256) using the project's API secret; that is the format
// the LiveKit server verifies, so the algorithm cannot change without breaking every join. HMAC here is a message
// authentication code keyed with a server-side secret. It is not a password hash: no user password is ever passed
// to these functions, so slow password hashes (bcrypt, scrypt, Argon2) do not apply. See docs/SECURITY_NOTES_LIVEKIT_JWT.md.

const HS256_HEADER = JSON.stringify({ alg: "HS256", typ: "JWT" });

const b64url = (data: Buffer | string) =>
  Buffer.from(data).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** HMAC-SHA256 message authentication code over `header.body`, keyed with the API secret. */
const hs256Mac = (signingInput: string, apiSecret: string): Buffer =>
  createHmac("sha256", apiSecret).update(signingInput).digest();

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(HS256_HEADER);
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(hs256Mac(`${header}.${body}`, secret));
  return `${header}.${body}.${sig}`;
}

/**
 * Verifies and decodes an HS256 JWT (used by tests and for defence in depth). Returns null unless the token has three
 * parts, its header declares HS256 (so "alg: none" and algorithm-confusion tokens are refused), and the signature
 * matches in constant time. With `nowSeconds`, also refuses tokens that are expired (`exp`) or not yet valid (`nbf`).
 */
export function verifyJwt(
  token: string,
  secret: string,
  opts: { nowSeconds?: number } = {},
): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  if (!h || !b || !s) return null;
  try {
    const header = JSON.parse(fromB64url(h).toString("utf8")) as { alg?: unknown };
    if (header.alg !== "HS256") return null;
    const expected = hs256Mac(`${h}.${b}`, secret);
    const given = fromB64url(s);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload: unknown = JSON.parse(fromB64url(b).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const claims = payload as Record<string, unknown>;
    if (opts.nowSeconds !== undefined) {
      if (typeof claims.exp !== "number" || opts.nowSeconds >= claims.exp) return null;
      if (typeof claims.nbf === "number" && opts.nowSeconds < claims.nbf) return null;
    }
    return claims;
  } catch {
    return null;
  }
}

// ---------- Join grant checks ----------

/** Longest token lifetime the API will sign (callers use 600 s). */
export const MAX_TOKEN_TTL_SECONDS = 3600;
const NAME_MAX = 256;

/**
 * Defence in depth: callers pass a constant TTL, server-generated room names and the signed-in user's id, but the
 * signer refuses anything that would produce an expired, endless or malformed token if that ever changed.
 */
export function assertJoinGrant(g: Pick<JoinGrant, "room" | "identity" | "ttlSeconds">): void {
  if (!Number.isInteger(g.ttlSeconds) || g.ttlSeconds < 1 || g.ttlSeconds > MAX_TOKEN_TTL_SECONDS)
    throw new TypeError(`ttlSeconds must be a whole number from 1 to ${MAX_TOKEN_TTL_SECONDS}`);
  for (const [field, value] of [
    ["room", g.room],
    ["identity", g.identity],
  ] as const) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > NAME_MAX ||
      [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
    )
      throw new TypeError(`${field} must be 1-${NAME_MAX} characters without control characters`);
  }
}

// ---------- LiveKit ----------

/** The RoomService calls RentMate makes. */
export type RoomServiceMethod =
  | "DeleteRoom"
  | "ListParticipants"
  | "GetParticipant"
  | "RemoveParticipant"
  | "MutePublishedTrack"
  | "UpdateParticipant";

export interface LiveKitOptions {
  url: string;
  apiKey?: string;
  apiSecret?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

/** LiveKit (WebRTC SFU), cloud or self-hosted. Uses its documented token format and RoomService API. */
export class LiveKitProvider implements StreamingProvider {
  readonly key = "livekit";
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly opts: LiveKitOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  get configured(): boolean {
    return Boolean(this.opts.url && this.opts.apiKey && this.opts.apiSecret);
  }

  private requireCreds(): { apiKey: string; apiSecret: string } {
    if (!this.opts.apiKey || !this.opts.apiSecret) throw new ProviderNotConfigured(this.key);
    return { apiKey: this.opts.apiKey, apiSecret: this.opts.apiSecret };
  }

  async issueToken(g: JoinGrant): Promise<JoinToken> {
    const { apiKey, apiSecret } = this.requireCreds();
    assertJoinGrant(g);
    const nowS = Math.floor(this.now() / 1000);
    const exp = nowS + g.ttlSeconds;
    const token = signJwt(
      {
        iss: apiKey,
        sub: g.identity,
        name: g.displayName,
        nbf: nowS - 5,
        exp,
        jti: randomUUID(),
        video: {
          room: g.room,
          roomJoin: true,
          canSubscribe: true,
          canPublish: g.canPublish,
          canPublishData: false,
          canUpdateOwnMetadata: false,
          ...(g.canPublish && g.audioOnly ? { canPublishSources: ["microphone"] } : {}),
          ...(g.canPublish && !g.audioOnly && g.publishSources
            ? { canPublishSources: g.publishSources }
            : {}),
        },
      },
      apiSecret,
    );
    return { url: this.opts.url, token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /**
   * Short-lived (60 s) server token for one RoomService call, carrying only the grant LiveKit documents for that call:
   * DeleteRoom needs `roomCreate`; the participant calls need `roomAdmin` for that one room. `roomList` is never needed.
   */
  private adminToken(method: RoomServiceMethod, room: string): string {
    const { apiKey, apiSecret } = this.requireCreds();
    const nowS = Math.floor(this.now() / 1000);
    const video = method === "DeleteRoom" ? { roomCreate: true } : { roomAdmin: true, room };
    return signJwt({ iss: apiKey, nbf: nowS - 5, exp: nowS + 60, video }, apiSecret);
  }

  private async rpc(
    method: RoomServiceMethod,
    body: Record<string, unknown>,
    room: string,
  ): Promise<Response> {
    const base = this.opts.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
    return this.fetchFn(`${base}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.adminToken(method, room)}`,
      },
      body: JSON.stringify(body),
    });
  }

  async closeRoom(room: string): Promise<void> {
    const res = await this.rpc("DeleteRoom", { room }, room);
    // 404 = room already gone (nobody joined, or already closed): that's the goal anyway.
    if (!res.ok && res.status !== 404) throw new Error(`LiveKit DeleteRoom failed (${res.status})`);
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    const res = await this.rpc("RemoveParticipant", { room, identity }, room);
    // 404 = not in the room (or the room is gone): already the desired state.
    if (!res.ok && res.status !== 404) throw new Error(`LiveKit RemoveParticipant failed (${res.status})`);
  }

  async muteParticipant(room: string, identity: string, kind: "audio" | "video"): Promise<number> {
    const res = await this.rpc("GetParticipant", { room, identity }, room);
    if (res.status === 404) return 0;
    if (!res.ok) throw new Error(`LiveKit GetParticipant failed (${res.status})`);
    const info = (await res.json().catch(() => null)) as {
      tracks?: { sid?: string; type?: string | number; muted?: boolean }[];
    } | null;
    const wanted = kind === "audio" ? ["AUDIO", 0] : ["VIDEO", 1];
    let muted = 0;
    for (const t of info?.tracks ?? []) {
      if (!t.sid || !wanted.includes(t.type ?? "") || t.muted) continue;
      const m = await this.rpc("MutePublishedTrack", { room, identity, track_sid: t.sid, muted: true }, room);
      if (!m.ok) throw new Error(`LiveKit MutePublishedTrack failed (${m.status})`);
      muted++;
    }
    return muted;
  }

  async setPublishSources(room: string, identity: string, sources: PublishSource[]): Promise<boolean> {
    const res = await this.rpc(
      "UpdateParticipant",
      {
        room,
        identity,
        permission: {
          can_subscribe: true,
          can_publish: sources.length > 0,
          can_publish_data: false,
          can_publish_sources: sources.map((x) => (x === "camera" ? "CAMERA" : "MICROPHONE")),
        },
      },
      room,
    );
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`LiveKit UpdateParticipant failed (${res.status})`);
    return true;
  }

  /**
   * Verifies a LiveKit webhook: the Authorization header is a JWT signed with this server's API secret, issued by its
   * API key, unexpired, whose "sha256" claim is the base64 SHA-256 of the exact request body. Returns the event or null.
   */
  webhookEvent(body: Buffer, authorization: string | undefined): Record<string, unknown> | null {
    if (!this.opts.apiKey || !this.opts.apiSecret || !authorization) return null;
    const token = authorization.replace(/^Bearer\s+/i, "");
    const claims = verifyJwt(token, this.opts.apiSecret, { nowSeconds: Math.floor(this.now() / 1000) });
    if (!claims || claims.iss !== this.opts.apiKey || typeof claims.sha256 !== "string") return null;
    const digest = createHash("sha256").update(body).digest();
    const claimed = Buffer.from(claims.sha256, "base64");
    if (claimed.length !== digest.length || !timingSafeEqual(claimed, digest)) return null;
    try {
      const event: unknown = JSON.parse(body.toString("utf8"));
      return event && typeof event === "object" && !Array.isArray(event)
        ? (event as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async roomStats(room: string): Promise<RoomStats | null> {
    const res = await this.rpc("ListParticipants", { room }, room);
    if (res.status === 404) return { participants: 0, publishers: 0 };
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      participants?: { tracks?: unknown[]; permission?: { canPublish?: boolean } }[];
    } | null;
    const list = body?.participants ?? [];
    return {
      participants: list.length,
      publishers: list.filter((p) => (p.tracks?.length ?? 0) > 0).length,
    };
  }
}

// ---------- In-memory provider (tests and local development, never production) ----------

export class MemoryProvider implements StreamingProvider {
  readonly configured = true;
  readonly issued: JoinGrant[] = [];
  readonly closed: string[] = [];
  readonly stats = new Map<string, RoomStats>();

  constructor(readonly key = "memory") {}

  async issueToken(g: JoinGrant): Promise<JoinToken> {
    this.issued.push(g);
    return {
      url: "wss://memory.invalid",
      token: `memory.${g.room}.${g.identity}.${g.canPublish ? "pub" : "sub"}`,
      expiresAt: new Date(Date.now() + g.ttlSeconds * 1000).toISOString(),
    };
  }

  async closeRoom(room: string): Promise<void> {
    this.closed.push(room);
    this.stats.delete(room);
  }

  async roomStats(room: string): Promise<RoomStats | null> {
    return this.stats.get(room) ?? { participants: 0, publishers: 0 };
  }

  readonly removed: { room: string; identity: string }[] = [];
  readonly muted: { room: string; identity: string; kind: string }[] = [];

  async removeParticipant(room: string, identity: string): Promise<void> {
    this.removed.push({ room, identity });
  }

  async muteParticipant(room: string, identity: string, kind: "audio" | "video"): Promise<number> {
    this.muted.push({ room, identity, kind });
    return 1;
  }

  readonly sources: { room: string; identity: string; sources: PublishSource[] }[] = [];

  async setPublishSources(room: string, identity: string, sources: PublishSource[]): Promise<boolean> {
    this.sources.push({ room, identity, sources });
    return true;
  }
}

export class ProviderNotConfigured extends Error {
  constructor(readonly providerKey: string) {
    super(`Streaming provider "${providerKey}" is not configured on the server`);
    this.name = "ProviderNotConfigured";
  }
}

/** Providers available on this server, by key. */
export type ProviderRegistry = Map<string, StreamingProvider>;

export function buildRegistry(env: {
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
}): ProviderRegistry {
  const reg: ProviderRegistry = new Map();
  if (env.LIVEKIT_URL) {
    reg.set(
      "livekit",
      new LiveKitProvider({
        url: env.LIVEKIT_URL,
        apiKey: env.LIVEKIT_API_KEY,
        apiSecret: env.LIVEKIT_API_SECRET,
      }),
    );
  }
  return reg;
}
