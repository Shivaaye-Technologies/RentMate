import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { INTEREST_CATEGORIES, STANDARD_INTERESTS } from "../interests";
import { InterestPicker } from "./InterestPicker";
import { Onboarding, STEPS } from "./Onboarding";
import { StrengthNudge } from "./ProfileStrength";
import { SAFETY_PAGES, SafetyIntro } from "./SafetyIntro";
import { PromptEditor, PlacesPicker, RangeSlider } from "./Editors";
import { sectionPatch, editorStateFrom } from "./ProfileEditor";
import { MapView } from "./MapView";
import { WelcomeCard } from "./ChatsList";

const noop = () => undefined;

describe("onboarding screens", () => {
  it("starts with name and age, the 18+ rule and a progress bar", () => {
    const html = renderToStaticMarkup(
      createElement(Onboarding, { userId: "u", onDone: noop, onSignOut: noop }),
    );
    expect(html).toContain(`Step 1 of ${STEPS.length}`);
    expect(html).toContain("First name");
    expect(html).toContain("Age");
    expect(html).toContain("18 or older");
    expect(html).toMatch(/role="progressbar"/);
    expect(html).not.toMatch(/Fictional|Demo Mode/);
  });

  it("covers the full profile journey in order", () => {
    expect(STEPS).toEqual([
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
    ]);
  });

  it("groups every standard interest by category and marks picked ones", () => {
    const html = renderToStaticMarkup(
      createElement(InterestPicker, { value: "hike, Chess", onChange: noop }),
    );
    for (const c of INTEREST_CATEGORIES) expect(html).toContain(c.name);
    for (const i of STANDARD_INTERESTS) expect(html).toContain(`>${i}<`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Hiking</);
    expect(html).toContain("Chess ×");
    expect(html).toContain("2 of 10 picked");
  });
});

describe("profile editors", () => {
  it("renders prompts, places and an accessible two-thumb slider", () => {
    const prompts = renderToStaticMarkup(
      createElement(PromptEditor, { value: [{ q: "My ideal Sunday", a: "<b>trek</b>" }], onChange: noop }),
    );
    expect(prompts).toContain("1 of 3 prompts");
    expect(prompts).not.toContain("<b>trek</b>");
    const places = renderToStaticMarkup(
      createElement(PlacesPicker, { value: ["Specialty coffee"], onChange: noop }),
    );
    expect(places).toContain("1 of 10 picked");
    expect(places).toContain("Cafés");
    const slider = renderToStaticMarkup(
      createElement(RangeSlider, { label: "Ages", min: 18, max: 100, low: 24, high: 34, onChange: noop }),
    );
    expect(slider).toContain('aria-label="Ages: minimum"');
    expect(slider).toContain('aria-label="Ages: maximum"');
  });

  it("saves only the edited section's columns", () => {
    const state = editorStateFrom({
      id: "u",
      display_name: "Asha",
      age: 27,
      bio: "",
      interests: [],
      looking_for: "relationship",
      age_min: 24,
      age_max: 34,
    });
    state.details.city = " Pune ";
    const r = sectionPatch("places", state);
    expect(r).toEqual({ ok: true, patch: { city: "Pune", neighbourhoods: [], favourite_places: [] } });
    const about = sectionPatch("about", { ...state, core: { ...state.core, age: "17" } });
    expect(about.ok).toBe(false);
  });
});

describe("profile completion nudge", () => {
  it("shows the real completion percentage", () => {
    const base = {
      id: "u",
      display_name: "A",
      age: 30,
      bio: "",
      interests: [],
      looking_for: "casual" as const,
      age_min: 25,
      age_max: 35,
      photo_path: "u/a.jpg",
    };
    expect(renderToStaticMarkup(createElement(StrengthNudge, { profile: base, onOpen: noop }))).toContain(
      "Profile 8% complete",
    );
  });
});

describe("safety, map and welcome", () => {
  it("has five safety pages and separates them from legal terms", () => {
    expect(SAFETY_PAGES.map((p) => p.title)).toEqual([
      "Be yourself",
      "Respect others",
      "Consent",
      "Protect your privacy",
      "Meet safely",
    ]);
    const html = renderToStaticMarkup(createElement(SafetyIntro, { onFinish: noop, onClose: noop }));
    expect(html).toContain("Page 1 of 5");
  });

  it("never invents crossed paths on the map", () => {
    const html = renderToStaticMarkup(
      createElement(MapView, {
        me: {
          id: "u",
          display_name: "A",
          age: 30,
          bio: "",
          interests: [],
          looking_for: "casual",
          age_min: 25,
          age_max: 35,
        },
        people: [],
        onBack: noop,
        onOpenPrivacy: noop,
        onShowCity: noop,
      }),
    );
    expect(html).toContain("Crossed paths isn&#x27;t available yet");
    expect(html).toContain("Add your city");
  });

  it("marks the welcome as an official message, not a member", () => {
    const html = renderToStaticMarkup(createElement(WelcomeCard, { onDismiss: noop }));
    expect(html).toContain("Official message");
    expect(html).toContain("not a member profile");
  });
});
