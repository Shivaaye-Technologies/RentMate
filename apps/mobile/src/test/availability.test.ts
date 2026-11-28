import { describe, expect, it } from "vitest";
import {
  END_CHOICES,
  minuteLabel,
  slotProblem,
  sortSlots,
  START_CHOICES,
  type Slot,
} from "../lib/availability";

const slot = (weekday: number, s: number, e: number, id = `${weekday}-${s}`): Slot => ({
  id,
  weekday,
  start_minute: s,
  end_minute: e,
  timezone: "Asia/Kolkata",
});

describe("availability helpers", () => {
  it("labels minutes as 24-hour times", () => {
    expect(minuteLabel(0)).toBe("00:00");
    expect(minuteLabel(570)).toBe("09:30");
    expect(minuteLabel(1440)).toBe("24:00");
  });

  it("offers choices inside the database limits", () => {
    expect(Math.min(...START_CHOICES)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...START_CHOICES)).toBeLessThanOrEqual(1439);
    expect(Math.max(...END_CHOICES)).toBe(1440);
  });

  it("refuses inverted, short and overlapping windows", () => {
    const existing = [slot(1, 600, 780)];
    expect(slotProblem(existing, 1, 700, 650)).toMatch(/after the start/);
    expect(slotProblem(existing, 1, 900, 930)).toMatch(/at least one hour/);
    expect(slotProblem(existing, 1, 720, 840)).toMatch(/overlaps/);
    expect(slotProblem(existing, 1, 780, 900)).toBeNull(); // touching is fine
    expect(slotProblem(existing, 2, 600, 780)).toBeNull(); // other day
    expect(slotProblem(existing, 7, 600, 780)).toMatch(/Choose a day/);
  });

  it("sorts by day then time", () => {
    expect(sortSlots([slot(3, 600, 700), slot(1, 900, 1000), slot(1, 600, 700)]).map((s) => s.id)).toEqual([
      "1-600",
      "1-900",
      "3-600",
    ]);
  });
});
