import type { Person } from "../api";
import type { ProfileRow } from "../profile";
import { Icon } from "./Icon";

/**
 * Map tab, privacy first. Crossed paths would need people's movement history,
 * which SOULMATE.AI does not collect, so this shows an honest "not available
 * yet" state, city-level counts from real profiles, and your location settings.
 */
export function MapView({
  me,
  people,
  onBack,
  onOpenPrivacy,
  onShowCity,
}: {
  me: ProfileRow;
  people: Person[];
  onBack: () => void;
  onOpenPrivacy: () => void;
  onShowCity: (city: string) => void;
}) {
  const myCity = (me.city ?? "").trim();
  const sameCity = myCity
    ? people.filter((p) => p.details.city?.trim().toLowerCase() === myCity.toLowerCase())
    : [];
  const hasLocation = me.lat != null && me.lng != null;

  return (
    <section className="map-view" aria-label="Map">
      <div className="page-head">
        <button className="icon-btn" aria-label="Back to Discover" onClick={onBack}>
          <Icon name="back" />
        </button>
        <h2 className="display-sm">Map</h2>
      </div>

      <div className="map-art" aria-hidden="true">
        <i className="road r1" />
        <i className="road r2" />
        <i className="road r3" />
        <i className="park" />
        <span className="map-badge">
          <Icon name="lock" size={16} /> Preview
        </span>
      </div>

      <div className="panel">
        <h3>Crossed paths isn't available yet</h3>
        <p className="muted">
          Showing people you've crossed paths with would mean recording where members go. We don't track
          anyone's movements, so there are no past encounters to show, and we won't make any up.
        </p>
        <ul className="tips">
          <li>Your exact location, home and workplace are never shown to anyone.</li>
          <li>If you share an approximate location, others only see a rounded distance.</li>
          <li>Your city is the only place name others see.</li>
        </ul>
      </div>

      <div className="panel">
        <h3>People in your city</h3>
        {myCity ? (
          <>
            <p className="muted">
              {sameCity.length === 0
                ? `No one in Discover has added ${myCity} as their city yet.`
                : `${sameCity.length} ${sameCity.length === 1 ? "person" : "people"} in Discover ${sameCity.length === 1 ? "lives" : "live"} in ${myCity}.`}
            </p>
            {sameCity.length > 0 && (
              <button className="btn dark" onClick={() => onShowCity(myCity)}>
                See people in {myCity}
              </button>
            )}
          </>
        ) : (
          <p className="muted">Add your city in Profile → City and places to see people who live there.</p>
        )}
      </div>

      <div className="panel">
        <h3>Your location settings</h3>
        <p className="muted">
          {hasLocation
            ? "You're sharing an approximate location (about 1 km). Others see a rounded distance."
            : "You're not sharing a location. Discover works the same without it."}
        </p>
        <button className="btn" onClick={onOpenPrivacy}>
          <Icon name="lock" size={18} /> {hasLocation ? "Change or turn off location" : "Location settings"}
        </button>
      </div>
    </section>
  );
}
