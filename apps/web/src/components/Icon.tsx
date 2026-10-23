const PATHS = {
  cards: "M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 7v10",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  heart:
    "M12 20s-7-4.4-9.2-8.6C1.3 8.5 3 5 6.4 5c2 0 3.3 1.1 4 2.3h3.2C14.3 6.1 15.6 5 17.6 5 21 5 22.7 8.5 21.2 11.4 19 15.6 12 20 12 20z",
  chat: "M4 5h16v11H9l-5 4V5z",
  star: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
  x: "M6 6l12 12M18 6L6 18",
  undo: "M9 7H4v5M4 12a8 8 0 1 0 2.3-5.6L4 9",
  pin: "M12 21s-6-5.4-6-11a6 6 0 0 1 12 0c0 5.6-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  back: "M15 5l-7 7 7 7",
  check: "M5 12.5l4.5 4.5L19 7.5",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  sparkle: "M12 3v6M12 15v6M3 12h6M15 12h6",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  more: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

export type IconName = keyof typeof PATHS;

const FILLED: IconName[] = ["heart", "star", "bolt"];

export function Icon({ name, size = 22, filled }: { name: IconName; size?: number; filled?: boolean }) {
  const fill = filled ?? FILLED.includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={fill ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Verified badge (a rosette with a check). */
export function VerifiedBadge({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Verified" className="verified">
      <path
        fill="currentColor"
        d="M12 1.5l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-.9 2.9-3-.2L12 22.5l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.9-.9-2.9 2.5-1.7.9-2.9 3 .2z"
      />
      <path d="M8 12.3l2.7 2.7L16 9.7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
