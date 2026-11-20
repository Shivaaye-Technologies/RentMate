import { useId, useState } from "react";
import {
  addUnique,
  heightLabel,
  MAX_NEIGHBOURHOODS,
  MAX_PLACES,
  MAX_PROMPTS,
  PLACE_CATEGORIES,
  PROMPT_ANSWER_MAX,
  PROMPT_CATEGORIES,
  searchCities,
  type Prompt,
} from "../details";
import { Icon } from "./Icon";

/** Single-choice chips (a radio group). Tapping the chosen one again clears it when optional. */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  optional = true,
}: {
  label: string;
  options: Record<T, string>;
  value: T | null;
  onChange: (v: T | null) => void;
  optional?: boolean;
}) {
  return (
    <div className="field">
      <span>
        {label}
        {optional && <small className="muted"> · optional</small>}
      </span>
      <div className="chips pick" role="radiogroup" aria-label={label}>
        {(Object.entries(options) as [T, string][]).map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={value === v ? "chip toggle on" : "chip toggle"}
            onClick={() => onChange(value === v && optional ? null : v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Two thumbs on one track: minimum and maximum (for example an age range). */
export function RangeSlider({
  label,
  min,
  max,
  low,
  high,
  onChange,
  format = String,
}: {
  label: string;
  min: number;
  max: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  format?: (n: number) => string;
}) {
  const span = max - min || 1;
  const left = ((low - min) / span) * 100;
  const right = ((high - min) / span) * 100;
  return (
    <div className="field range">
      <span>
        {label}: <strong>{format(low)}</strong> to <strong>{format(high)}</strong>
      </span>
      <div className="range-track">
        <i className="range-fill" style={{ left: `${left}%`, width: `${right - left}%` }} />
        <input
          type="range"
          aria-label={`${label}: minimum`}
          min={min}
          max={max}
          value={low}
          onChange={(e) => onChange(Math.min(Number(e.target.value), high), high)}
        />
        <input
          type="range"
          aria-label={`${label}: maximum`}
          min={min}
          max={max}
          value={high}
          onChange={(e) => onChange(low, Math.max(Number(e.target.value), low))}
        />
      </div>
    </div>
  );
}

/** Optional height: a slider plus "prefer not to say". */
export function HeightField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span>
        Height <small className="muted">· optional</small>
      </span>
      {value === null ? (
        <button type="button" className="btn small" onClick={() => onChange(170)}>
          Add your height
        </button>
      ) : (
        <>
          <label htmlFor={id} className="slider-value">
            {heightLabel(value)}
          </label>
          <input
            id={id}
            type="range"
            className="single-range"
            min={120}
            max={230}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <button type="button" className="btn link small-link" onClick={() => onChange(null)}>
            Prefer not to say
          </button>
        </>
      )}
    </div>
  );
}

/** Pick up to three prompts and write answers. Answers are plain text (never HTML). */
export function PromptEditor({ value, onChange }: { value: Prompt[]; onChange: (v: Prompt[]) => void }) {
  const [picking, setPicking] = useState(false);
  const used = new Set(value.map((p) => p.q));
  const full = value.length >= MAX_PROMPTS;
  const update = (i: number, patch: Partial<Prompt>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="prompt-editor">
      <p className="muted small">
        {value.length} of {MAX_PROMPTS} prompts · answers are shown on your profile
      </p>
      {value.map((p, i) => (
        <div key={p.q} className="prompt-card editing">
          <div className="prompt-q">
            <Icon name="quote" size={16} /> <strong>{p.q}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove prompt: ${p.q}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
          <label className="field">
            <span className="sr-only">Your answer to {p.q}</span>
            <textarea
              rows={2}
              maxLength={PROMPT_ANSWER_MAX}
              placeholder="Your answer…"
              value={p.a}
              onChange={(e) => update(i, { a: e.target.value })}
            />
            <small className="muted">
              {p.a.length}/{PROMPT_ANSWER_MAX}
            </small>
          </label>
        </div>
      ))}
      {!full && !picking && (
        <button type="button" className="btn block" onClick={() => setPicking(true)}>
          <Icon name="plus" size={18} /> Add a prompt
        </button>
      )}
      {picking && (
        <div className="prompt-picker" role="group" aria-label="Choose a prompt">
          {PROMPT_CATEGORIES.map((c) => (
            <details key={c.name} open={c.name === "About me"}>
              <summary>{c.name}</summary>
              <div className="chips pick">
                {c.questions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="chip toggle"
                    disabled={used.has(q)}
                    onClick={() => {
                      onChange([...value, { q, a: "" }]);
                      setPicking(false);
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </details>
          ))}
          <button type="button" className="btn link" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Searchable city box with suggestions; any city can be typed in. */
export function CityField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [query, setQuery] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const suggestions = searchCities(query).filter((c) => c !== value);
  return (
    <div className="field city-field">
      <label htmlFor={`${listId}-in`}>
        City <small className="muted">· shown on your profile</small>
      </label>
      <input
        id={`${listId}-in`}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search or type your city"
        maxLength={60}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          onChange(e.target.value.trim() ? e.target.value : null);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <ul id={listId} role="listbox" className="suggestions">
          {suggestions.map((c) => (
            <li key={c} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery(c);
                  onChange(c);
                  setOpen(false);
                }}
              >
                <Icon name="pin" size={14} /> {c}
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="muted">Only your city is shown. Your exact location is never shared.</small>
    </div>
  );
}

/** Free-text chips (for neighbourhoods): type, press Enter or Add. */
export function ChipInput({
  label,
  hint,
  value,
  onChange,
  max,
  maxLen,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  maxLen: number;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const id = useId();
  const full = value.length >= max;
  const add = () => {
    onChange(addUnique(value, text, max, maxLen));
    setText("");
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <small className="muted">· optional, up to {max}</small>
      </label>
      {value.length > 0 && (
        <div className="chips">
          {value.map((v) => (
            <button
              key={v}
              type="button"
              className="chip toggle on"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              {v} ×
            </button>
          ))}
        </div>
      )}
      <div className="row add-own">
        <input
          id={id}
          placeholder={placeholder}
          maxLength={maxLen}
          value={text}
          disabled={full}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn" disabled={!text.trim() || full} onClick={add}>
          Add
        </button>
      </div>
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

export function NeighbourhoodsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <ChipInput
      label="Favourite neighbourhoods"
      hint="Type the areas you like to spend time in."
      value={value}
      onChange={onChange}
      max={MAX_NEIGHBOURHOODS}
      maxLen={40}
      placeholder="For example, an area near you"
    />
  );
}

/** Favourite kinds of places: searchable, collapsible categories, up to 10, plus your own. */
export function PlacesPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const q = query.trim().toLowerCase();
  const full = value.length >= MAX_PLACES;
  const has = (p: string) => value.some((v) => v.toLowerCase() === p.toLowerCase());
  const toggle = (p: string) =>
    onChange(
      has(p) ? value.filter((v) => v.toLowerCase() !== p.toLowerCase()) : addUnique(value, p, MAX_PLACES, 60),
    );
  const groups = PLACE_CATEGORIES.map((c) => ({
    ...c,
    items: c.items.filter((i) => !q || i.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)),
  })).filter((c) => c.items.length > 0);

  return (
    <div className="field places-picker">
      <span>
        Favourite places <small className="muted">· optional, up to {MAX_PLACES}</small>
      </span>
      <p className="muted small">
        {value.length} of {MAX_PLACES} picked. These are kinds of places, so they work in any city.
      </p>
      {value.length > 0 && (
        <div className="chips" aria-label="Your favourite places">
          {value.map((v) => (
            <button
              key={v}
              type="button"
              className="chip toggle on"
              aria-label={`Remove ${v}`}
              onClick={() => toggle(v)}
            >
              {v} ×
            </button>
          ))}
        </div>
      )}
      <input
        type="search"
        aria-label="Search places"
        placeholder="Search: coffee, trails, museums…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {groups.map((c) => (
        <details key={c.name} open={!!q}>
          <summary>
            {c.name}
            <small className="muted"> · {c.items.filter(has).length} picked</small>
          </summary>
          <div className="chips pick">
            {c.items.map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={has(i)}
                className={has(i) ? "chip toggle on" : "chip toggle"}
                disabled={!has(i) && full}
                onClick={() => toggle(i)}
              >
                {i}
              </button>
            ))}
          </div>
        </details>
      ))}
      {groups.length === 0 && <p className="muted small">No match. Add it as your own below.</p>}
      <div className="row add-own">
        <input
          aria-label="Add your own place"
          placeholder="Add your own"
          maxLength={60}
          value={custom}
          disabled={full}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onChange(addUnique(value, custom, MAX_PLACES, 60));
              setCustom("");
            }
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={!custom.trim() || full}
          onClick={() => {
            onChange(addUnique(value, custom, MAX_PLACES, 60));
            setCustom("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
