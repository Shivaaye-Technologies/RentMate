import type { ReactNode } from "react";
import { discoverEmptyState, type DiscoverSummary, type EmptyActivity } from "../api";
import { InviteButton } from "./InviteButton";

/** Real-app extras for an empty Discover. Demo Mode leaves them out. */
export interface EmptyExtras {
  /** Your own likes awaiting a reply and passes. */
  activity: EmptyActivity | null;
  onReviewPasses: () => void;
  reviewing: boolean;
}

/**
 * Why Discover is empty, from real data only: who is waiting for your like to be
 * returned, who you passed, and who is outside your age range. Offers to bring
 * back passed people, invite friends, or look around the fictional Demo Mode.
 */
export function EmptyDiscover({
  summary,
  extras,
  onEditProfile,
  children,
}: {
  summary: DiscoverSummary | null;
  extras?: EmptyExtras;
  onEditProfile: () => void;
  /** Screen-specific buttons (undo, refresh). */
  children?: ReactNode;
}) {
  const empty = discoverEmptyState(summary, extras?.activity ?? null);
  return (
    <>
      <p className="display-sm">{empty.title}</p>
      <p className="muted">{empty.body}</p>
      <div className="row-center">
        {empty.editProfile && (
          <button className="btn" onClick={onEditProfile}>
            Edit age range
          </button>
        )}
        {extras && empty.reviewPasses > 0 && (
          <button className="btn" disabled={extras.reviewing} onClick={extras.onReviewPasses}>
            {extras.reviewing
              ? "Bringing them back…"
              : `Review ${empty.reviewPasses} passed ${empty.reviewPasses === 1 ? "profile" : "profiles"}`}
          </button>
        )}
        {children}
      </div>
      {extras && (
        <div className="empty-extras">
          <InviteButton />
          <a className="btn link demo-link" href="#demo">
            Explore Demo Mode <small>(fictional profiles)</small>
          </a>
        </div>
      )}
    </>
  );
}
