import { describe, expect, it } from "vitest";
import { rtcHash } from "../App";
import {
  callReducer,
  endReasonFor,
  formatDuration,
  initialCallState,
  mediaFailure,
  type CallEvent,
  type CallState,
} from "./callState";

const run = (events: CallEvent[], start: CallState = initialCallState()) => events.reduce(callReducer, start);
const rec = (
  status: string,
  iAmCaller = true,
  mode: "voice" | "video" = "voice",
  endReason?: string,
): CallEvent => ({
  type: "record",
  status,
  mode,
  iAmCaller,
  endReason,
});

describe("call lifecycle", () => {
  it("caller: ringing → waiting for the peer → connected → hung up", () => {
    let s = run([rec("ringing")]);
    expect(s.phase).toBe("ringing_out");
    s = run([{ type: "joining" }, { type: "joined", peerPresent: false }], s);
    expect(s.phase).toBe("ringing_out"); // still ringing until they answer
    s = run([rec("accepted")], s);
    expect(s.phase).toBe("waiting_peer");
    s = run([{ type: "peer_joined", at: 1000 }], s);
    expect(s).toMatchObject({ phase: "connected", connectedAt: 1000 });
    s = run([{ type: "hang_up" }], s);
    expect(s).toMatchObject({ phase: "ended", reason: "hung_up" });
  });

  it("callee: accepted → connecting → connected; the duration starts when both are connected", () => {
    const s = run([rec("accepted", false, "video"), { type: "joining" }, { type: "peer_joined", at: 5000 }]);
    expect(s).toMatchObject({ phase: "connected", mode: "video", camOn: true, connectedAt: 5000 });
  });

  it("ends with the right reason when the other side declines, misses, cancels or safety ends it", () => {
    expect(run([rec("ringing"), rec("rejected")]).reason).toBe("declined");
    expect(run([rec("ringing"), rec("missed")]).reason).toBe("missed");
    expect(run([rec("cancelled", false)]).reason).toBe("cancelled");
    expect(run([rec("accepted"), rec("ended", true, "voice", "blocked")]).reason).toBe("blocked");
    expect(run([rec("accepted"), rec("ended", true, "voice", "suspended")]).reason).toBe("suspended");
    expect(run([rec("accepted"), rec("ended", true, "voice", "unmatched")]).reason).toBe("unmatched");
    expect(endReasonFor("ended", "room_finished")).toBe("room_closed");
  });

  it("survives a network interruption and keeps the original start time", () => {
    let s = run([rec("accepted"), { type: "peer_joined", at: 1000 }, { type: "reconnecting" }]);
    expect(s.phase).toBe("reconnecting");
    s = run([{ type: "reconnected", peerPresent: true, at: 9000 }], s);
    expect(s).toMatchObject({ phase: "connected", connectedAt: 1000 });
    s = run([{ type: "reconnecting" }, { type: "reconnected", peerPresent: false, at: 9500 }], s);
    expect(s.phase).toBe("waiting_peer");
  });

  it("shows removal and lost connection as distinct endings", () => {
    expect(run([rec("accepted"), { type: "disconnected", reason: "removed" }]).reason).toBe("removed");
    expect(run([rec("accepted"), { type: "disconnected", reason: "network" }]).reason).toBe("network");
  });

  it("never reopens a finished call (late records or events are ignored)", () => {
    const ended = run([rec("accepted"), { type: "hang_up" }]);
    expect(run([rec("accepted"), { type: "peer_joined", at: 1 }], ended)).toBe(ended);
    const failed = run([{ type: "fail", failure: "permission_denied" }]);
    expect(run([rec("accepted")], failed).phase).toBe("failed");
  });

  it("toggles the microphone, and the camera only on video calls", () => {
    const voice = run([rec("accepted"), { type: "mic", on: false }, { type: "cam", on: true }]);
    expect(voice).toMatchObject({ micOn: false, camOn: false });
    const video = run([rec("accepted", true, "video"), { type: "cam", on: false }]);
    expect(video.camOn).toBe(false);
  });
});

describe("media errors", () => {
  it("map browser errors to actionable failures", () => {
    expect(mediaFailure({ name: "NotAllowedError" })).toBe("permission_denied");
    expect(mediaFailure({ name: "SecurityError" })).toBe("permission_denied");
    expect(mediaFailure({ name: "NotFoundError" })).toBe("no_device");
    expect(mediaFailure({ name: "NotReadableError" })).toBe("unavailable");
    expect(mediaFailure(new Error("boom"))).toBe("server");
    expect(mediaFailure(null)).toBe("server");
  });
});

describe("call duration display", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65_400)).toBe("1:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("call and live routes", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  it("recognise call, live and broadcast links and reject anything else", () => {
    expect(rtcHash("#live")).toEqual({ kind: "live" });
    expect(rtcHash(`#call/${id}`)).toEqual({ kind: "call", id });
    expect(rtcHash(`#live/${id}`)).toEqual({ kind: "watch", id });
    expect(rtcHash(`#broadcast/${id.toUpperCase()}`)).toEqual({ kind: "broadcast", id });
    expect(rtcHash("#call/not-an-id")).toBeNull();
    expect(rtcHash(`#call/${id}/extra`)).toBeNull();
    expect(rtcHash("#companions")).toBeNull();
  });
});
