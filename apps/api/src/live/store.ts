import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
}
