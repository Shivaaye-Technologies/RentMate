/** What a broadcaster may publish, as decided by the server (host mutes). */
export interface Allowed {
  camera: boolean;
  microphone: boolean;
}

// LiveKit protocol TrackSource values.
const CAMERA = 1;
const MICROPHONE = 2;

/**
 * Reads a LiveKit participant permission. LiveKit's rule: canPublish false = nothing; canPublish true with an empty
 * canPublishSources list = every source; otherwise only the listed sources.
 */
export function allowedFrom(p: { canPublish?: boolean; canPublishSources?: number[] } | undefined): Allowed {
  if (!p || !p.canPublish) return { camera: false, microphone: false };
  const s = p.canPublishSources ?? [];
  if (s.length === 0) return { camera: true, microphone: true };
  return { camera: s.includes(CAMERA), microphone: s.includes(MICROPHONE) };
}

/** From the join response's source names. */
export const allowedFromSources = (sources: string[]): Allowed => ({
  camera: sources.includes("camera"),
  microphone: sources.includes("microphone"),
});

/** What to tell the guest when the host changes their permission (null when nothing changed). */
export function hostNotice(before: Allowed, after: Allowed): string | null {
  const parts: string[] = [];
  if (before.camera && !after.camera) parts.push("The host turned off your camera.");
  if (before.microphone && !after.microphone) parts.push("The host muted your microphone.");
  if (!before.camera && after.camera)
    parts.push("The host allowed your camera again. Turn it on when you're ready.");
  if (!before.microphone && after.microphone)
    parts.push("The host allowed your microphone again. Unmute when you're ready.");
  return parts.length ? parts.join(" ") : null;
}
