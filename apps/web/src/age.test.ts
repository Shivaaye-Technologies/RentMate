import { describe, expect, it } from "vitest";
import { ageOn, birthDateError, latestAdultBirthDate } from "./age";

const today = new Date(2026, 10, 20); // 20 Nov 2026, local time

describe("date of birth (18+ self-declaration)", () => {
  it("counts whole years, turning a year older on the birthday", () => {
    expect(ageOn("2008-11-20", today)).toBe(18);
    expect(ageOn("2008-11-21", today)).toBe(17);
    expect(ageOn("2000-01-01", today)).toBe(26);
  });

  it("accepts 18 today and refuses the day before an 18th birthday", () => {
    expect(birthDateError("2008-11-20", today)).toBeNull();
    expect(birthDateError("2008-11-21", today)).toMatch(/18 or over/);
  });

  it("refuses empty, malformed, impossible and future dates", () => {
    expect(birthDateError("", today)).toMatch(/Enter your date of birth/);
    for (const bad of ["2008-02-30", "20-11-2008", "2008/11/20", "not a date", "2027-01-01", "1900-01-01"])
      expect(birthDateError(bad, today), bad).toMatch(/valid date of birth|18 or over/);
    expect(birthDateError("2027-01-01", today)).toMatch(/valid/);
  });

  it("handles 29 February birthdays", () => {
    expect(ageOn("2008-02-29", new Date(2026, 1, 28))).toBe(17);
    expect(ageOn("2008-02-29", new Date(2026, 2, 1))).toBe(18);
  });

  it("gives the latest acceptable date for the date picker", () => {
    expect(latestAdultBirthDate(today)).toBe("2008-11-20");
  });
});
