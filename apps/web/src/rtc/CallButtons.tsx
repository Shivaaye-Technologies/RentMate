import { useState } from "react";
import { useIsDemo } from "../demo";
import type { CallMode } from "./callState";
import { callsApi } from "./rtcData";

/** Voice and video call buttons for a match. Demo profiles cannot be called (nobody would answer). */
export function CallButtons({ personId, name }: { personId: string; name: string }) {
  const demo = useIsDemo(personId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (demo) return null;

  async function call(mode: CallMode) {
    setBusy(true);
    setError(null);
    try {
      const id = await callsApi.start(personId, mode);
      window.location.hash = `#call/${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the call.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="call-buttons">
      <button
        className="icon-btn"
        aria-label={`Voice call ${name}`}
        disabled={busy}
        onClick={() => void call("voice")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            d="M6.6 3.5 9 3l1.6 4.2-2 1.3a12 12 0 0 0 6.9 6.9l1.3-2L21 15l-.5 2.4a2 2 0 0 1-2 1.6A15.5 15.5 0 0 1 5 5.5a2 2 0 0 1 1.6-2Z"
          />
        </svg>
      </button>
      <button
        className="icon-btn"
        aria-label={`Video call ${name}`}
        disabled={busy}
        onClick={() => void call("video")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <rect
            x="3"
            y="6"
            width="12.5"
            height="12"
            rx="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m15.5 10.5 5-3v9l-5-3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error && (
        <span className="call-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
