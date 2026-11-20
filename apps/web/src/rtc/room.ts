import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type LocalTrack,
  type Participant,
  type RemoteTrack,
} from "livekit-client";
import type { EndReason } from "./callState";

/** What a screen needs from a joined media room. Shared by calls and broadcasts. */
export interface MediaRoom {
  room: Room;
  setMic(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  /** Moves to the next camera (front/back on phones). False when there is only one. */
  switchCamera(): Promise<boolean>;
  leave(): Promise<void>;
}

export interface MediaRoomEvents {
  onConnection?: (state: "connecting" | "connected" | "reconnecting" | "reconnected") => void;
  onDisconnected?: (reason: EndReason) => void;
  /** Remote people or their tracks changed; re-render from room.remoteParticipants. */
  onRemoteChange?: () => void;
  /** Local tracks changed (camera turned on, device switched): re-attach the preview. */
  onLocalChange?: () => void;
  /** The server changed what I may publish (a host muted or allowed my camera or microphone). */
  onPermissions?: (p: { canPublish?: boolean; canPublishSources?: number[] } | undefined) => void;
}

/** LiveKit's reason for a disconnect, in the screen's words. */
export function disconnectReason(reason: DisconnectReason | undefined): EndReason {
  switch (reason) {
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "removed";
    case DisconnectReason.ROOM_DELETED:
    case DisconnectReason.ROOM_CLOSED:
      return "room_closed";
    case DisconnectReason.CLIENT_INITIATED:
      return "hung_up";
    default:
      return "network";
  }
}

/**
 * Connects to a LiveKit room with a server-issued token. Publishing (microphone, camera) is a separate step so the
 * caller can show a clear permission error. Never publishes anything the token does not allow: the server decides.
 */
export async function joinMediaRoom(
  url: string,
  token: string,
  events: MediaRoomEvents = {},
): Promise<MediaRoom> {
  const room = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: true });
  room
    .on(RoomEvent.Reconnecting, () => events.onConnection?.("reconnecting"))
    .on(RoomEvent.SignalReconnecting, () => events.onConnection?.("reconnecting"))
    .on(RoomEvent.Reconnected, () => events.onConnection?.("reconnected"))
    .on(RoomEvent.Disconnected, (reason) => events.onDisconnected?.(disconnectReason(reason)))
    .on(RoomEvent.ParticipantConnected, () => events.onRemoteChange?.())
    .on(RoomEvent.ParticipantDisconnected, () => events.onRemoteChange?.())
    .on(RoomEvent.TrackSubscribed, () => events.onRemoteChange?.())
    .on(RoomEvent.TrackUnsubscribed, () => events.onRemoteChange?.())
    .on(RoomEvent.TrackMuted, () => events.onRemoteChange?.())
    .on(RoomEvent.TrackUnmuted, () => events.onRemoteChange?.())
    .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
      if (participant === room.localParticipant) events.onPermissions?.(participant.permissions);
    })
    .on(RoomEvent.LocalTrackPublished, () => events.onLocalChange?.())
    .on(RoomEvent.LocalTrackUnpublished, () => events.onLocalChange?.())
    .on(RoomEvent.ActiveDeviceChanged, () => events.onLocalChange?.());
  events.onConnection?.("connecting");
  await room.connect(url, token, { autoSubscribe: true });
  events.onConnection?.("connected");

  return {
    room,
    setMic: async (on) => {
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    setCamera: async (on) => {
      await room.localParticipant.setCameraEnabled(on);
    },
    switchCamera: async () => {
      const cams = await Room.getLocalDevices("videoinput");
      if (cams.length < 2) return false;
      const current = room.getActiveDevice("videoinput");
      const i = cams.findIndex((c) => c.deviceId === current);
      const next = cams[(i + 1) % cams.length];
      return room.switchActiveDevice("videoinput", next.deviceId);
    },
    leave: async () => {
      if (room.state !== ConnectionState.Disconnected) await room.disconnect(true);
    },
  };
}

/** The first track of a kind a participant is publishing (and not muted). */
export function trackOf(
  p: Participant | undefined,
  kind: "video" | "audio",
): RemoteTrack | LocalTrack | null {
  if (!p) return null;
  const source = kind === "video" ? Track.Source.Camera : Track.Source.Microphone;
  const pub = p.getTrackPublication(source);
  return pub && !pub.isMuted && pub.track ? (pub.track as RemoteTrack | LocalTrack) : null;
}

/** Attaches a track to an element and returns a cleanup function. */
export function attach(track: RemoteTrack | LocalTrack | null, el: HTMLMediaElement | null): () => void {
  if (!track || !el) return () => undefined;
  track.attach(el);
  return () => {
    track.detach(el);
  };
}
