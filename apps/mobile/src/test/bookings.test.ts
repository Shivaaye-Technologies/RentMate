import { describe, expect, it } from "vitest";
import {
  allowedActions,
  bookingErrorMessage,
  checkInStep,
  durationOptions,
  LEDGER_LABEL,
  newRequestKey,
  normaliseCheckInCode,
  roleIn,
  startOptions,
  type Booking,
} from "../lib/bookings";

const now = new Date("2026-12-01T10:00:00Z");
const base: Booking = {
  id: "b1",
  reference: "RM-1",
  member_id: "m",
  companion_id: "c",
  service_title: "Coffee",
  starts_at: "2026-12-02T10:00:00Z",
  ends_at: "2026-12-02T11:00:00Z",
  meeting_point: "Cafe",
  status: "requested",
};

describe("booking actions", () => {
  it("only participants get actions", () => {
    expect(roleIn(base, "x")).toBeNull();
    expect(allowedActions(base, "x", now)).toEqual([]);
  });

  it("companions answer open requests; both can cancel", () => {
    expect(allowedActions(base, "c", now)).toEqual(["accept", "reject", "cancel"]);
    expect(allowedActions(base, "m", now)).toEqual(["cancel"]);
  });

  it("accepted bookings can be cancelled before the start, disputed after it and completed after the end", () => {
    const accepted = { ...base, status: "accepted" as const };
    expect(allowedActions(accepted, "m", now)).toEqual(["cancel"]);
    expect(allowedActions(accepted, "m", new Date("2026-12-02T10:30:00Z"))).toEqual(["dispute"]);
    expect(allowedActions(accepted, "c", new Date("2026-12-02T12:00:00Z"))).toEqual(["complete", "dispute"]);
  });

  it("finished bookings offer nothing", () => {
    for (const status of ["rejected", "cancelled", "completed", "disputed", "expired"] as const) {
      expect(allowedActions({ ...base, status }, "m", now)).toEqual([]);
    }
  });
});

describe("booking request keys", () => {
  it("are long enough for the server (8 to 80 characters) and differ between attempts", () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(80);
    expect(a).not.toBe(b);
  });

  it("are deterministic for the same inputs (a retry reuses the stored key, never a new one)", () => {
    expect(
      newRequestKey(
        () => 0.5,
        () => 1,
      ),
    ).toBe(
      newRequestKey(
        () => 0.5,
        () => 1,
      ),
    );
  });
});

describe("booking form choices", () => {
  it("offers 30-minute steps inside the service limits", () => {
    expect(durationOptions(60, 180)).toEqual([60, 90, 120, 150, 180]);
    expect(durationOptions(45, 50)).toEqual([45]);
  });

  it("offers start times from tomorrow on the hour", () => {
    const opts = startOptions(new Date(2026, 11, 1, 15, 30), 2, 9, 10);
    expect(opts).toHaveLength(4);
    expect(opts[0].getDate()).toBe(2);
    expect(opts[0].getHours()).toBe(9);
    expect(opts[0].getMinutes()).toBe(0);
  });
});

describe("wording", () => {
  it("never describes tokens as money", () => {
    for (const label of Object.values(LEDGER_LABEL)) expect(label).not.toMatch(/₹|INR|cash|rupee|payout/i);
  });

  it("shows server messages but hides internal errors", () => {
    expect(bookingErrorMessage({ message: "Not enough tokens." })).toBe("Not enough tokens.");
    expect(bookingErrorMessage({ message: 'relation "x" does not exist' })).toMatch(/Something went wrong/);
    expect(bookingErrorMessage({ message: "Failed to fetch" })).toMatch(/not confirmed/);
  });
});

describe("meetup check-in", () => {
  const accepted: Booking = { ...base, status: "accepted" };
  const at = (iso: string) => new Date(iso);

  it("opens 30 minutes before the start and closes at the end", () => {
    expect(checkInStep(accepted, "m", at("2026-12-02T09:29:00Z"))).toBe("not_yet");
    expect(checkInStep(accepted, "m", at("2026-12-02T09:30:00Z"))).toBe("show_code");
    expect(checkInStep(accepted, "c", at("2026-12-02T10:45:00Z"))).toBe("enter_code");
    expect(checkInStep(accepted, "c", at("2026-12-02T11:00:01Z"))).toBeNull();
  });

  it("only the member shows a code and only the companion enters one; outsiders see nothing", () => {
    const t = at("2026-12-02T10:00:00Z");
    expect(checkInStep(accepted, "m", t)).toBe("show_code");
    expect(checkInStep(accepted, "c", t)).toBe("enter_code");
    expect(checkInStep(accepted, "x", t)).toBeNull();
  });

  it("shows checked in once recorded, and nothing for bookings that were never accepted", () => {
    const t = at("2026-12-02T10:00:00Z");
    expect(checkInStep({ ...accepted, checked_in_at: "2026-12-02T10:01:00Z" }, "c", t)).toBe("checked_in");
    expect(checkInStep({ ...base, status: "completed", checked_in_at: "2026-12-02T10:01:00Z" }, "m", t)).toBe(
      "checked_in",
    );
    expect(checkInStep({ ...base, status: "requested" }, "m", t)).toBeNull();
    expect(checkInStep({ ...base, status: "cancelled" }, "c", t)).toBeNull();
  });

  it("accepts six digits with spaces or dashes and rejects anything else", () => {
    expect(normaliseCheckInCode("123 456")).toBe("123456");
    expect(normaliseCheckInCode("123-456")).toBe("123456");
    expect(normaliseCheckInCode("12345")).toBeNull();
    expect(normaliseCheckInCode("12345a")).toBeNull();
    expect(normaliseCheckInCode("1234567")).toBeNull();
  });
});
