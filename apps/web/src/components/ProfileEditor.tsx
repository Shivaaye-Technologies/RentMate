import { useState, type FormEvent } from "react";
import {
  CHILDREN_LABELS,
  detailsFromRow,
  EDUCATION_LABELS,
  EMPTY_DETAILS,
  EXERCISE_LABELS,
  GENDER_LABELS,
  SHOW_ME_LABELS,
  SMOKING_LABELS,
  validateDetails,
  type DetailErrors,
  type DetailFields,
} from "../details";
import {
  BIO_PROMPTS,
  draftFromRow,
  LOOKING_FOR_LABELS,
  validateProfile,
  type DraftErrors,
  type LookingFor,
  type ProfileDraft,
  type ProfileRow,
} from "../profile";
import { saveProfileFields, type ProfilePatch } from "../profileApi";
import {
  ChoiceChips,
  CityField,
  HeightField,
  NeighbourhoodsField,
  PlacesPicker,
  PromptEditor,
  RangeSlider,
} from "./Editors";
import { InterestPicker } from "./InterestPicker";

export type EditSection = "about" | "interests" | "prompts" | "lifestyle" | "places" | "preferences";

export const SECTION_TITLES: Record<EditSection, string> = {
  about: "About you",
  interests: "Interests",
  prompts: "Profile prompts",
  lifestyle: "Work and lifestyle",
  places: "City and places",
  preferences: "Dating preferences",
};

/** Fields from the core profile form and from details, used by the section editors and onboarding. */
export interface EditorState {
  core: ProfileDraft;
  details: DetailFields;
}

export function editorStateFrom(row: ProfileRow | null): EditorState {
  return {
    core: draftFromRow(row),
    details: detailsFromRow(row as Parameters<typeof detailsFromRow>[0]),
  };
}

/** The input fields for one section (no save button), shared with onboarding. */
export function SectionFields({
  section,
  state,
  onChange,
  coreErrors = {},
  detailErrors = {},
  part,
}: {
  section: EditSection;
  state: EditorState;
  onChange: (s: EditorState) => void;
  coreErrors?: DraftErrors;
  detailErrors?: DetailErrors;
  /** For "about": only name and age ("basics") or only the bio ("bio"). */
  part?: "basics" | "bio";
}) {
  const { core, details } = state;
  const setCore = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) =>
    onChange({ ...state, core: { ...core, [k]: v } });
  const setDetail = <K extends keyof DetailFields>(k: K, v: DetailFields[K]) =>
    onChange({ ...state, details: { ...details, [k]: v } });
  const num = (s: string, fallback: number) => (/^\d+$/.test(s) ? Number(s) : fallback);

  switch (section) {
    case "about":
      return (
        <>
          {part !== "bio" && (
            <>
              <label className="field">
                <span>First name</span>
                <input
                  value={core.displayName}
                  maxLength={40}
                  autoComplete="given-name"
                  onChange={(e) => setCore("displayName", e.target.value)}
                />
                {coreErrors.displayName && <small className="err">{coreErrors.displayName}</small>}
              </label>
              <label className="field">
                <span>Age</span>
                <input
                  inputMode="numeric"
                  value={core.age}
                  onChange={(e) => setCore("age", e.target.value)}
                />
                {coreErrors.age && <small className="err">{coreErrors.age}</small>}
              </label>
              <p className="fine">You must be 18 or older to use RentMate.</p>
            </>
          )}
          {part !== "basics" && (
            <>
              <div className="chips" aria-label="Ideas to start with">
                {BIO_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="chip toggle"
                    onClick={() => setCore("bio", core.bio.trim() ? `${core.bio.trim()} ${p}` : p)}
                  >
                    {p.trim()}…
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Bio</span>
                <textarea
                  rows={4}
                  maxLength={500}
                  placeholder="What makes a great weekend for you?"
                  value={core.bio}
                  onChange={(e) => setCore("bio", e.target.value)}
                />
                <small className="muted">{core.bio.length}/500</small>
                {coreErrors.bio && <small className="err">{coreErrors.bio}</small>}
              </label>
            </>
          )}
        </>
      );
    case "interests":
      return (
        <InterestPicker
          value={core.interests}
          onChange={(v) => setCore("interests", v)}
          error={coreErrors.interests}
        />
      );
    case "prompts":
      return (
        <>
          <PromptEditor value={details.prompts} onChange={(v) => setDetail("prompts", v)} />
          {detailErrors.prompts && <small className="err">{detailErrors.prompts}</small>}
        </>
      );
    case "lifestyle":
      return (
        <>
          <ChoiceChips
            label="Gender"
            options={GENDER_LABELS}
            value={details.gender}
            onChange={(v) => setDetail("gender", v)}
          />
          <HeightField value={details.height_cm} onChange={(v) => setDetail("height_cm", v)} />
          {detailErrors.height_cm && <small className="err">{detailErrors.height_cm}</small>}
          <label className="field">
            <span>
              Work <small className="muted">· optional</small>
            </span>
            <input
              maxLength={60}
              placeholder="Job title or field"
              value={details.job ?? ""}
              onChange={(e) => setDetail("job", e.target.value || null)}
            />
          </label>
          <ChoiceChips
            label="Education"
            options={EDUCATION_LABELS}
            value={details.education}
            onChange={(v) => setDetail("education", v)}
          />
          <ChoiceChips
            label="Exercise"
            options={EXERCISE_LABELS}
            value={details.exercise}
            onChange={(v) => setDetail("exercise", v)}
          />
          <ChoiceChips
            label="Smoking"
            options={SMOKING_LABELS}
            value={details.smoking}
            onChange={(v) => setDetail("smoking", v)}
          />
          <ChoiceChips
            label="Children"
            options={CHILDREN_LABELS}
            value={details.children}
            onChange={(v) => setDetail("children", v)}
          />
          <p className="fine">
            Every field here is optional and shown on your profile. Leave out anything you prefer not to
            share.
          </p>
        </>
      );
    case "places":
      return (
        <>
          <CityField value={details.city} onChange={(v) => setDetail("city", v)} />
          {detailErrors.city && <small className="err">{detailErrors.city}</small>}
          <NeighbourhoodsField
            value={details.neighbourhoods}
            onChange={(v) => setDetail("neighbourhoods", v)}
          />
          <PlacesPicker value={details.favourite_places} onChange={(v) => setDetail("favourite_places", v)} />
        </>
      );
    case "preferences":
      return (
        <>
          <ChoiceChips<LookingFor>
            label="I'm here for"
            options={LOOKING_FOR_LABELS}
            value={core.lookingFor}
            optional={false}
            onChange={(v) => v && setCore("lookingFor", v)}
          />
          <ChoiceChips
            label="Show me"
            options={SHOW_ME_LABELS}
            value={details.show_me}
            onChange={(v) => setDetail("show_me", v)}
          />
          <p className="fine">
            Saved to your profile settings. For now Discover shows everyone whose age range fits yours; it
            doesn't filter by gender yet.
          </p>
          <RangeSlider
            label="Ages"
            min={18}
            max={100}
            low={num(core.ageMin, 18)}
            high={num(core.ageMax, 100)}
            onChange={(lo, hi) =>
              onChange({ ...state, core: { ...core, ageMin: String(lo), ageMax: String(hi) } })
            }
          />
          {(coreErrors.ageMin || coreErrors.ageMax) && (
            <small className="err">{coreErrors.ageMin ?? coreErrors.ageMax}</small>
          )}
        </>
      );
  }
}

const CORE_KEYS: Record<EditSection, (keyof DraftErrors)[]> = {
  about: ["displayName", "age", "bio"],
  interests: ["interests"],
  preferences: ["lookingFor", "ageMin", "ageMax"],
  prompts: [],
  lifestyle: [],
  places: [],
};

const DETAIL_KEYS: Record<EditSection, (keyof DetailFields)[]> = {
  about: [],
  interests: [],
  preferences: ["show_me"],
  prompts: ["prompts"],
  lifestyle: ["gender", "height_cm", "job", "education", "exercise", "smoking", "children"],
  places: ["city", "neighbourhoods", "favourite_places"],
};

/** Validates one section and returns just the columns it writes. */
export function sectionPatch(
  section: EditSection,
  state: EditorState,
): { ok: true; patch: ProfilePatch } | { ok: false; core: DraftErrors; details: DetailErrors } {
  const coreKeys = CORE_KEYS[section];
  const detKeys = DETAIL_KEYS[section];
  const patch: ProfilePatch = {};
  const coreErr: DraftErrors = {};
  const detErr: DetailErrors = {};

  if (coreKeys.length > 0) {
    const core = validateProfile(state.core);
    if (!core.ok) {
      for (const k of coreKeys) if (core.errors[k]) coreErr[k] = core.errors[k];
    } else {
      const r = core.row;
      if (section === "about") Object.assign(patch, { display_name: r.display_name, age: r.age, bio: r.bio });
      if (section === "interests") patch.interests = r.interests;
      if (section === "preferences") {
        Object.assign(patch, { looking_for: r.looking_for, age_min: r.age_min, age_max: r.age_max });
      }
    }
  }

  if (detKeys.length > 0) {
    // Only this section's fields are checked, so other sections can't block saving.
    const only = { ...EMPTY_DETAILS };
    for (const k of detKeys) Object.assign(only, { [k]: state.details[k] });
    const det = validateDetails(only);
    if (!det.ok) Object.assign(detErr, det.errors);
    else for (const k of detKeys) Object.assign(patch, { [k]: det.row[k] });
  }

  if (Object.keys(coreErr).length || Object.keys(detErr).length) {
    return { ok: false, core: coreErr, details: detErr };
  }
  // A core error outside this section (unlikely) means nothing core was saved; report it.
  if (coreKeys.length > 0 && Object.keys(patch).length === 0) {
    return { ok: false, core: { displayName: "Check the About you section first." }, details: {} };
  }
  return { ok: true, patch };
}

/** Edit one section of your profile and save just those fields. */
export function ProfileEditor({
  section,
  profile,
  onSaved,
  onCancel,
}: {
  section: EditSection;
  profile: ProfileRow;
  onSaved: (patch: ProfilePatch) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState(() => editorStateFrom(profile));
  const [errors, setErrors] = useState<{ core: DraftErrors; details: DetailErrors }>({
    core: {},
    details: {},
  });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setSaveError(null);
    const result = sectionPatch(section, state);
    if (!result.ok) {
      setErrors({ core: result.core, details: result.details });
      return;
    }
    setErrors({ core: {}, details: {} });
    setBusy(true);
    try {
      await saveProfileFields(profile.id, result.patch);
      onSaved(result.patch);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form editor" onSubmit={submit} noValidate aria-label={SECTION_TITLES[section]}>
      <SectionFields
        section={section}
        state={state}
        onChange={setState}
        coreErrors={errors.core}
        detailErrors={errors.details}
      />
      {saveError && (
        <p className="alert error" role="alert">
          {saveError}
        </p>
      )}
      <div className="row step-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn dark grow" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
