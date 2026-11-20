// Pure call-screen state: no browser or network APIs here, so every transition is unit-tested.
// The database owns the call record (ringing → accepted → ended); this only models what the screen shows.

export type CallMode = "voice" | "video";

export type CallPhase =
  | "loading" // reading the call record
  | "ringing_out" // I called; waiting for the other person
  | "connecting" // joining the media room
  | "waiting_peer" // in the room, the other person has not connected yet
  | "connected"
  | "reconnecting"
  | "ended"
  | "failed";

export type EndReason =
  | "hung_up"
  | "declined"
  | "missed"
  | "cancelled"
  | "blocked"
  | "suspended"
  | "unmatched"
  | "removed"
  | "room_closed"
  | "network";

export type Failure = "permission_denied" | "no_device" | "not_allowed" | "unavailable" | "server";

export interface CallState {
  phase: CallPhase;
  mode: CallMode;
  micOn: boolean;
  camOn: boolean;
  connectedAt: number | null;
  reason: EndReason | null;
  failure: Failure | null;
  message: string | null;
}

export type CallEvent =
  | { type: "record"; status: string; mode: CallMode; iAmCaller: boolean; endReason?: string | null }
  | { type: "joining" }
  | { type: "joined"; peerPresent: boolean }
  | { type: "peer_joined"; at: number }
  | { type: "peer_left" }
  | { type: "reconnecting" }
  | { type: "reconnected"; peerPresent: boolean; at: number }
  | { type: "disconnected"; reason: EndReason }
  | { type: "fail"; failure: Failure; message?: string }
  | { type: "mic"; on: boolean }
  | { type: "cam"; on: boolean }
  | { type: "hang_up" };

export function initialCallState(mode: CallMode = "voice"): CallState {
  return {
    phase: "loading",
    mode,
    micOn: true,
    camOn: mode === "video",
    connectedAt: null,
    reason: null,
    failure: null,
    message: null,
  };
}

const FINAL: CallPhase[] = ["ended", "failed"];

/** Maps the database end_reason / status to what the screen says. */
export function endReasonFor(status: string, endReason?: string | null): EndReason {
  if (status === "missed") return "missed";
  if (status === "cancelled") return "cancelled";
  if (status === "rejected") return "declined";
  switch (endReason) {
    case "blocked":
    case "suspended":
    case "unmatched":
      return endReason;
    case "room_finished":
      return "room_closed";
    default:
      return "hung_up";
  }
}

export function callReducer(state: CallState, event: CallEvent): CallState {
  // Once ended or failed, only mic/cam toggles are ignored and nothing reopens the call.
  if (FINAL.includes(state.phase)) return state;
  switch (event.type) {
    case "record": {
      const next = {
        ...state,
        mode: event.mode,
        camOn: state.phase === "loading" ? event.mode === "video" : state.camOn,
      };
      if (["rejected", "missed", "cancelled", "ended"].includes(event.status)) {
        return { ...next, phase: "ended", reason: endReasonFor(event.status, event.endReason) };
      }
      if (event.status === "ringing") {
        // The callee never sees this screen while ringing (the incoming-call banner handles it).
        return event.iAmCaller && state.phase === "loading" ? { ...next, phase: "ringing_out" } : next;
      }
      if (event.status === "accepted" && (state.phase === "loading" || state.phase === "ringing_out")) {
        return { ...next, phase: state.phase === "ringing_out" ? "waiting_peer" : "connecting" };
      }
      return next;
    }
    case "joining":
      return state.phase === "loading" ? { ...state, phase: "connecting" } : state;
    case "joined":
      if (event.peerPresent) return state; // the peer_joined event follows
      return state.phase === "ringing_out" ? state : { ...state, phase: "waiting_peer" };
    case "peer_joined":
      return { ...state, phase: "connected", connectedAt: state.connectedAt ?? event.at };
    case "peer_left":
      return state.phase === "connected" ? { ...state, phase: "waiting_peer" } : state;
    case "reconnecting":
      return { ...state, phase: "reconnecting" };
    case "reconnected":
      return {
        ...state,
        phase: event.peerPresent ? "connected" : "waiting_peer",
        connectedAt: event.peerPresent ? (state.connectedAt ?? event.at) : state.connectedAt,
      };
    case "disconnected":
      return { ...state, phase: "ended", reason: event.reason };
    case "fail":
      return { ...state, phase: "failed", failure: event.failure, message: event.message ?? null };
    case "mic":
      return { ...state, micOn: event.on };
    case "cam":
      return state.mode === "video" ? { ...state, camOn: event.on } : state;
    case "hang_up":
      return { ...state, phase: "ended", reason: "hung_up" };
  }
}

/** Shown to the user only; billing uses server-side connection events, never this clock. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Turns a getUserMedia / publish error into something the user can act on. */
export function mediaFailure(err: unknown): Failure {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return "permission_denied";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return "no_device";
  }
  if (name === "NotReadableError" || name === "AbortError") return "unavailable";
  return "server";
}

export const PHASE_TEXT: Record<CallPhase, string> = {
  loading: "Opening call…",
  ringing_out: "Ringing…",
  connecting: "Connecting…",
  waiting_peer: "Waiting for them to connect…",
  connected: "Connected",
  reconnecting: "Connection lost. Reconnecting…",
  ended: "Call ended",
  failed: "Call failed",
};

export const END_TEXT: Record<EndReason, string> = {
  hung_up: "Call ended.",
  declined: "They declined the call.",
  missed: "No answer.",
  cancelled: "Call cancelled.",
  blocked: "This call was ended because of a block.",
  suspended: "This call was ended by RentMate safety.",
  unmatched: "This call ended because you are no longer matched.",
  removed: "You were removed from the call.",
  room_closed: "Call ended.",
  network: "The connection was lost.",
};

export const FAILURE_TEXT: Record<Failure, string> = {
  permission_denied:
    "RentMate can't use your microphone or camera. Allow access in your browser's site settings, then try again.",
  no_device: "No microphone or camera was found on this device.",
  not_allowed: "This call isn't allowed.",
  unavailable: "Your microphone or camera is being used by another app. Close it and try again.",
  server: "The call couldn't be connected. Try again in a moment.",
};
