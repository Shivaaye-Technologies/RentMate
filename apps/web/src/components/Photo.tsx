import { useEffect, useState } from "react";
import { hueFor, initials } from "../profile";
import { signedPhotoUrl } from "../supabase";

interface Props {
  id: string;
  name: string;
  path: string | null | undefined;
  className?: string;
  /** Font size for the initials placeholder. */
  textSize?: number;
}

/** A person's photo, or a colorful initials placeholder when they have none (or it can't load). */
export function Photo({ id, name, path, className = "", textSize = 40 }: Props) {
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void signedPhotoUrl(path).then((url) => {
      if (!cancelled) setLoaded({ path, url });
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const url = path && loaded?.path === path && failed !== path ? loaded.url : null;
  if (url) {
    return (
      <img
        className={`photo ${className}`}
        src={url}
        alt={`Photo of ${name}`}
        loading="lazy"
        onError={() => setFailed(path ?? null)}
      />
    );
  }
  const hue = hueFor(id);
  return (
    <div
      className={`photo placeholder ${className}`}
      role="img"
      aria-label={path ? `Loading photo of ${name}` : `${name} has no photo yet`}
      style={{
        fontSize: textSize,
        background: `linear-gradient(150deg, hsl(${hue} 65% 72%), hsl(${(hue + 50) % 360} 70% 58%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}
