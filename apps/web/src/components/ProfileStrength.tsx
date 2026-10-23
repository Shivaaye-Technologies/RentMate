import { profileStrength, type ProfileRow } from "../profile";
import { Icon } from "./Icon";

/** Optional "Profile strength" card for members whose profile is not complete yet. */
export function ProfileStrength({ profile }: { profile: ProfileRow }) {
  const { score, total, items } = profileStrength(profile);
  if (score >= total) return null;
  return (
    <section className="panel strength" aria-label="Profile strength">
      <div className="strength-head">
        <h2 className="display-sm">Profile strength</h2>
        <strong>
          {score}/{total}
        </strong>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={score}>
        <span style={{ width: `${(score / total) * 100}%` }} />
      </div>
      <ul className="strength-list">
        {items.map((i) => (
          <li key={i.key} className={i.done ? "done" : ""}>
            <Icon name={i.done ? "check" : "sparkle"} size={16} />
            <span>
              <b>{i.label}</b>
              {!i.done && i.hint && <small className="muted"> {i.hint}</small>}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">Photo and distance are just below; bio and interests are in “About you”.</p>
    </section>
  );
}

/** Small reminder on the Crush screen, linking to the profile tab. */
export function StrengthNudge({ profile, onOpen }: { profile: ProfileRow; onOpen: () => void }) {
  const { score, total, items } = profileStrength(profile);
  if (score >= total) return null;
  const firstMissing = items.find((i) => !i.done);
  return (
    <button className="nudge" onClick={onOpen}>
      <Icon name={firstMissing?.key === "photo" ? "camera" : "sparkle"} size={18} /> Profile strength {score}/
      {total}
      {firstMissing ? ` · add ${firstMissing.label.toLowerCase()}` : ""}
    </button>
  );
}
