import { useState } from "react";
import {
  BIO_PROMPTS,
  draftFromRow,
  LOOKING_FOR_LABELS,
  STEP_FIELDS,
  stepErrors,
  validateProfile,
  type DraftErrors,
  type LookingFor,
  type ProfileDraft,
  type ProfileRow,
} from "../profile";
import { supabase } from "../supabase";
import { InterestPicker } from "./InterestPicker";
import { ProfileExtras } from "./ProfileExtras";

const STEPS = ["basics", "goals", "interests", "about", "photo"] as const;
type Step = (typeof STEPS)[number];

const TITLES: Record<Step, { title: string; subtitle: string }> = {
  basics: { title: "Let's start with you", subtitle: "Your first name and age appear on your profile." },
  goals: {
    title: "What are you looking for?",
    subtitle: "We only show you people whose ages fit both ways.",
  },
  interests: { title: "What do you love?", subtitle: "Shared interests decide who you see first." },
  about: {
    title: "Say a little about yourself",
    subtitle: "A couple of sentences gives people something to reply to.",
  },
  photo: {
    title: "Add a photo and distance",
    subtitle: "Both are optional, and you can change them any time.",
  },
};

/**
 * Step-by-step profile setup for new members. Uses the same validation as the
 * profile form (18+ included) and saves once, before the optional photo step.
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
  const [step, setStep] = useState<Step>("basics");
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromRow(null));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ProfileRow | null>(null);
  const index = STEPS.indexOf(step);

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function next() {
    setSaveError(null);
    if (step !== "photo") {
      const errs = stepErrors(draft, STEP_FIELDS[step]);
      setErrors(errs);
      if (Object.keys(errs).length > 0) return;
    }
    if (step === "about") {
      const result = validateProfile(draft);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      setBusy(true);
      const row = { id: userId, ...result.row };
      const { error } = await supabase.from("profiles").upsert(row);
      setBusy(false);
      if (error) {
        setSaveError(`Could not save your profile: ${error.message}`);
        return;
      }
      setSaved({ ...row, photo_path: null, lat: null, lng: null, verified: false });
    }
    if (step === "photo" && saved) {
      onDone(saved);
      return;
    }
    setStep(STEPS[index + 1]);
  }

  const back = () => {
    setErrors({});
    setStep(STEPS[Math.max(0, index - 1)]);
  };

  const { title, subtitle } = TITLES[step];

  return (
    <main className="shell onboarding">
      <div className="steps" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
        {STEPS.map((s, i) => (
          <span key={s} className={i <= index ? "step on" : "step"} />
        ))}
      </div>
      <p className="muted small center">
        Step {index + 1} of {STEPS.length}
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
            <label className="field">
              <span>First name</span>
              <input
                value={draft.displayName}
                maxLength={40}
                autoComplete="given-name"
                autoFocus
                onChange={(e) => set("displayName", e.target.value)}
              />
              {errors.displayName && <small className="err">{errors.displayName}</small>}
            </label>
            <label className="field">
              <span>Age</span>
              <input inputMode="numeric" value={draft.age} onChange={(e) => set("age", e.target.value)} />
              {errors.age && <small className="err">{errors.age}</small>}
            </label>
            <p className="fine">You must be 18 or older to use SOULMATE.AI.</p>
          </>
        )}

        {step === "goals" && (
          <>
            <div className="choice-list" role="radiogroup" aria-label="I'm here for">
              {(Object.entries(LOOKING_FOR_LABELS) as [LookingFor, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draft.lookingFor === value}
                  className={draft.lookingFor === value ? "choice on" : "choice"}
                  onClick={() => set("lookingFor", value)}
                >
                  {label}
                </button>
              ))}
            </div>
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
          </>
        )}

        {step === "interests" && (
          <InterestPicker
            value={draft.interests}
            onChange={(v) => set("interests", v)}
            error={errors.interests}
          />
        )}

        {step === "about" && (
          <>
            <div className="chips" aria-label="Ideas to start with">
              {BIO_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chip toggle"
                  onClick={() => set("bio", draft.bio.trim() ? `${draft.bio.trim()} ${p}` : p)}
                >
                  {p.trim()}…
                </button>
              ))}
            </div>
            <label className="field">
              <span>About you</span>
              <textarea
                rows={4}
                maxLength={500}
                placeholder="What makes a great weekend for you?"
                value={draft.bio}
                onChange={(e) => set("bio", e.target.value)}
              />
              <small className="muted">{draft.bio.length}/500</small>
              {errors.bio && <small className="err">{errors.bio}</small>}
            </label>
          </>
        )}

        {step === "photo" && saved && (
          <ProfileExtras profile={saved} onChange={(patch) => setSaved({ ...saved, ...patch })} />
        )}

        {saveError && (
          <p className="alert error" role="alert">
            {saveError}
          </p>
        )}

        <div className="row step-actions">
          {index > 0 && step !== "photo" && (
            <button type="button" className="btn" onClick={back}>
              Back
            </button>
          )}
          <button className="btn dark grow" disabled={busy}>
            {busy
              ? "Saving…"
              : step === "about"
                ? "Save and continue"
                : step === "photo"
                  ? "Start meeting people"
                  : step === "interests" && draft.interests.trim() === ""
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
