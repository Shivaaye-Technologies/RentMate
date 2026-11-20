import { useEffect, useState } from "react";
import { ageOn, birthDateError, latestAdultBirthDate } from "../age";
import { personFromOwnRow } from "../api";
import {
  CHILDREN_LABELS,
  EDUCATION_LABELS,
  EXERCISE_LABELS,
  GENDER_LABELS,
  SMOKING_LABELS,
  validateDetails,
  type DetailErrors,
} from "../details";
import { stepErrors, validateProfile, type DraftErrors, type ProfileRow } from "../profile";
import { isMissingColumn, saveErrorMessage, type ProfilePatch } from "../profileApi";
import { supabase } from "../supabase";
import { ChoiceChips, HeightField } from "./Editors";
import { PersonDetails } from "./PersonDetails";
import { PhotoManager } from "./PhotoManager";
import { ProfileCardPreview } from "./ProfileCardPreview";
import { editorStateFrom, SectionFields, type EditorState } from "./ProfileEditor";
import { NotificationSettings, PrivacySettings } from "./Settings";

export const STEPS = [
  "basics",
  "identity",
  "goals",
  "work",
  "lifestyle",
  "interests",
  "about",
  "places",
  "photos",
  "privacy",
  "notifications",
  "preview",
] as const;
export type Step = (typeof STEPS)[number];

/** The profile is saved after this step; later steps change the saved profile directly. */
const SAVE_AFTER: Step = "places";
const OPTIONAL: Step[] = [
  "identity",
  "work",
  "lifestyle",
  "interests",
  "about",
  "places",
  "photos",
  "privacy",
  "notifications",
];

const TITLES: Record<Step, { title: string; subtitle: string }> = {
  basics: { title: "Let's start with you", subtitle: "Your first name and age appear on your profile." },
  identity: {
    title: "A little about you",
    subtitle: "Both are optional. Share only what you're comfortable with.",
  },
  goals: {
    title: "What are you looking for?",
    subtitle: "We only show you people whose ages fit both ways.",
  },
  work: { title: "Work and education", subtitle: "Optional. Shown on your profile if you add them." },
  lifestyle: { title: "Your lifestyle", subtitle: "Optional. Helps people find things in common." },
  interests: { title: "What do you love?", subtitle: "Shared interests decide who you see first. Up to 10." },
  about: {
    title: "Say a little about yourself",
    subtitle: "A short bio and a prompt or two give people something to reply to.",
  },
  places: {
    title: "Where do you hang out?",
    subtitle: "Your city is shown on your profile. Your exact location never is.",
  },
  photos: { title: "Add your photos", subtitle: "Optional, but profiles with photos get far more likes." },
  privacy: {
    title: "Distance and privacy",
    subtitle: "Optional. You can change this any time in your profile.",
  },
  notifications: { title: "Stay in the loop", subtitle: "Choose what you'd like to hear about." },
  preview: { title: "Here's your profile", subtitle: "This is how other members will see you." },
};

interface Saved {
  step: Step;
  state: EditorState;
}

const draftKey = (userId: string) => `soulmate-onboarding-${userId}`;

function loadDraft(userId: string): Saved | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Saved;
    return STEPS.includes(d.step) && STEPS.indexOf(d.step) <= STEPS.indexOf(SAVE_AFTER) && d.state?.core
      ? d
      : null;
  } catch {
    return null;
  }
}

function storeDraft(userId: string, d: Saved | null) {
  try {
    if (d) localStorage.setItem(draftKey(userId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(userId));
  } catch {
    // Without storage the draft only lasts for this visit.
  }
}

/**
 * Step-by-step profile setup for new members. Progress is kept on this device
 * between visits, optional steps can be skipped, and the 18+ rule uses the
 * same validation as the database. The profile is saved once, after the
 * places step; photos, privacy and notifications then save as you go.
 */
export function Onboarding({
  userId,
  onDone,
  onSignOut,
}: {
  userId: string;
  onDone: (profile: ProfileRow) => void;
  onSignOut: () => void;
}) {
  const [initial] = useState(() => loadDraft(userId));
  const [step, setStep] = useState<Step>(initial?.step ?? "basics");
  const [state, setState] = useState<EditorState>(initial?.state ?? editorStateFrom(null));
  const [errors, setErrors] = useState<{ core: DraftErrors; details: DetailErrors }>({
    core: {},
    details: {},
  });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProfileRow | null>(null);
  // Date of birth and 18+ confirmation (P2-03): a self-declaration, not verification. Kept in memory only (not in the
  // on-device draft); the server records it privately with attest_adult and derives the profile age from it.
  const [birthDate, setBirthDate] = useState("");
  const [adultOk, setAdultOk] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);
  const index = STEPS.indexOf(step);
  const beforeSave = index <= STEPS.indexOf(SAVE_AFTER);

  useEffect(() => {
    if (!saved) storeDraft(userId, { step, state });
  }, [userId, step, state, saved]);

  const setDetail = <K extends keyof EditorState["details"]>(k: K, v: EditorState["details"][K]) =>
    setState((s) => ({ ...s, details: { ...s.details, [k]: v } }));

  /** A message when the date of birth or the 18+ confirmation is missing or not acceptable. */
  function adultProblem(): string | null {
    return birthDateError(birthDate) ?? (adultOk ? null : "Please confirm that you are 18 or older.");
  }

  /** The editor state with the age taken from the date of birth, when it is valid. */
  function coreWithAge(): EditorState["core"] {
    const years = ageOn(birthDate);
    return years !== null && years >= 18 ? { ...state.core, age: String(years) } : state.core;
  }

  function checkStep(): boolean {
    if (step === "basics") {
      const problem = adultProblem();
      setDobError(problem);
      if (problem) return false;
    }
    const core: DraftErrors =
      step === "basics"
        ? stepErrors(coreWithAge(), ["displayName", "age"])
        : step === "goals"
          ? stepErrors(state.core, ["lookingFor", "ageMin", "ageMax"])
          : step === "interests"
            ? stepErrors(state.core, ["interests"])
            : step === "about"
              ? stepErrors(state.core, ["bio"])
              : {};
    const det = validateDetails(state.details);
    const details: DetailErrors = det.ok ? {} : det.errors;
    const relevant: Record<Step, (keyof DetailErrors)[]> = {
      basics: [],
      identity: ["gender", "height_cm"],
      goals: ["show_me"],
      work: ["job", "education"],
      lifestyle: ["exercise", "smoking", "children"],
      interests: [],
      about: ["prompts"],
      places: ["city", "neighbourhoods", "favourite_places"],
      photos: [],
      privacy: [],
      notifications: [],
      preview: [],
    };
    const detailErrs: DetailErrors = {};
    for (const k of relevant[step]) if (details[k]) detailErrs[k] = details[k] as string;
    setErrors({ core, details: detailErrs });
    return Object.keys(core).length === 0 && Object.keys(detailErrs).length === 0;
  }

  async function save(): Promise<boolean> {
    const problem = adultProblem();
    if (problem) {
      setDobError(problem);
      setSaveError("Please add your date of birth and confirm that you are 18 or older.");
      setStep("basics");
      return false;
    }
    const core = validateProfile(coreWithAge());
    const det = validateDetails(state.details);
    if (!core.ok) {
      setErrors({ core: core.errors, details: {} });
      setSaveError("Please check your name, age and age range.");
      setStep("basics");
      return false;
    }
    if (!det.ok) {
      setErrors({ core: {}, details: det.errors });
      return false;
    }
    setBusy(true);
    // Recorded privately before the profile exists. PGRST202: the database update is not applied yet, so continue.
    const attested = await supabase.rpc("attest_adult", { p_birth_date: birthDate, p_confirm: adultOk });
    if (attested.error && attested.error.code !== "PGRST202") {
      setBusy(false);
      setSaveError(attested.error.message);
      setStep("basics");
      return false;
    }
    const row = { id: userId, ...core.row, ...det.row };
    let { error } = await supabase.from("profiles").upsert(row);
    let partial = false;
    if (error && isMissingColumn(error)) {
      // The details columns aren't in the database yet: save the essentials so you can start.
      ({ error } = await supabase.from("profiles").upsert({ id: userId, ...core.row }));
      partial = true;
    }
    setBusy(false);
    if (error) {
      setSaveError(saveErrorMessage(error));
      return false;
    }
    if (partial) {
      setNotice(
        "Your profile is saved. Some details (like city and prompts) will be added once an update is finished.",
      );
    }
    setSaved({
      ...(partial ? { id: userId, ...core.row } : row),
      photo_path: null,
      lat: null,
      lng: null,
      verified: false,
    } as ProfileRow);
    storeDraft(userId, null);
    return true;
  }

  async function next() {
    setSaveError(null);
    if (busy) return;
    if (beforeSave && !checkStep()) return;
    if (step === SAVE_AFTER && !saved && !(await save())) return;
    if (step === "preview" && saved) {
      onDone(saved);
      return;
    }
    setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]);
  }

  const back = () => {
    setErrors({ core: {}, details: {} });
    setSaveError(null);
    setStep(STEPS[Math.max(0, index - 1)]);
  };

  const patchSaved = (patch: ProfilePatch) => setSaved((s) => (s ? ({ ...s, ...patch } as ProfileRow) : s));
  const { title, subtitle } = TITLES[step];
  const skippable = OPTIONAL.includes(step);
  const fields = { state, onChange: setState, coreErrors: errors.core, detailErrors: errors.details };
  // Steps after saving can't go back into the pre-save form (it is already saved).
  const canGoBack = index > 0 && (beforeSave || index > STEPS.indexOf(SAVE_AFTER) + 1);

  return (
    <main className="shell onboarding">
      <div
        className="steps"
        role="progressbar"
        aria-label="Profile setup progress"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={index + 1}
      >
        {STEPS.map((s, i) => (
          <span key={s} className={i <= index ? "step on" : "step"} />
        ))}
      </div>
      <p className="muted small center">
        Step {index + 1} of {STEPS.length}
        {skippable ? " · optional" : ""}
      </p>

      <form
        className="panel form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        <h2 className="display-sm">{title}</h2>
        <p className="muted">{subtitle}</p>

        {step === "basics" && (
          <>
            <SectionFields section="about" {...fields} part="basics" />
            <label className="field">
              <span>Date of birth</span>
              <input
                type="date"
                required
                max={latestAdultBirthDate()}
                aria-invalid={!!dobError}
                value={birthDate}
                onChange={(e) => {
                  const value = e.target.value;
                  setBirthDate(value);
                  const years = ageOn(value);
                  if (years !== null && years >= 18)
                    setState((st) => ({ ...st, core: { ...st.core, age: String(years) } }));
                }}
              />
              <small className="muted">
                Private: never shown to other members. Your profile shows your age.
              </small>
            </label>
            <label className="field check">
              <span>
                <input type="checkbox" checked={adultOk} onChange={(e) => setAdultOk(e.target.checked)} /> I
                confirm that I am 18 or older and that this date of birth is correct.
              </span>
            </label>
            {dobError && <small className="err">{dobError}</small>}
          </>
        )}

        {step === "identity" && (
          <>
            <ChoiceChips
              label="Gender"
              options={GENDER_LABELS}
              value={state.details.gender}
              onChange={(v) => setDetail("gender", v)}
            />
            <HeightField value={state.details.height_cm} onChange={(v) => setDetail("height_cm", v)} />
          </>
        )}

        {step === "goals" && <SectionFields section="preferences" {...fields} />}

        {step === "work" && (
          <>
            <label className="field">
              <span>
                Work <small className="muted">· optional</small>
              </span>
              <input
                maxLength={60}
                placeholder="Job title or field"
                value={state.details.job ?? ""}
                onChange={(e) => setDetail("job", e.target.value || null)}
              />
            </label>
            <ChoiceChips
              label="Education"
              options={EDUCATION_LABELS}
              value={state.details.education}
              onChange={(v) => setDetail("education", v)}
            />
          </>
        )}

        {step === "lifestyle" && (
          <>
            <ChoiceChips
              label="Exercise"
              options={EXERCISE_LABELS}
              value={state.details.exercise}
              onChange={(v) => setDetail("exercise", v)}
            />
            <ChoiceChips
              label="Smoking"
              options={SMOKING_LABELS}
              value={state.details.smoking}
              onChange={(v) => setDetail("smoking", v)}
            />
            <ChoiceChips
              label="Children"
              options={CHILDREN_LABELS}
              value={state.details.children}
              onChange={(v) => setDetail("children", v)}
            />
          </>
        )}

        {step === "interests" && <SectionFields section="interests" {...fields} />}

        {step === "about" && (
          <>
            <SectionFields section="about" {...fields} part="bio" />
            <h3 className="section-label">Profile prompts</h3>
            <SectionFields section="prompts" {...fields} />
          </>
        )}

        {step === "places" && <SectionFields section="places" {...fields} />}

        {step === "photos" && saved && <PhotoManager profile={saved} onChange={patchSaved} />}
        {step === "privacy" && saved && <PrivacySettings profile={saved} onChange={patchSaved} />}
        {step === "notifications" && saved && <NotificationSettings profile={saved} onChange={patchSaved} />}
        {step === "preview" && saved && (
          <ProfileCardPreview person={personFromOwnRow(saved)}>
            <PersonDetails person={personFromOwnRow(saved)} />
          </ProfileCardPreview>
        )}

        {notice && (
          <p className="alert info" role="status">
            {notice}
          </p>
        )}
        {saveError && (
          <p className="alert error" role="alert">
            {saveError}
          </p>
        )}

        <div className="row step-actions">
          {canGoBack && (
            <button type="button" className="btn" onClick={back}>
              Back
            </button>
          )}
          <button className="btn dark grow" disabled={busy}>
            {busy
              ? "Saving…"
              : step === SAVE_AFTER && !saved
                ? "Save and continue"
                : step === "preview"
                  ? "Start meeting people"
                  : skippable && isEmptyStep(step, state, saved)
                    ? "Skip for now"
                    : "Continue"}
          </button>
        </div>
      </form>

      <button className="btn link block" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  );
}

/** Whether an optional step has nothing filled in (so the button says "Skip for now"). */
function isEmptyStep(step: Step, s: EditorState, saved: ProfileRow | null): boolean {
  const d = s.details;
  switch (step) {
    case "identity":
      return !d.gender && d.height_cm === null;
    case "work":
      return !d.job && !d.education;
    case "lifestyle":
      return !d.exercise && !d.smoking && !d.children;
    case "interests":
      return s.core.interests.trim() === "";
    case "about":
      return !s.core.bio.trim() && d.prompts.length === 0;
    case "places":
      return !d.city && d.neighbourhoods.length === 0 && d.favourite_places.length === 0;
    case "photos":
      return !saved?.photo_path;
    case "privacy":
      return saved?.lat == null;
    default:
      return false;
  }
}
