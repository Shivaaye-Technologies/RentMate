import { describe, expect, it } from "vitest";
import { friendlyError, isDeleteConfirmed, REPORT_REASONS } from "./safety";

describe("account deletion confirmation", () => {
  it("requires the exact word, ignoring spaces and case", () => {
    expect(isDeleteConfirmed("DELETE")).toBe(true);
    expect(isDeleteConfirmed("  delete ")).toBe(true);
    expect(isDeleteConfirmed("DEL")).toBe(false);
    expect(isDeleteConfirmed("")).toBe(false);
    expect(isDeleteConfirmed("DELETE ME")).toBe(false);
  });
});

describe("report reasons", () => {
  it("match the database check constraint", () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual([
      "fake",
      "inappropriate",
      "harassment",
      "underage",
      "scam",
      "sexual_content",
      "sexual_solicitation",
      "other",
    ]);
  });
});

describe("friendlyError", () => {
  it("hides raw database wording", () => {
    expect(friendlyError('new row violates row-level security policy for table "likes"')).toBe(
      "That action isn't allowed.",
    );
    expect(friendlyError("duplicate key value violates unique constraint")).toBe("Already done.");
    expect(friendlyError("You are sending messages too fast.")).toBe("You are sending messages too fast.");
  });
});

describe("policy refusals", () => {
  const db =
    "RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.";
  it("explain blocked text in plain words", async () => {
    const { POLICY_TEXT_BLOCKED } = await import("./safety");
    expect(friendlyError(db)).toBe(POLICY_TEXT_BLOCKED);
    const { saveErrorMessage } = await import("./profileApi");
    expect(saveErrorMessage({ code: "23514", message: db })).toBe(POLICY_TEXT_BLOCKED);
  });
  it("offers members a way to report sexual content and solicitation", () => {
    const labels = REPORT_REASONS.map((r) => r.label).join(" | ");
    expect(labels).toMatch(/Sexual or adult content/);
    expect(labels).toMatch(/sexual services or escorting/); // policy-guard: allow (report reason / refusal test)
  });
});
