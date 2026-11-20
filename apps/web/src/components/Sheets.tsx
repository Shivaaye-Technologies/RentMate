import { useEffect, useState } from "react";
import type { Person } from "../api";
import { Icon, VerifiedBadge } from "./Icon";
import { PersonDetails } from "./PersonDetails";
import { Photo } from "./Photo";
import { DemoBadge } from "./DemoBadge";
import { PhotoCarousel } from "./ProfileCardPreview";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Full profile ("See profile"). Actions are optional (e.g. hidden for matches). */
export function ProfileSheet({
  person,
  onClose,
  onLike,
  onPass,
  onSuper,
  onSafety,
}: {
  person: Person;
  onClose: () => void;
  onLike?: () => void;
  onPass?: () => void;
  onSuper?: () => void;
  /** Opens report / block options. */
  onSafety?: () => void;
}) {
  useEscape(onClose);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`${person.displayName}'s profile`}>
      <div className="sheet">
        <button className="close-x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
        <div className="crush-head">
          <h2 className="display-sm">
            {person.displayName}, {person.age}
          </h2>
          {person.verified && <VerifiedBadge size={22} />}
          <DemoBadge id={person.id} />
        </div>
        <div className="crush-photo">
          <PhotoCarousel person={person} />
          {(person.details.city || person.distanceKm != null) && (
            <div className="photo-tags">
              <span className="pill glass">
                <Icon name="pin" size={14} />{" "}
                {[person.details.city, person.distanceKm != null ? `${person.distanceKm} km away` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          )}
        </div>
        <PersonDetails person={person} />
        {onSafety && (
          <button className="btn link block muted-link" onClick={onSafety}>
            Report or block {person.displayName}
          </button>
        )}
        {(onLike || onPass || onSuper) && (
          <div className="action-bar in-sheet">
            {onPass && (
              <button className="act pass" aria-label="Pass" onClick={onPass}>
                <Icon name="x" size={26} />
              </button>
            )}
            {onLike && (
              <button className="act like" aria-label="Like" onClick={onLike}>
                <Icon name="heart" size={28} />
              </button>
            )}
            {onSuper && (
              <button className="act super" aria-label="Super Like" onClick={onSuper}>
                <Icon name="star" size={24} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** "It's a Match!" celebration. */
export function MatchOverlay({
  person,
  note,
  onChat,
  onProfile,
  onClose,
}: {
  person: Person;
  /** Extra line under the photo, e.g. that a Demo Mode match is simulated. */
  note?: string;
  onChat: () => void;
  onProfile: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="It's a match">
      <div className="celebrate lilac">
        <span className="blob green" aria-hidden="true" />
        <button className="close-x on-color" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
        <p className="display-xl">It's a</p>
        <div className="celebrate-photo">
          <Photo id={person.id} name={person.displayName} path={person.photoPath} textSize={64} />
          <span className="photo-name">
            {person.displayName}, {person.age} {person.verified && <VerifiedBadge size={18} />}{" "}
            <DemoBadge id={person.id} />
          </span>
        </div>
        <p className="display-xl">Match!</p>
        {note && <p className="sim-note on-color">{note}</p>}
        <button className="btn dark block" onClick={onChat}>
          Start a conversation
        </button>
        <button className="btn link" onClick={onProfile}>
          See profile
        </button>
      </div>
    </div>
  );
}

/** "Get noticed with a Super Like": optional short message. */
export function SuperLikeSheet({
  person,
  busy,
  onSend,
  onClose,
}: {
  person: Person;
  busy: boolean;
  onSend: (message: string | null) => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState("");
  const trimmed = message.trim();

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Send a Super Like">
      <div className="celebrate sky">
        <span className="blob gold" aria-hidden="true" />
        <button className="close-x on-color" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
        <p className="kicker">Get noticed with a</p>
        <p className="display-xl">Super Like</p>
        <div className="celebrate-photo small">
          <Photo id={person.id} name={person.displayName} path={person.photoPath} textSize={48} />
          <span className="photo-name">
            {person.displayName}, {person.age}
          </span>
        </div>
        {writing ? (
          <>
            <label className="field on-color">
              <span className="sr-only">Your message</span>
              <textarea
                rows={3}
                maxLength={300}
                autoFocus
                placeholder={`Say something nice to ${person.displayName}…`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <button className="btn dark block" disabled={busy || !trimmed} onClick={() => onSend(trimmed)}>
              {busy ? "Sending…" : "Send Super Like"}
            </button>
          </>
        ) : (
          <>
            <button className="btn dark block" onClick={() => setWriting(true)}>
              Add a message
            </button>
            <button className="btn soft block" disabled={busy} onClick={() => onSend(null)}>
              {busy ? "Sending…" : "Send without a message"}
            </button>
          </>
        )}
        <p className="fine on-color">You can send 3 Super Likes a day.</p>
      </div>
    </div>
  );
}
