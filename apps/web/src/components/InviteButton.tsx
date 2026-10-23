import { useState } from "react";
import { browserInviteEnv, invite, inviteUrl, type InviteResult } from "../invite";
import { Icon } from "./Icon";

/** "Invite friends": native share sheet, or copy the website link. No tracking. */
export function InviteButton({ className = "btn" }: { className?: string }) {
  const [result, setResult] = useState<InviteResult | null>(null);
  const url = inviteUrl(typeof window === "undefined" ? "" : window.location.origin);
  return (
    <span className="invite">
      <button className={className} onClick={() => void invite(url, browserInviteEnv()).then(setResult)}>
        <Icon name="heart" size={16} /> Invite friends
      </button>
      {result === "copied" && (
        <small className="muted" role="status">
          Link copied. Paste it anywhere to invite friends.
        </small>
      )}
      {result === "unavailable" && (
        <small className="muted" role="status">
          Share this link: <span className="invite-link">{url}</span>
        </small>
      )}
    </span>
  );
}
