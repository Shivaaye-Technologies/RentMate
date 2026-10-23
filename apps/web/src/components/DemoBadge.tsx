import { useIsDemo } from "../demo";

/** "Demo" label on fictional demo profiles (only testers ever see them). */
export function DemoBadge({ id }: { id: string }) {
  if (!useIsDemo(id)) return null;
  return (
    <span className="demo-badge" title="Fictional demo profile, visible only to testers">
      Demo
    </span>
  );
}
