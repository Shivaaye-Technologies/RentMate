import { useState } from "react";
import { discoverEmptyState, filterPeople, type DiscoverSummary, type Filter, type Person } from "../api";
import { isNew, type LookingFor } from "../profile";
import { Icon, VerifiedBadge } from "./Icon";
import { Photo } from "./Photo";
import { DemoBadge } from "./DemoBadge";

interface Props {
  people: Person[];
  summary: DiscoverSummary | null;
  onEditProfile: () => void;
  likesCount: number;
  onOpenLikes: () => void;
  onOpen: (p: Person) => void;
}

const MOODS: { value: LookingFor | "any"; label: string }[] = [
  { value: "any", label: "Any mood" },
  { value: "relationship", label: "A relationship" },
  { value: "friendship", label: "Friendship" },
  { value: "casual", label: "Nothing serious" },
];

/** "Check out profiles selected just for you". */
export function DiscoverHub({ people, summary, onEditProfile, likesCount, onOpenLikes, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [mood, setMood] = useState<LookingFor | "any">("any");
  const shown = filterPeople(people, filter, mood);

  const counts = {
    new: people.filter((p) => isNew(p.joinedAt)).length,
    verified: people.filter((p) => p.verified).length,
    online: people.filter((p) => p.online).length,
  };

  const quick: { key: Filter; label: string; count: number; tone: string }[] = [
    { key: "new", label: "New", count: counts.new, tone: "yellow" },
    { key: "verified", label: "Verified", count: counts.verified, tone: "green" },
    { key: "online", label: "Online", count: counts.online, tone: "coral" },
  ];

  return (
    <section className="hub">
      <div className="hub-head">
        <h2 className="display-md">Discover</h2>
        <div className="circles">
          <button className="circle" onClick={onOpenLikes}>
            <span className="circle-img lilac">
              <Icon name="heart" size={26} />
              {likesCount > 0 && <b>{likesCount > 99 ? "99+" : likesCount}</b>}
            </span>
            <span className="circle-label">
              <i className="dot coral" /> Likes
            </span>
          </button>
          {quick.map((q) => (
            <button
              key={q.key}
              className={filter === q.key ? "circle active" : "circle"}
              aria-pressed={filter === q.key}
              onClick={() => setFilter(filter === q.key ? "all" : q.key)}
            >
              <span className={`circle-img ${q.tone}`}>
                {q.key === "verified" ? (
                  <VerifiedBadge size={26} />
                ) : (
                  <Icon name={q.key === "new" ? "sparkle" : "bolt"} size={24} filled={q.key !== "new"} />
                )}
                <b>{q.count}</b>
              </span>
              <span className="circle-label">
                <i className={`dot ${q.tone}`} /> {q.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="hub-body">
        <h3 className="display-sm">Meet</h3>
        <div className="mood-row" role="group" aria-label="I'm here for">
          {MOODS.map((m) => (
            <button
              key={m.value}
              className={mood === m.value ? "mood active" : "mood"}
              aria-pressed={mood === m.value}
              onClick={() => setMood(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="empty small">
            {people.length === 0 ? (
              <>
                <p className="display-sm">{discoverEmptyState(summary).title}</p>
                <p className="muted">{discoverEmptyState(summary).body}</p>
                {discoverEmptyState(summary).editProfile && (
                  <button className="btn" onClick={onEditProfile}>
                    Edit age range
                  </button>
                )}
              </>
            ) : (
              <p className="muted">No one matches these filters. Try another mood or filter.</p>
            )}
          </div>
        ) : (
          <div className="grid">
            {shown.map((p) => (
              <button key={p.id} className="tile" onClick={() => onOpen(p)}>
                <Photo id={p.id} name={p.displayName} path={p.photoPath} textSize={44} />
                {p.score >= 70 && (
                  <span className="pill white tile-tag">
                    <Icon name="heart" size={12} /> For you
                  </span>
                )}
                <span className="tile-name">
                  {p.displayName}, {p.age} {p.verified && <VerifiedBadge size={15} />} <DemoBadge id={p.id} />
                  {p.online && <i className="dot-online small" />}
                </span>
                {p.distanceKm != null && <span className="tile-dist">{p.distanceKm} km</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
