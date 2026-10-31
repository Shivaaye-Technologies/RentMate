import { createHmac, randomUUID } from "node:crypto";

/** What a joining person is allowed to do in a room. */
export interface JoinGrant {
  room: string;
  /** Stable id for the person (their user id). */
  identity: string;
  displayName?: string;
  canPublish: boolean;
  /** Audio-only rooms (private audio sessions) publish the microphone only. */
  audioOnly?: boolean;
  ttlSeconds: number;
}

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
}

// ---------- JWT (HS256) ----------

const b64url = (data: Buffer | string) =>
  Buffer.from(data).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Verifies and decodes an HS256 JWT (used by tests and for defence in depth). */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const expected = b64url(createHmac("sha256", secret).update(`${h}.${b}`).digest());
  if (expected.length !== s.length || expected !== s) return null;
  return JSON.parse(Buffer.from(b.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

// ---------- LiveKit ----------

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
        },
      },
      apiSecret,
    );
    return { url: this.opts.url, token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Short-lived server token for RoomService calls. */
  private adminToken(room?: string): string {
    const { apiKey, apiSecret } = this.requireCreds();
    const nowS = Math.floor(this.now() / 1000);
    return signJwt(
      {
        iss: apiKey,
        nbf: nowS - 5,
        exp: nowS + 60,
        video: { roomAdmin: true, roomList: true, roomCreate: true, room },
      },
      apiSecret,
    );
  }

  private async rpc(method: string, body: Record<string, unknown>, room?: string): Promise<Response> {
    const base = this.opts.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
    return this.fetchFn(`${base}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.adminToken(room)}` },
      body: JSON.stringify(body),
    });
  }

  async closeRoom(room: string): Promise<void> {
    const res = await this.rpc("DeleteRoom", { room }, room);
    // 404 = room already gone (nobody joined, or already closed): that's the goal anyway.
    if (!res.ok && res.status !== 404) throw new Error(`LiveKit DeleteRoom failed (${res.status})`);
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
