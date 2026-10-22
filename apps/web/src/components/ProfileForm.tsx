import { useState, type FormEvent } from "react";
import {
  draftFromRow,
  LOOKING_FOR_LABELS,
  parseInterests,
  validateProfile,
  type DraftErrors,
  type LookingFor,
  type EditableProfile,
  type ProfileDraft,
  type ProfileRow,
} from "../profile";
import { supabase } from "../supabase";

interface Props {
  userId: string;
  initial: ProfileRow | null;
  title: string;
  subtitle?: string;
  submitLabel: string;
  onSaved: (row: EditableProfile & { id: string }) => void;
}

export function ProfileForm({ userId, initial, title, subtitle, submitLabel, onSaved }: Props) {
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromRow(initial));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const result = validateProfile(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    const row = { id: userId, ...result.row };
    const { error } = await supabase.from("profiles").upsert(row);
    setBusy(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaved(true);
    onSaved(row);
  }

  const chips = parseInterests(draft.interests);

  return (
    <form className="panel form" onSubmit={submit} noValidate>
      <h2 className="display-sm">{title}</h2>
      {subtitle && <p className="muted">{subtitle}</p>}

      <label className="field">
        <span>First name</span>
        <input
          value={draft.displayName}
          maxLength={40}
          autoComplete="given-name"
          onChange={(e) => set("displayName", e.target.value)}
        />
        {errors.displayName && <small className="err">{errors.displayName}</small>}
      </label>

      <div className="row">
        <label className="field">
          <span>Age</span>
          <input inputMode="numeric" value={draft.age} onChange={(e) => set("age", e.target.value)} />
          {errors.age && <small className="err">{errors.age}</small>}
        </label>
        <label className="field">
          <span>I'm here for</span>
          <select value={draft.lookingFor} onChange={(e) => set("lookingFor", e.target.value as LookingFor)}>
            {Object.entries(LOOKING_FOR_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>About you</span>
        <textarea
          rows={3}
          maxLength={500}
          placeholder="What makes a great weekend for you?"
          value={draft.bio}
          onChange={(e) => set("bio", e.target.value)}
        />
        {errors.bio && <small className="err">{errors.bio}</small>}
      </label>

      <label className="field">
        <span>Interests (comma separated)</span>
        <input
          placeholder="hiking, music, cooking, travel"
          value={draft.interests}
          onChange={(e) => set("interests", e.target.value)}
        />
        {errors.interests && <small className="err">{errors.interests}</small>}
      </label>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span key={c} className="chip">
              {c}
            </span>
          ))}
        </div>
      )}

      <fieldset className="field">
        <span>Show me people aged</span>
        <div className="row">
          <label className="field">
            <input
              aria-label="Minimum age"
              inputMode="numeric"
              value={draft.ageMin}
              onChange={(e) => set("ageMin", e.target.value)}
            />
            {errors.ageMin && <small className="err">{errors.ageMin}</small>}
          </label>
          <span className="to">to</span>
          <label className="field">
            <input
              aria-label="Maximum age"
              inputMode="numeric"
              value={draft.ageMax}
              onChange={(e) => set("ageMax", e.target.value)}
            />
            {errors.ageMax && <small className="err">{errors.ageMax}</small>}
          </label>
        </div>
      </fieldset>

      {saveError && <p className="alert error">{saveError}</p>}
      {saved && <p className="alert info">Profile saved.</p>}

      <button className="btn dark block" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
