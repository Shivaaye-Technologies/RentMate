import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApplicationForm, Consent, CreatorStudio, Overview } from "./CreatorStudio";
import type { CreatorState } from "./creatorData";
import { latestVerification } from "./creatorData";
import {
  categoryAllowedFor,
  explainProblems,
  fromMinutes,
  scheduleProblem,
  toMinutes,
  validateCreator,
} from "./liveText";

const noop = async () => undefined;

const base: CreatorState = {
  creator: null,
  verifications: [],
  categories: [
    { key: "talk", label: "Talk and chat", explicit: false },
    { key: "adult", label: "Adult (18+ explicit)", explicit: true },
  ],
  agreement: { version: "2026.1", title: "Creator agreement", document_url: "https://example.com/a" },
  myStreams: [],
  invitedStreams: [],
  consents: [],
  availability: [],
  sessions: [],
  tickets: [],
  appeals: [],
};

describe("creator rules", () => {
  it("validates applications like the database", () => {
    expect(validateCreator({ stageName: "A", bio: "", countryCode: "", categories: [] })).toEqual({
      stageName: "Use 2 to 40 characters.",
      countryCode: "Choose your country.",
      categories: "Choose at least one category.",
    });
    expect(validateCreator({ stageName: "Riya", bio: "", countryCode: "IN", categories: ["talk"] })).toEqual(
      {},
    );
  });

  it("never offers adult categories to creators in India", () => {
    expect(categoryAllowedFor("IN", true)).toBe(false);
    expect(categoryAllowedFor("IN", false)).toBe(true);
    expect(categoryAllowedFor("US", true)).toBe(true);
    expect(categoryAllowedFor("", true)).toBe(false);
  });

  it("explains what's missing before going live", () => {
    expect(
      explainProblems([
        "identity_not_verified",
        "participant_consent_missing:a",
        "participant_consent_missing:b",
      ]),
    ).toEqual([
      "Complete identity verification.",
      "Every co-performer must record their own consent for this stream.",
    ]);
    expect(explainProblems(["something_new"])).toEqual(["This isn't allowed right now."]);
  });

  it("handles times and schedules", () => {
    expect(toMinutes("18:30")).toBe(1110);
    expect(toMinutes("24:00")).toBe(1440);
    expect(toMinutes("25:00")).toBeNull();
    expect(fromMinutes(1110)).toBe("18:30");
    expect(scheduleProblem("2020-01-01T10:00", Date.parse("2026-11-01T00:00:00Z"))).toMatch(/future/);
    expect(scheduleProblem("", 0)).toBeNull();
    expect(
      latestVerification([{ kind: "age", status: "passed", provider: "P", checked_at: "x" }], "identity"),
    ).toBe("none");
  });
});

describe("creator studio screens", () => {
  it("shows the application with adult categories disabled until a country allows them", () => {
    const html = renderToStaticMarkup(createElement(ApplicationForm, { me: "u", state: base, reload: noop }));
    expect(html).toContain("Apply to broadcast");
    expect(html).toContain("18 or older");
    expect(html).toContain("Adult categories are never available in India");
    expect(html).toMatch(/disabled=""[^>]*>Send application/);
    expect(html).toMatch(/aria-pressed="false" disabled=""[^>]*>Adult/);
  });

  it("lists every step to approval honestly", () => {
    const html = renderToStaticMarkup(
      createElement(Overview, {
        state: {
          ...base,
          creator: {
            user_id: "u",
            stage_name: "Riya Live",
            bio: "",
            country_code: "US",
            categories: ["talk"],
            status: "verifying",
            agreement_version: null,
            agreement_accepted_at: null,
            status_reason: null,
          },
          verifications: [{ kind: "identity", status: "passed", provider: "P", checked_at: "2026-11-01" }],
        },
        reload: noop,
      }),
    );
    expect(html).toContain("Verification in progress");
    expect(html).toContain("Identity verification");
    expect(html).toContain("Not started");
    expect(html).toContain("never photos of your documents");
    expect(html).toContain("I&#x27;ve read it and accept");
  });

  it("asks co-performers for their own consent", () => {
    const html = renderToStaticMarkup(
      createElement(Consent, {
        me: "co",
        state: {
          ...base,
          invitedStreams: [
            {
              id: "s1",
              creator_id: "cr",
              title: "Late show",
              category: "talk",
              scheduled_at: null,
              status: "scheduled",
              participants: ["co"],
              started_at: null,
            },
          ],
        },
        reload: noop,
      }),
    );
    expect(html).toContain("Nobody can give consent for you");
    expect(html).toContain("Record my consent");
  });

  it("starts with a loading state and an exit button", () => {
    const html = renderToStaticMarkup(createElement(CreatorStudio, { me: "u", onExit: () => undefined }));
    expect(html).toContain("Creator studio");
    expect(html).toContain("Back");
  });
});
