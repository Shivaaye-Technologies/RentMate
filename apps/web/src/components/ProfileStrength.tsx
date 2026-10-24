import { profileStrength, type ProfileRow } from "../profile";
import { Icon } from "./Icon";

/** Small reminder on the Crush screen, linking to the profile tab. */
export function StrengthNudge({ profile, onOpen }: { profile: ProfileRow; onOpen: () => void }) {
  const { score, total, percent, items } = profileStrength(profile);
  if (score >= total) return null;
  const firstMissing = items.find((i) => !i.done);
  return (
    <button className="nudge" onClick={onOpen}>
      <Icon name={firstMissing?.section === "photos" ? "camera" : "sparkle"} size={18} /> Profile {percent}%
      complete
      {firstMissing ? ` · add ${firstMissing.label.toLowerCase()}` : ""}
    </button>
  );
}
