import { useEffect, useState } from "react";
import type { Person } from "../api";
import { REPORT_REASONS, type ReportReason } from "../safety";
import { Icon } from "./Icon";

interface Props {
  person: Person;
  /** Shown when you have a match with this person. */
  canUnmatch: boolean;
  busy: boolean;
  onReport: (reason: ReportReason, details: string, alsoBlock: boolean) => void;
  onBlock: () => void;
  onUnmatch: () => void;
  onClose: () => void;
}

type View = "menu" | "report" | "confirm-block" | "confirm-unmatch";

/** Report, block and unmatch for one person. */
export function SafetySheet({ person, canUnmatch, busy, onReport, onBlock, onUnmatch, onClose }: Props) {
  const [view, setView] = useState<View>("menu");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const name = person.displayName;

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Safety options for ${name}`}>
      <div className="sheet safety">
        <button className="close-x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>

        {view === "menu" && (
          <>
            <h2 className="display-sm">{name}</h2>
            <p className="muted">
              Your safety comes first. {name} won't be told you reported or blocked them.
            </p>
            <button className="option" onClick={() => setView("report")}>
              <strong>Report {name}</strong>
              <small>Fake profile, harassment, scam, someone under 18…</small>
            </button>
            <button className="option" onClick={() => setView("confirm-block")}>
              <strong>Block {name}</strong>
              <small>You won't see each other, and any chat disappears.</small>
            </button>
            {canUnmatch && (
              <button className="option" onClick={() => setView("confirm-unmatch")}>
                <strong>Unmatch</strong>
                <small>Remove the match and the conversation for both of you.</small>
              </button>
            )}
          </>
        )}

        {view === "report" && (
          <>
            <h2 className="display-sm">Report {name}</h2>
            <fieldset className="field">
              <span>What's wrong?</span>
              <div className="reason-list">
                {REPORT_REASONS.map((r) => (
                  <label key={r.value} className={reason === r.value ? "reason active" : "reason"}>
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      checked={reason === r.value}
                      onChange={() => setReason(r.value)}
                    />
                    {r.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>Anything else we should know? (optional)</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} />
              Also block {name}
            </label>
            <button
              className="btn dark block"
              disabled={busy || !reason}
              onClick={() => reason && onReport(reason, details.trim(), alsoBlock)}
            >
              {busy ? "Sending…" : "Send report"}
            </button>
            <button className="btn link block" onClick={() => setView("menu")}>
              Back
            </button>
          </>
        )}

        {view === "confirm-block" && (
          <>
            <h2 className="display-sm">Block {name}?</h2>
            <p className="muted">
              You won't see each other anywhere in SOULMATE.AI, and any match and chat between you will
              disappear.
            </p>
            <button className="btn dark block" disabled={busy} onClick={onBlock}>
              {busy ? "Blocking…" : `Block ${name}`}
            </button>
            <button className="btn link block" onClick={() => setView("menu")}>
              Cancel
            </button>
          </>
        )}

        {view === "confirm-unmatch" && (
          <>
            <h2 className="display-sm">Unmatch {name}?</h2>
            <p className="muted">The match and your whole conversation will be removed for both of you.</p>
            <button className="btn dark block" disabled={busy} onClick={onUnmatch}>
              {busy ? "Removing…" : "Unmatch"}
            </button>
            <button className="btn link block" onClick={() => setView("menu")}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
