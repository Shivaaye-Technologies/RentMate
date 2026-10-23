import { useState } from "react";
import { canonicalInterest, interestKey, STANDARD_INTERESTS } from "../interests";
import { dedupeInterests, MAX_INTERESTS, parseInterests } from "../profile";

/**
 * Tap-to-pick interests from the standard list, plus your own. The value is the
 * same comma-separated text the profile form already uses.
 */
export function InterestPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string;
}) {
  const [custom, setCustom] = useState("");
  const selected = dedupeInterests(parseInterests(value).map(canonicalInterest));
  const keys = new Set(selected.map(interestKey));
  const write = (list: string[]) => onChange(list.join(", "));
  const toggle = (item: string) =>
    write(
      keys.has(interestKey(item))
        ? selected.filter((s) => interestKey(s) !== interestKey(item))
        : [...selected, item],
    );
  const own = selected.filter((s) => !(STANDARD_INTERESTS as readonly string[]).includes(s));
  const full = selected.length >= MAX_INTERESTS;

  const addCustom = () => {
    const item = canonicalInterest(custom).slice(0, 30);
    if (item && !keys.has(interestKey(item)) && !full) write([...selected, item]);
    setCustom("");
  };

  return (
    <div className="interest-picker">
      <p className="muted small">
        {selected.length} of {MAX_INTERESTS} picked
        {selected.length < 3 ? " · pick at least 3 for better matches" : ""}
      </p>
      <div className="chips pick" role="group" aria-label="Interests">
        {STANDARD_INTERESTS.map((i) => {
          const on = keys.has(interestKey(i));
          return (
            <button
              key={i}
              type="button"
              className={on ? "chip toggle on" : "chip toggle"}
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(i)}
            >
              {i}
            </button>
          );
        })}
        {own.map((i) => (
          <button key={i} type="button" className="chip toggle on" aria-pressed onClick={() => toggle(i)}>
            {i} ×
          </button>
        ))}
      </div>
      <div className="row add-own">
        <input
          aria-label="Add your own interest"
          placeholder="Add your own"
          maxLength={30}
          value={custom}
          disabled={full}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" className="btn" disabled={!custom.trim() || full} onClick={addCustom}>
          Add
        </button>
      </div>
      {error && <small className="err">{error}</small>}
    </div>
  );
}
