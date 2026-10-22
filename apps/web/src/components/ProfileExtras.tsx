import { useRef, useState, type ChangeEvent } from "react";
import { preparePhoto } from "../photo";
import { coarse, type ProfileRow } from "../profile";
import { supabase } from "../supabase";
import { Icon, VerifiedBadge } from "./Icon";
import { Photo } from "./Photo";

type Patch = Partial<Pick<ProfileRow, "photo_path" | "lat" | "lng">>;

/** Photo upload and approximate location, shown above the profile form. */
export function ProfileExtras({
  profile,
  onChange,
}: {
  profile: ProfileRow;
  onChange: (patch: Patch) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"photo" | "location" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy("photo");
    setError(null);
    setNote(null);
    try {
      const blob = await preparePhoto(file);
      const path = `${profile.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("photos").upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (up.error) throw new Error(up.error.message);
      const { error } = await supabase.from("profiles").update({ photo_path: path }).eq("id", profile.id);
      if (error) throw new Error(error.message);
      const old = profile.photo_path;
      onChange({ photo_path: path });
      if (old) void supabase.storage.from("photos").remove([old]);
      setNote("Photo updated. Location data was removed from the image before upload.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  function shareLocation() {
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't share location.");
      return;
    }
    setBusy("location");
    setError(null);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Rounded on the device to about 1 km; the exact position is never sent.
        const lat = coarse(pos.coords.latitude);
        const lng = coarse(pos.coords.longitude);
        const { error } = await supabase.from("profiles").update({ lat, lng }).eq("id", profile.id);
        setBusy(null);
        if (error) setError(error.message);
        else {
          onChange({ lat, lng });
          setNote("Location saved (approximate, about 1 km). Others only see a distance.");
        }
      },
      (err) => {
        setBusy(null);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Couldn't get your location.",
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  }

  async function clearLocation() {
    setBusy("location");
    const { error } = await supabase.from("profiles").update({ lat: null, lng: null }).eq("id", profile.id);
    setBusy(null);
    if (error) setError(error.message);
    else {
      onChange({ lat: null, lng: null });
      setNote("Location removed.");
    }
  }

  const hasLocation = profile.lat != null && profile.lng != null;

  return (
    <div className="panel extras">
      <div className="me-row">
        <div className="me-photo">
          <Photo id={profile.id} name={profile.display_name} path={profile.photo_path} textSize={36} />
          <button
            className="cam"
            aria-label={profile.photo_path ? "Change photo" : "Add photo"}
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="camera" size={18} />
          </button>
        </div>
        <div>
          <h2 className="display-sm">
            {profile.display_name}, {profile.age} {profile.verified && <VerifiedBadge size={20} />}
          </h2>
          <p className="muted small">
            {profile.verified ? "Verified profile" : "Not verified yet"} ·{" "}
            {hasLocation ? "Distance shown to others" : "No location set"}
          </p>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      <div className="row-wrap">
        <button className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          <Icon name="camera" size={18} />
          {busy === "photo" ? "Uploading…" : profile.photo_path ? "Change photo" : "Add a photo"}
        </button>
        {hasLocation ? (
          <button className="btn" disabled={busy !== null} onClick={() => void clearLocation()}>
            <Icon name="pin" size={18} /> Remove location
          </button>
        ) : (
          <button className="btn" disabled={busy !== null} onClick={shareLocation}>
            <Icon name="pin" size={18} />
            {busy === "location" ? "Locating…" : "Show distance"}
          </button>
        )}
      </div>

      {error && <p className="alert error">{error}</p>}
      {note && <p className="alert info">{note}</p>}
    </div>
  );
}
