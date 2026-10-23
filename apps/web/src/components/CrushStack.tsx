import type { DiscoverSummary, Person } from "../api";
import { EmptyDiscover, type EmptyExtras } from "./EmptyDiscover";
import { Icon, VerifiedBadge } from "./Icon";
import { PersonDetails } from "./PersonDetails";
import { Photo } from "./Photo";
import { DemoBadge } from "./DemoBadge";

interface Props {
  people: Person[];
  summary: DiscoverSummary | null;
  /** Real-app empty-state extras (activity, review passes, invite, Demo Mode). */
  emptyExtras?: EmptyExtras;
  onEditProfile: () => void;
  busy: boolean;
  canRewind: boolean;
  onPass: (p: Person) => void;
  onLike: (p: Person) => void;
  onSuper: (p: Person) => void;
  onRewind: () => void;
  onRefresh: () => void;
}

/** "Find your Crush": one big card at a time. */
export function CrushStack({
  people,
  summary,
  emptyExtras,
  onEditProfile,
  busy,
  canRewind,
  onPass,
  onLike,
  onSuper,
  onRewind,
  onRefresh,
}: Props) {
  const p = people[0];

  if (!p) {
    return (
      <div className="empty">
        <EmptyDiscover summary={summary} extras={emptyExtras} onEditProfile={onEditProfile}>
          {canRewind && (
            <button className="btn" onClick={onRewind}>
              <Icon name="undo" size={18} /> Undo last pass
            </button>
          )}
          <button className="btn dark" onClick={onRefresh}>
            Refresh
          </button>
        </EmptyDiscover>
      </div>
    );
  }

  return (
    <section className="crush" aria-label="Find your crush">
      <article className="crush-card" key={p.id}>
        <div className="crush-head">
          <h2 className="display-sm">
            {p.displayName}, {p.age}
          </h2>
          {p.verified && <VerifiedBadge size={22} />}
          <DemoBadge id={p.id} />
          {p.online && <span className="dot-online" title="Online now" />}
        </div>

        <div className="crush-photo">
          <Photo id={p.id} name={p.displayName} path={p.photoPath} textSize={72} />
          <div className="photo-tags">
            {p.distanceKm != null && (
              <span className="pill glass">
                <Icon name="pin" size={14} /> {p.distanceKm} km away
              </span>
            )}
            {p.score > 0 && <span className="pill glass">{p.score}% match</span>}
          </div>
        </div>

        <PersonDetails person={p} />
      </article>

      <div className="action-bar" role="group" aria-label="Decide">
        <button
          className="act rewind"
          aria-label="Undo last pass"
          disabled={!canRewind || busy}
          onClick={onRewind}
        >
          <Icon name="undo" />
        </button>
        <button
          className="act pass"
          aria-label={`Pass on ${p.displayName}`}
          disabled={busy}
          onClick={() => onPass(p)}
        >
          <Icon name="x" size={26} />
        </button>
        <button
          className="act like"
          aria-label={`Like ${p.displayName}`}
          disabled={busy}
          onClick={() => onLike(p)}
        >
          <Icon name="heart" size={28} />
        </button>
        <button
          className="act super"
          aria-label={`Super Like ${p.displayName}`}
          disabled={busy}
          onClick={() => onSuper(p)}
        >
          <Icon name="star" size={24} />
        </button>
      </div>
    </section>
  );
}
