import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PublishSource } from "./providers.js";

export interface StreamRoom {
  roomName: string;
  providerKey: string;
  creatorId: string;
  explicit: boolean;
  status: string;
}

export interface SessionRoom {
  roomName: string;
  providerKey: string;
  mode: "video" | "audio";
}

export interface StreamListing {
  id: string;
  creatorId: string;
  stageName: string;
  title: string;
  category: string;
  explicit: boolean;
  status: string;
  scheduledAt: string | null;
  startedAt: string | null;
}

export interface AdminStream {
  id: string;
  roomName: string;
  providerKey: string;
  status: string;
  title: string;
  stageName: string;
  problems: string[];
}

/**
 * Live data access, always as the calling user. Every decision is made by
 * database functions under RLS; this API holds no privileged database key.
 */
export interface LiveStore {
  roles(): Promise<string[]>;
  listStreams(country: string | null): Promise<StreamListing[]>;
  broadcastCheck(streamId: string): Promise<string[]>;
  watchCheck(streamId: string, country: string | null): Promise<string[]>;
  streamRoom(streamId: string): Promise<StreamRoom | null>;
  sessionCheck(sessionId: string, country: string | null): Promise<string[]>;
  sessionRoom(sessionId: string): Promise<SessionRoom | null>;
  terminateStream(streamId: string, reason: string): Promise<void>;
  terminateSession(sessionId: string, reason: string): Promise<void>;
  setEmergencyStop(on: boolean, reason: string): Promise<void>;
  adminStreams(): Promise<AdminStream[]>;
  // ---- One-to-one calls ----
  callCheck(callId: string): Promise<string[]>;
  callRoom(callId: string): Promise<CallRoom | null>;
  /** Hangs up (cancel, decline or end) and returns the room to close. */
  callHangup(callId: string): Promise<string>;
  // ---- Broadcast rooms ----
  viewerCap(): Promise<number>;
  /** May the caller control this stream's room (creator or moderator)? */
  hostCheck(streamId: string): Promise<boolean>;
  removeGuest(streamId: string, guestId: string): Promise<void>;
  /** Sources the caller may publish in this stream (creator: both; guest: minus host mutes; others: none). */
  publishSources(streamId: string): Promise<PublishSource[]>;
  /** Host or moderator mutes/unmutes a guest's camera or microphone; returns the guest's allowed sources. */
  setGuestMute(
    streamId: string,
    guestId: string,
    kind: "audio" | "video",
    muted: boolean,
  ): Promise<PublishSource[]>;
  /** Creator ends their own stream (database first; the API then closes the room). */
  endStream(streamId: string): Promise<void>;
}

export interface CallRoom {
  roomName: string;
  mode: "voice" | "video";
  status: string;
  callerId: string;
  calleeId: string;
}

/** A pending removal from a room (blocking, suspension, guest removal, unmatching). */
export interface RoomKick {
  id: number;
  roomName: string;
  identity: string;
  reason: string;
}

/**
 * Server-to-database integration (LiveKit webhooks and the removal queue). Not tied to a user: it calls three
 * database functions with the publishable key plus a dedicated secret (LIVE_WEBHOOK_DB_SECRET). It cannot read or
 * change anything else.
 */
export interface IntegrationStore {
  ingest(event: Record<string, unknown>): Promise<{ kick: boolean; duplicate: boolean }>;
  claimKicks(limit: number): Promise<RoomKick[]>;
  doneKicks(ids: number[]): Promise<void>;
}

export class LiveStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LiveStoreError";
  }
}

/** Maps database errors: missing role = 403, bad input = 400, anything else = 500. */
const asSources = (data: unknown): PublishSource[] =>
  Array.isArray(data) ? data.filter((x): x is PublishSource => x === "camera" || x === "microphone") : [];

function fail(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new LiveStoreError("You don't have permission to do that.", 403);
  if (error.code === "22023" || error.code === "23514" || error.code === "22P02") {
    throw new LiveStoreError("That request isn't valid.", 400);
  }
  throw new Error(error.message);
}

export class SupabaseLiveStore implements LiveStore {
  private db: SupabaseClient;

  constructor(url: string, publishableKey: string, accessToken: string) {
    this.db = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  async roles() {
    const { data, error } = await this.db.rpc("my_live_roles");
    if (error) fail(error);
    return (data as string[] | null) ?? [];
  }

  async listStreams(country: string | null) {
    const { data, error } = await this.db.rpc("live_list_streams", { p_viewer_country: country });
    if (error) fail(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      creatorId: r.creator_id as string,
      stageName: r.stage_name as string,
      title: r.title as string,
      category: r.category as string,
      explicit: Boolean(r.explicit),
      status: r.status as string,
      scheduledAt: (r.scheduled_at as string | null) ?? null,
      startedAt: (r.started_at as string | null) ?? null,
    }));
  }

  async broadcastCheck(streamId: string) {
    const { data, error } = await this.db.rpc("live_broadcast_check", { p_stream: streamId });
    if (error) fail(error);
    return (data as string[] | null) ?? ["stream_not_found"];
  }

  async watchCheck(streamId: string, country: string | null) {
    const { data, error } = await this.db.rpc("live_watch_check", {
      p_stream: streamId,
      p_viewer_country: country,
    });
    if (error) fail(error);
    return (data as string[] | null) ?? ["stream_not_found"];
  }

  async streamRoom(streamId: string) {
    const { data, error } = await this.db.rpc("live_room_for", { p_stream: streamId }).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      roomName: r.room_name as string,
      providerKey: r.provider_key as string,
      creatorId: r.creator_id as string,
      explicit: Boolean(r.explicit),
      status: r.status as string,
    };
  }

  async sessionCheck(sessionId: string, country: string | null) {
    const { data, error } = await this.db.rpc("live_session_check", {
      p_session: sessionId,
      p_viewer_country: country,
    });
    if (error) fail(error);
    return (data as string[] | null) ?? ["session_not_found"];
  }

  async sessionRoom(sessionId: string) {
    const { data, error } = await this.db.rpc("live_session_room", { p_session: sessionId }).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      roomName: r.room_name as string,
      providerKey: r.provider_key as string,
      mode: r.mode as "video" | "audio",
    };
  }

  async terminateStream(streamId: string, reason: string) {
    const { error } = await this.db.rpc("live_terminate_stream", { p_stream: streamId, p_reason: reason });
    if (error) fail(error);
  }

  async terminateSession(sessionId: string, reason: string) {
    const { error } = await this.db.rpc("live_terminate_session", { p_session: sessionId, p_reason: reason });
    if (error) fail(error);
  }

  async setEmergencyStop(on: boolean, reason: string) {
    const { error } = await this.db.rpc("admin_set_emergency_stop", { p_on: on, p_reason: reason });
    if (error) fail(error);
  }

  async adminStreams() {
    const { data, error } = await this.db.rpc("admin_list_streams");
    if (error) fail(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      roomName: r.room_name as string,
      providerKey: r.provider_key as string,
      status: r.status as string,
      title: r.title as string,
      stageName: r.stage_name as string,
      problems: (r.problems as string[] | null) ?? [],
    }));
  }

  async callCheck(callId: string) {
    const { data, error } = await this.db.rpc("call_join_check", { p_call: callId });
    if (error) fail(error);
    return (data as string[] | null) ?? ["call_not_found"];
  }

  async callRoom(callId: string) {
    const { data, error } = await this.db.rpc("call_room", { p_call: callId }).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      roomName: r.room_name as string,
      mode: r.mode as "voice" | "video",
      status: r.status as string,
      callerId: r.caller_id as string,
      calleeId: r.callee_id as string,
    };
  }

  async callHangup(callId: string) {
    const { data, error } = await this.db.rpc("call_hangup", { p_call: callId });
    if (error) fail(error);
    return data as string;
  }

  async viewerCap() {
    const { data, error } = await this.db.rpc("live_viewer_cap");
    if (error) fail(error);
    return typeof data === "number" ? data : 300;
  }

  async hostCheck(streamId: string) {
    const { data, error } = await this.db.rpc("live_host_check", { p_stream: streamId });
    if (error) fail(error);
    return data === true;
  }

  async publishSources(streamId: string) {
    const { data, error } = await this.db.rpc("live_my_publish_sources", { p_stream: streamId });
    if (error) fail(error);
    return asSources(data);
  }

  async setGuestMute(streamId: string, guestId: string, kind: "audio" | "video", muted: boolean) {
    const { data, error } = await this.db.rpc("live_set_guest_mute", {
      p_stream: streamId,
      p_guest: guestId,
      p_kind: kind,
      p_muted: muted,
    });
    if (error) {
      if (error.code === "P0001") throw new LiveStoreError(error.message, 409);
      fail(error);
    }
    return asSources(data);
  }

  async removeGuest(streamId: string, guestId: string) {
    const { error } = await this.db.rpc("live_remove_guest", { p_stream: streamId, p_guest: guestId });
    if (error) fail(error);
  }

  async endStream(streamId: string) {
    const { error } = await this.db.rpc("live_end_stream", { p_stream: streamId });
    if (error) fail(error);
  }
}

export class SupabaseIntegrationStore implements IntegrationStore {
  private db: SupabaseClient;

  constructor(
    url: string,
    publishableKey: string,
    private readonly secret: string,
  ) {
    this.db = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async ingest(event: Record<string, unknown>) {
    const { data, error } = await this.db.rpc("live_webhook_ingest", {
      p_secret: this.secret,
      p_event: event,
    });
    if (error) fail(error);
    const r = (data ?? {}) as { kick?: boolean; duplicate?: boolean };
    return { kick: r.kick === true, duplicate: r.duplicate === true };
  }

  async claimKicks(limit: number) {
    const { data, error } = await this.db.rpc("live_kicks_claim", { p_secret: this.secret, p_limit: limit });
    if (error) fail(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      roomName: r.room_name as string,
      identity: r.identity as string,
      reason: r.reason as string,
    }));
  }

  async doneKicks(ids: number[]) {
    if (ids.length === 0) return;
    const { error } = await this.db.rpc("live_kicks_done", { p_secret: this.secret, p_ids: ids });
    if (error) fail(error);
  }
}
