import { useState } from "react";
import { applyTheme, readTheme, THEME_CHOICES, type ThemeChoice } from "../theme";

/** System / Light / Dark switch. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return (
    <div className={`theme-toggle ${className}`.trim()} role="radiogroup" aria-label="Appearance">
      {THEME_CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={choice === c.value}
          className={choice === c.value ? "on" : ""}
          onClick={() => {
            applyTheme(c.value);
            setChoice(c.value);
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
