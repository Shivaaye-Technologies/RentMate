import type { Person } from "../api";
import { LOOKING_FOR_LABELS } from "../profile";

/** "I'm here for", About me and interests, shared by the card and the full profile. */
export function PersonDetails({ person }: { person: Person }) {
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
      {person.interests.length > 0 && (
        <section>
          <h3>Interests</h3>
          <div className="chips">
            {person.interests.map((i) => {
              const shared = person.sharedInterests.includes(i.trim().toLowerCase());
              return (
                <span key={i} className={shared ? "chip shared" : "chip"}>
                  {shared && "★ "}
                  {i}
                </span>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
