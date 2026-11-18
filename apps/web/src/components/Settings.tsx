import { useEffect, useState } from "react";
import { prefsOf } from "../inbox";
import { notificationPermission, requestNotificationPermission, type Permission } from "../notify";
import { coarse, type NotifyPrefs, type ProfileRow } from "../profile";
import { saveProfileFields } from "../profileApi";
import { supabase } from "../supabase";
import { Icon } from "./Icon";

type Patch = Partial<ProfileRow>;

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <small className="muted">{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/** Which activity shows in Notifications, plus optional browser alerts. */
export function NotificationSettings({
  profile,
  onChange,
}: {
  profile: ProfileRow;
  onChange: (p: Patch) => void;
}) {
  const prefs = prefsOf(profile.notify_prefs);
  const [permission, setPermission] = useState<Permission>(notificationPermission);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setPref(key: keyof NotifyPrefs, value: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const next = { ...prefs, [key]: value };
    try {
      await saveProfileFields(profile.id, { notify_prefs: next });
      onChange({ notify_prefs: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel settings">
      <h3>What to notify me about</h3>
      <Toggle
        label="Likes"
        hint="When someone likes you"
        checked={prefs.likes}
        disabled={busy}
        onChange={(v) => void setPref("likes", v)}
      />
      <Toggle
        label="Matches"
        hint="When you both like each other"
        checked={prefs.matches}
        disabled={busy}
        onChange={(v) => void setPref("matches", v)}
      />
      <Toggle
        label="Messages"
        hint="New messages in your chats"
        checked={prefs.messages}
        disabled={busy}
        onChange={(v) => void setPref("messages", v)}
      />
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      <h3>Browser alerts</h3>
      <p className="muted small">
        Alerts appear on this device while SOULMATE.AI is open in a browser tab, even in the background. When
        the site is closed you won't get alerts yet; check the bell when you come back.
      </p>
      {permission === "unsupported" && <p className="alert info">This browser doesn't support alerts.</p>}
      {permission === "denied" && (
        <p className="alert info">
          Alerts are blocked for this site. To allow them, open your browser's site settings for SOULMATE.AI
          and allow notifications.
        </p>
      )}
      {permission === "granted" && <p className="alert info">Alerts are on for this browser.</p>}
      {permission === "default" && (
        <button
          className="btn block"
          onClick={() => void requestNotificationPermission().then(setPermission)}
        >
          <Icon name="bell" size={18} /> Allow browser alerts
        </button>
      )}
    </div>
  );
}

/** Location, visibility and what others can see. */
export function PrivacySettings({
  profile,
  onChange,
}: {
  profile: ProfileRow;
  onChange: (p: Patch) => void;
}) {
  const [busy, setBusy] = useState<"location" | "hidden" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const hasLocation = profile.lat != null && profile.lng != null;

  async function save(kind: "location" | "hidden", patch: Patch, message: string) {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      await saveProfileFields(profile.id, patch);
      onChange(patch);
      setNote(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  function shareLocation() {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share a location. You can still add your city in City and places.");
      return;
    }
    setBusy("location");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Rounded on this device to about 1 km before it is sent.
        void save(
          "location",
          { lat: coarse(pos.coords.latitude), lng: coarse(pos.coords.longitude) },
          "Approximate location saved. Others only see a rounded distance.",
        );
      },
      (err) => {
        setBusy(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. You can allow it in your browser's site settings, or add just your city instead."
            : "Couldn't get your location. Try again outdoors or add your city instead.",
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  }

  return (
    <div className="panel settings">
      <h3>What others see</h3>
      <ul className="tips">
        <li>Your city, if you add one. Never your street or exact position.</li>
        <li>A rounded distance (like "5 km away") only if you share an approximate location.</li>
        <li>Never when you were last online, only an "online now" dot while you use the app.</li>
      </ul>

      <h3>Approximate distance</h3>
      <p className="muted small">
        When you tap the button, your browser asks for permission. Your position is rounded to about 1 km on
        this device before it's saved. It's optional: Discover works without it.
      </p>
      {hasLocation ? (
        <button
          className="btn block"
          disabled={busy !== null}
          onClick={() =>
            void save(
              "location",
              { lat: null, lng: null },
              "Location removed. Others no longer see a distance.",
            )
          }
        >
          <Icon name="pin" size={18} /> Remove my location
        </button>
      ) : (
        <button className="btn block" disabled={busy !== null} onClick={shareLocation}>
          <Icon name="pin" size={18} /> {busy === "location" ? "Locating…" : "Share approximate location"}
        </button>
      )}

      <h3>Visibility</h3>
      <Toggle
        label="Pause my profile"
        hint="While paused, new people won't see you in Discover. Your matches and chats stay."
        checked={!!profile.hidden}
        disabled={busy !== null}
        onChange={(v) =>
          void save(
            "hidden",
            { hidden: v },
            v
              ? "Your profile is paused. New people won't see you."
              : "Your profile is visible in Discover again.",
          )
        }
      />
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="alert info" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

interface Blocked {
  id: string;
  display_name: string;
  blocked_at: string;
}

/** People you blocked, with unblock. */
export function BlockedList({ me }: { me: string }) {
  const [list, setList] = useState<Blocked[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc("my_blocked_users").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setError(
          /my_blocked_users/.test(error.message)
            ? "The blocked list isn't available until a pending database update is applied."
            : error.message,
        );
      } else setList((data ?? []) as Blocked[]);
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  async function unblock(b: Blocked) {
    setBusy(b.id);
    setError(null);
    const { error } = await supabase.from("blocks").delete().eq("blocker_id", me).eq("blocked_id", b.id);
    setBusy(null);
    if (error) setError(error.message);
    else setList((l) => (l ?? []).filter((x) => x.id !== b.id));
  }

  return (
    <div className="panel settings">
      <p className="muted small">
        Blocked people can't see you, like you or message you, and you won't see them. They aren't told that
        you blocked them.
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <div className="spinner" aria-hidden="true" />}
      {list && list.length === 0 && <p className="muted">You haven't blocked anyone.</p>}
      {list && list.length > 0 && (
        <ul className="blocked-list">
          {list.map((b) => (
            <li key={b.id}>
              <span>
                <strong>{b.display_name}</strong>
                <small className="muted">Blocked {new Date(b.blocked_at).toLocaleDateString()}</small>
              </span>
              <button className="btn small" disabled={busy === b.id} onClick={() => void unblock(b)}>
                {busy === b.id ? "Unblocking…" : "Unblock"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Help, safety and legal links. */
export function HelpSafety({ onSafetyIntro }: { onSafetyIntro: () => void }) {
  return (
    <div className="panel settings">
      <button className="menu-row" onClick={onSafetyIntro}>
        <Icon name="shield" size={20} />
        <span>
          <strong>Safety introduction</strong>
          <small className="muted">Five short tips for dating safely</small>
        </span>
        <Icon name="chevron" size={18} />
      </button>
      <a className="menu-row" href="/safety.html">
        <Icon name="info" size={20} />
        <span>
          <strong>Dating safety tips</strong>
          <small className="muted">Meeting in person, scams, getting help</small>
        </span>
        <Icon name="chevron" size={18} />
      </a>
      <p className="muted small">
        To report someone, open their profile or your chat with them and choose Report or block. Reports go to
        the SOULMATE.AI team; if you're in danger, contact local emergency services first.
      </p>
      <nav className="legal-links" aria-label="Legal">
        <a href="/privacy.html">Privacy Policy</a>
        <a href="/terms.html">Terms of Use</a>
        <a href="/delete-account.html">How account deletion works</a>
      </nav>
    </div>
  );
}
