import { hueFor, initials } from "../profile";
import { photoUrl } from "../supabase";

interface Props {
  id: string;
  name: string;
  path: string | null | undefined;
  className?: string;
  /** Font size for the initials placeholder. */
  textSize?: number;
}

/** A person's photo, or a colorful initials placeholder when they have none. */
export function Photo({ id, name, path, className = "", textSize = 40 }: Props) {
  const url = photoUrl(path);
  if (url) {
    return <img className={`photo ${className}`} src={url} alt={`Photo of ${name}`} loading="lazy" />;
  }
  const hue = hueFor(id);
  return (
    <div
      className={`photo placeholder ${className}`}
      role="img"
      aria-label={`${name} has no photo yet`}
      style={{
        fontSize: textSize,
        background: `linear-gradient(150deg, hsl(${hue} 65% 72%), hsl(${(hue + 50) % 360} 70% 58%))`,
      }}
    >
      {initials(name)}
    </div>
  );
}
