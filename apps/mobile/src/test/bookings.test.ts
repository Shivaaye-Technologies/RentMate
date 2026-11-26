import { describe, expect, it } from "vitest";
import {
  allowedActions,
  bookingErrorMessage,
  durationOptions,
  LEDGER_LABEL,
  newRequestKey,
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
