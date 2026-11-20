import { useRef, useState, type ChangeEvent } from "react";
import { MAX_PHOTOS, movePhoto, photoColumns, preparePhoto } from "../photo";
import { allPhotos, type ProfileRow } from "../profile";
import { saveProfileFields } from "../profileApi";
import { supabase } from "../supabase";
import { Icon } from "./Icon";
import { Photo } from "./Photo";

type PhotoPatch = Pick<ProfileRow, "photo_path" | "photos">;

/**
 * Up to six photos: add, remove, reorder, choose the main one. Photos are
 * resized and stripped of location data in the browser before upload, and
 * stored in your own private folder.
 */
export function PhotoManager({
  profile,
  onChange,
}: {
  profile: ProfileRow;
  onChange: (patch: PhotoPatch) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = allPhotos(profile);

  async function save(next: string[], message: string) {
    const cols = photoColumns(next);
    // Older databases only have the single photo column; keep that working.
    const extra = next.length > 1 || (profile.photos ?? []).length > 0;
    await saveProfileFields(profile.id, extra ? cols : { photo_path: cols.photo_path });
    onChange(cols);
    setNote(message);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    setBusy("upload");
    setError(null);
    setNote(null);
    let uploaded: string | null = null;
    try {
      const blob = await preparePhoto(file);
      const path = `${profile.id}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("photos").upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      uploaded = path;
      await save([...list, path], "Photo added. Location data was removed from the image before upload.");
    } catch (err) {
      // Don't leave an orphaned file if saving the profile failed.
      if (uploaded) void supabase.storage.from("photos").remove([uploaded]);
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function run(key: string, next: string[], message: string, remove?: string) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await save(next, message);
      if (remove) void supabase.storage.from("photos").remove([remove]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update photos.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="photo-manager">
      <p className="muted small">
        {list.length} of {MAX_PHOTOS} photos. The first one is your main photo.
      </p>
      <ol className="photo-grid">
        {list.map((path, i) => (
          <li key={path} className={i === 0 ? "slot main" : "slot"}>
            <Photo id={profile.id} name={profile.display_name} path={path} textSize={28} />
            {i === 0 && <span className="pill white slot-tag">Main</span>}
            <div className="slot-actions">
              {i > 0 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Make photo ${i + 1} your main photo`}
                  disabled={!!busy}
                  onClick={() => void run(`main-${i}`, movePhoto(list, i, 0), "Main photo changed.")}
                >
                  <Icon name="star" size={16} />
                </button>
              )}
              {i > 0 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move photo ${i + 1} earlier`}
                  disabled={!!busy}
                  onClick={() => void run(`up-${i}`, movePhoto(list, i, i - 1), "Photos reordered.")}
                >
                  <Icon name="back" size={16} />
                </button>
              )}
              {i < list.length - 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move photo ${i + 1} later`}
                  disabled={!!busy}
                  onClick={() => void run(`down-${i}`, movePhoto(list, i, i + 1), "Photos reordered.")}
                >
                  <Icon name="chevron" size={16} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`Delete photo ${i + 1}`}
                disabled={!!busy}
                onClick={() =>
                  void run(
                    `del-${i}`,
                    list.filter((p) => p !== path),
                    "Photo deleted.",
                    path,
                  )
                }
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        ))}
        {list.length < MAX_PHOTOS && (
          <li className="slot add">
            <button
              type="button"
              className="add-photo"
              disabled={!!busy}
              aria-label="Add a photo"
              onClick={() => fileRef.current?.click()}
            >
              {busy === "upload" ? (
                <>
                  <span className="spinner small" aria-hidden="true" />
                  <span>Uploading…</span>
                </>
              ) : (
                <>
                  <Icon name="plus" size={26} />
                  <span>Add photo</span>
                </>
              )}
            </button>
          </li>
        )}
      </ol>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
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
      <p className="fine">
        Only signed-in members can see your photos, through links that expire after an hour. Don't upload
        photos of other people without their permission.
      </p>
    </div>
  );
}
