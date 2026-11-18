import { useIsDemo } from "../demo";

/** "Fictional" label on demo profiles (Demo Mode and tester accounts only). */
export function DemoBadge({ id }: { id: string }) {
  if (!useIsDemo(id)) return null;
  return (
    <span className="demo-badge" title="Fictional demo profile, not a real member">
      Fictional
    </span>
  );
}
