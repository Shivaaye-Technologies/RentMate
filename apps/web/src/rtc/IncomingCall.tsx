import { useEffect, useState } from "react";
import { callsApi, watchIncoming, type CallRecord } from "./rtcData";

/** Banner for an incoming call, shown on every screen while it rings. */
export function IncomingCall({ me }: { me: string }) {
  const [call, setCall] = useState<CallRecord | null>(null);
  const [name, setName] = useState("Someone");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => watchIncoming(me, setCall), [me]);
  useEffect(() => {
    if (!call) return;
    void callsApi.names([call.caller_id]).then((n) => setName(n[call.caller_id] ?? "Someone"));
    // Gentle vibration on phones that support it; no ringtone file is shipped.
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([300, 200, 300]);
  }, [call]);

  if (!call && !note) return null;
  if (!call) {
    return (
      <div className="incoming-call" role="status">
        <span>{note}</span>
        <button className="btn small" onClick={() => setNote(null)}>
          OK
        </button>
      </div>
    );
  }

  async function answer(accept: boolean) {
    if (!call) return;
    setBusy(true);
    try {
      const status = await callsApi.answer(call.id, accept);
      setCall(null);
      if (status === "accepted") window.location.hash = `#call/${call.id}`;
      else if (accept)
        setNote(status === "missed" ? "That call has ended." : "That call is no longer available.");
    } catch (e) {
      setCall(null);
      setNote(e instanceof Error ? e.message : "Couldn't answer the call.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="incoming-call" role="alertdialog" aria-label="Incoming call">
      <div>
        <strong>{name}</strong>
        <span className="muted small">Incoming {call.mode === "video" ? "video" : "voice"} call</span>
      </div>
      <div className="row">
        <button className="btn small danger" disabled={busy} onClick={() => void answer(false)}>
          Decline
        </button>
        <button className="btn small dark" disabled={busy} onClick={() => void answer(true)}>
          Accept
        </button>
      </div>
    </div>
  );
}
