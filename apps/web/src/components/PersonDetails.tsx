import type { Person } from "../api";
import { GENDER_LABELS, profileFacts } from "../details";
import { interestKey } from "../interests";
import { LOOKING_FOR_LABELS } from "../profile";
import { Icon } from "./Icon";

/**
 * Everything a person chose to share: goal, bio, prompts, facts, interests and
 * places. Only filled-in fields are shown. Text is rendered as text, never HTML.
 */
export function PersonDetails({ person }: { person: Person }) {
  const d = person.details;
  const facts = [...(d.gender ? [GENDER_LABELS[d.gender]] : []), ...profileFacts(d)];
  const shared = new Set(person.sharedInterests.map(interestKey));
  return (
    <div className="details">
      <section>
        <h3>I'm here for</h3>
        <div className="chips">
          <span className="chip tint">{LOOKING_FOR_LABELS[person.lookingFor]}</span>
        </div>
      </section>
      {person.bio && (
        <section>
          <h3>About me</h3>
          <p className="bio">{person.bio}</p>
        </section>
      )}
      {d.prompts.map((p) => (
        <section key={p.q} className="prompt-card">
          <p className="prompt-q">
            <Icon name="quote" size={16} /> {p.q}
          </p>
          <p className="prompt-a">{p.a}</p>
        </section>
      ))}
      {facts.length > 0 && (
        <section>
          <h3>Basics</h3>
          <div className="chips">
            {facts.map((f) => (
              <span key={f} className="chip">
                {f}
              </span>
            ))}
          </div>
        </section>
      )}
      {person.interests.length > 0 && (
        <section>
          <h3>Interests</h3>
          <div className="chips">
            {person.interests.map((i) => {
              const isShared = shared.has(interestKey(i));
              return (
                <span key={i} className={isShared ? "chip shared" : "chip"}>
                  {isShared && "★ "}
                  {i}
                </span>
              );
            })}
          </div>
        </section>
      )}
      {(d.city || d.neighbourhoods.length > 0 || d.favourite_places.length > 0) && (
        <section>
          <h3>Favourite places</h3>
          {d.city && (
            <p className="muted small">
              <Icon name="pin" size={14} /> Lives in {d.city}
              {d.neighbourhoods.length > 0 ? ` · hangs out in ${d.neighbourhoods.join(", ")}` : ""}
            </p>
          )}
          {d.favourite_places.length > 0 && (
            <div className="chips">
              {d.favourite_places.map((p) => (
                <span key={p} className="chip">
                  {p}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
