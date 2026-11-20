import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";

export const SAFETY_PAGES: { title: string; icon: IconName; body: string; points: string[] }[] = [
  {
    title: "Be yourself",
    icon: "user",
    body: "Use your own recent photos and real details. Honest profiles lead to better matches.",
    points: ["Use photos of you, and only you", "Don't pretend to be someone else"],
  },
  {
    title: "Respect others",
    icon: "heart",
    body: "Treat people the way you'd like to be treated, in chat and in person.",
    points: ["No insults, threats or hate", "Take no for an answer"],
  },
  {
    title: "Consent",
    icon: "check",
    body: "Everyone decides for themselves what they share and do. Consent can be withdrawn at any time.",
    points: ["Ask before sending photos", "Never share someone's photos or messages without permission"],
  },
  {
    title: "Protect your privacy",
    icon: "lock",
    body: "Keep personal details private until you trust someone.",
    points: [
      "Don't share your address, workplace or money details",
      "Never send money to someone you met here",
    ],
  },
  {
    title: "Meet safely",
    icon: "shield",
    body: "Take your time. When you're ready to meet, choose a public place and tell a friend.",
    points: ["Meet in public and arrange your own travel", "Use Report or block if anything feels wrong"],
  },
];

/**
 * Five-page safety introduction in a dark bottom sheet. Acknowledging it only
 * records that you read it; it is not agreeing to legal terms.
 */
export function SafetyIntro({ onFinish, onClose }: { onFinish: () => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const page = SAFETY_PAGES[i];
  const last = i === SAFETY_PAGES.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="safety-title">
      <div className="sheet dark-sheet safety-intro">
        <button className="close-x on-dark" aria-label="Close safety introduction" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
        <div className="progress-bars" aria-label={`Page ${i + 1} of ${SAFETY_PAGES.length}`}>
          {SAFETY_PAGES.map((p, k) => (
            <i key={p.title} className={k <= i ? "on" : ""} />
          ))}
        </div>
        <span className="safety-icon" aria-hidden="true">
          <Icon name={page.icon} size={30} />
        </span>
        <h2 id="safety-title" className="display-md">
          {page.title}
        </h2>
        <p>{page.body}</p>
        <ul className="tips on-dark">
          {page.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="row step-actions">
          {i > 0 && (
            <button className="btn ghost-dark" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button className="btn yellow grow" onClick={() => (last ? onFinish() : setI(i + 1))}>
            {last ? "I understand" : "Next"}
          </button>
        </div>
        {last && (
          <p className="fine on-dark">
            This just records that you've read these tips. Our <a href="/terms.html">Terms of Use</a> still
            apply.
          </p>
        )}
      </div>
    </div>
  );
}
