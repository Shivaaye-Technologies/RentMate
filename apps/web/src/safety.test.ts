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
