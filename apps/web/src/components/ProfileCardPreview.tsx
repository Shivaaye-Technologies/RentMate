import { useState, type ReactNode } from "react";
import type { Person } from "../api";
import { DemoBadge } from "./DemoBadge";
import { Icon, VerifiedBadge } from "./Icon";
import { Photo } from "./Photo";

/** Main photo plus extra photos, with tap zones, arrows and progress bars. */
export function PhotoCarousel({ person, textSize = 72 }: { person: Person; textSize?: number }) {
  const paths = [person.photoPath, ...person.photos].filter((p): p is string => !!p);
  const [i, setI] = useState(0);
  const count = Math.max(paths.length, 1);
  const at = Math.min(i, count - 1);
  const go = (d: number) => setI((x) => Math.min(Math.max(x + d, 0), count - 1));

  return (
    <div
      className="carousel"
      tabIndex={count > 1 ? 0 : undefined}
      aria-roledescription={count > 1 ? "carousel" : undefined}
      aria-label={count > 1 ? `Photos of ${person.displayName}, ${at + 1} of ${count}` : undefined}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      <Photo id={person.id} name={person.displayName} path={paths[at] ?? null} textSize={textSize} />
      {count > 1 && (
        <>
          <div className="bars" aria-hidden="true">
            {paths.map((p, k) => (
              <i key={p} className={k === at ? "on" : ""} />
            ))}
          </div>
          <button
            className="tap prev"
            aria-label="Previous photo"
            disabled={at === 0}
            onClick={() => go(-1)}
          />
          <button
            className="tap next"
            aria-label="Next photo"
            disabled={at === count - 1}
            onClick={() => go(1)}
          />
        </>
      )}
    </div>
  );
}

/** A profile card: name, badges, photos, city and distance, then any details passed in. */
export function ProfileCardPreview({ person, children }: { person: Person; children?: ReactNode }) {
  const where = [person.details.city, person.distanceKm != null ? `${person.distanceKm} km away` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="crush-card preview-card">
      <div className="crush-head">
        <h2 className="display-sm">
          {person.displayName}, {person.age}
        </h2>
        {person.verified && <VerifiedBadge size={22} />}
        <DemoBadge id={person.id} />
        {person.online && <span className="dot-online" title="Online now" />}
      </div>
      <div className="crush-photo">
        <PhotoCarousel person={person} />
        {where && (
          <div className="photo-tags">
            <span className="pill glass">
              <Icon name="pin" size={14} /> {where}
            </span>
          </div>
        )}
      </div>
      {children}
    </article>
  );
}
