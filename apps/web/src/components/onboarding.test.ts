import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STANDARD_INTERESTS } from "../interests";
import { InterestPicker } from "./InterestPicker";
import { Onboarding } from "./Onboarding";
import { ProfileStrength } from "./ProfileStrength";

describe("onboarding screens", () => {
  it("starts with name and age, the 18+ rule and a 5-step progress bar", () => {
    const html = renderToStaticMarkup(
      createElement(Onboarding, { userId: "u", onDone: () => undefined, onSignOut: () => undefined }),
    );
    expect(html).toContain("Step 1 of 5");
    expect(html).toContain("First name");
    expect(html).toContain("Age");
    expect(html).toContain("18 or older");
    expect(html).not.toMatch(/Fictional|Demo Mode/);
  });

  it("shows every standard interest as a chip and marks picked ones", () => {
    const html = renderToStaticMarkup(
      createElement(InterestPicker, { value: "hike, Chess", onChange: () => undefined }),
    );
    for (const i of STANDARD_INTERESTS) expect(html).toContain(`>${i}<`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Hiking</);
    expect(html).toContain("Chess ×");
    expect(html).toContain("2 of 15 picked");
  });

  it("shows profile strength only while something is missing", () => {
    const base = {
      id: "u",
      display_name: "A",
      age: 30,
      bio: "",
      interests: [],
      looking_for: "casual" as const,
      age_min: 25,
      age_max: 35,
    };
    expect(renderToStaticMarkup(createElement(ProfileStrength, { profile: base }))).toContain("1/5");
    const full = {
      ...base,
      bio: "I love long walks, chai at sunrise and finding new street food.",
      interests: ["Hiking", "Travel", "Books"],
      photo_path: "u/a.jpg",
      lat: 28.6,
      lng: 77.2,
    };
    expect(renderToStaticMarkup(createElement(ProfileStrength, { profile: full }))).toBe("");
  });
});
