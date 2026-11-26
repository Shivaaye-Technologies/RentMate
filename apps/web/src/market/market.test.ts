import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookingCard } from "./BookingsList";
import { BookingForm, CompanionCards } from "./Marketplace";
import type { Booking, Service, Settings } from "./marketData";
import {
  bookingActions,
  bookingProblem,
  formatINR,
  formatIndianNumber,
  looksLikeAddress,
  marketError,
  priceEstimate,
  validateCompanion,
  validateService,
} from "./marketText";

const noop = async () => undefined;
const HOUR = 3600_000;

describe("pricing (mirrors the server)", () => {
  it("hourly price × duration, rounded up; session is fixed", () => {
    expect(priceEstimate("hourly", 800, 120)).toBe(1600);
    expect(priceEstimate("hourly", 800, 90)).toBe(1200);
    expect(priceEstimate("hourly", 999, 45)).toBe(750);
    expect(priceEstimate("session", 1500, 120)).toBe(1500);
  });
  it("formats rupees the Indian way", () => {
    expect(formatINR(1600)).toBe("₹1,600");
    expect(formatINR(150000)).toBe("₹1,50,000");
    expect(formatINR(null)).toBe("—");
  });

  it("groups digits the Indian way without relying on the runtime's locale data", () => {
    expect(formatIndianNumber(0)).toBe("0");
    expect(formatIndianNumber(999)).toBe("999");
    expect(formatIndianNumber(1000)).toBe("1,000");
    expect(formatIndianNumber(12345678)).toBe("1,23,45,678");
    expect(formatIndianNumber(-150000)).toBe("-1,50,000");
    expect(formatIndianNumber(1499.6)).toBe("1,500");
    expect(formatIndianNumber(Number.NaN)).toBe("—");
  });
});

describe("privacy: no home addresses", () => {
  it("matches the database's address rule", () => {
    for (const bad of [
      "Flat 12, Green Towers",
      "Baner 411045",
      "House no 4",
      "Apartment 3B",
      "#12 MG Road",
      "Plot 9",
    ]) {
      expect(looksLikeAddress(bad)).toBe(true);
    }
    for (const fine of ["Baner", "Cafe Goodluck, FC Road", "Koregaon Park", "Phoenix Mall food court"]) {
      expect(looksLikeAddress(fine)).toBe(false);
    }
  });
});

describe("forms check what the database checks", () => {
  it("companion profile", () => {
    expect(
      validateCompanion({
        headline: "Hi",
        about: "",
        city: "",
        area: "Flat 2",
        languages: "",
        interests: "",
      }),
    ).toEqual({
      headline: "Use 5 to 80 characters.",
      city: "Enter your city.",
      area: "Name a neighbourhood only — never a home address or PIN code.",
    });
    expect(
      validateCompanion({
        headline: "City walks and coffee",
        about: "",
        city: "Pune",
        area: "Baner",
        languages: "English, Hindi",
        interests: "Museums",
      }),
    ).toEqual({});
  });
  it("service", () => {
    const ok = {
      category: "coffee",
      title: "Coffee chat",
      description: "",
      pricing: "hourly" as const,
      price: "800",
      minMinutes: "60",
      maxMinutes: "120",
    };
    expect(validateService(ok)).toEqual({});
    expect(validateService({ ...ok, price: "50" }).price).toMatch(/₹100/);
    expect(validateService({ ...ok, minMinutes: "120", maxMinutes: "60" }).maxMinutes).toBeTruthy();
    expect(validateService({ ...ok, category: "" }).category).toBeTruthy();
  });
  it("booking request", () => {
    const now = Date.parse("2026-12-01T10:00:00Z");
    const limits = { minMinutes: 60, maxMinutes: 180, minNoticeHours: 2 };
    const soon = new Date(now + HOUR).toISOString();
    const later = new Date(now + 48 * HOUR).toISOString();
    expect(bookingProblem("", 60, "Cafe", limits, now)).toMatch(/Choose a date/);
    expect(bookingProblem(soon, 60, "Cafe", limits, now)).toMatch(/2 hours notice/);
    expect(bookingProblem(later, 30, "Cafe", limits, now)).toMatch(/between/);
    expect(bookingProblem(later, 60, "Flat 4, Rose Apartments", limits, now)).toMatch(/public places/);
    expect(bookingProblem(later, 60, "Cafe Goodluck, FC Road", limits, now)).toBeNull();
  });
});

describe("who can do what with a booking", () => {
  const now = Date.parse("2026-12-01T10:00:00Z");
  const future = {
    starts_at: new Date(now + 24 * HOUR).toISOString(),
    ends_at: new Date(now + 26 * HOUR).toISOString(),
  };
  const past = {
    starts_at: new Date(now - 3 * HOUR).toISOString(),
    ends_at: new Date(now - HOUR).toISOString(),
  };
  const ids = { member_id: "m", companion_id: "c" };
  it("only the companion answers requests", () => {
    expect(bookingActions({ ...future, ...ids, status: "requested" }, "c", now).respond).toBe(true);
    expect(bookingActions({ ...future, ...ids, status: "requested" }, "m", now).respond).toBe(false);
  });
  it("cancel before start; complete after end; dispute after start", () => {
    expect(bookingActions({ ...future, ...ids, status: "accepted" }, "m", now)).toMatchObject({
      cancel: true,
      complete: false,
      dispute: false,
    });
    expect(bookingActions({ ...past, ...ids, status: "accepted" }, "m", now)).toMatchObject({
      cancel: false,
      complete: true,
      dispute: true,
    });
    expect(bookingActions({ ...past, ...ids, status: "completed" }, "m", now).complete).toBe(false);
  });
});

describe("database refusals in plain words", () => {
  it("explains policy, address and permission refusals", () => {
    expect(
      marketError({ code: "23514", message: "RentMate does not allow sexual or adult content…" }),
    ).toMatch(/does not allow/);
    expect(
      marketError({ code: "23514", message: 'violates check constraint "meeting_point_public"' }),
    ).toMatch(/home address/);
    expect(marketError({ code: "42501", message: "new row violates row-level security policy" })).toBe(
      "You can't do that.",
    );
    expect(
      marketError({ code: "P0001", message: "That time is already booked. Please choose another time." }),
    ).toBe("That time is already booked. Please choose another time.");
  });
});

const service: Service = {
  id: "s1",
  companion_id: "c",
  category: "coffee",
  title: "Coffee and conversation",
  description: "",
  pricing: "hourly",
  price_inr: 800,
  min_minutes: 60,
  max_minutes: 180,
  active: true,
};
const settings: Settings = {
  commission_pct: 15,
  payments_enabled: false,
  min_notice_hours: 2,
  max_advance_days: 60,
  free_cancel_hours: 24,
};

describe("screens", () => {
  it("booking form shows the estimate, the rules and needs agreement", () => {
    const html = renderToStaticMarkup(
      createElement(BookingForm, { service, settings, onCancel: () => {}, onBooked: () => {} }),
    );
    expect(html).toContain("₹800");
    expect(html).toContain("Payment is not taken in the app");
    expect(html).toContain("non-sexual social companionship in a public place");
    expect(html).toContain("Free cancellation until 24 hours");
    expect(html).toMatch(/disabled=""[^>]*>Send booking request/);
  });

  it("companion cards show area only, never addresses or contact details", () => {
    const html = renderToStaticMarkup(
      createElement(CompanionCards, {
        list: [
          {
            user_id: "c",
            display_name: "Asha",
            photo_path: null,
            headline: "City walks",
            city: "Pune",
            area: "Baner",
            languages: ["English"],
            interests: [],
            verified: true,
            min_price_inr: 800,
            categories: ["coffee"],
            rating: 4.8,
            review_count: 12,
          },
        ],
        labels: { coffee: "Coffee meetup" },
        onOpen: () => {},
      }),
    );
    expect(html).toContain("Pune · Baner");
    expect(html).toContain("From ₹800");
    expect(html).toContain("★ 4.8 (12)");
    expect(html).toContain("Verified");
    expect(html).not.toMatch(/@|phone|address/i);
  });

  const booking: Booking = {
    id: "b1",
    reference: "RM-ABC12345",
    member_id: "m",
    companion_id: "c",
    service_title: "Coffee and conversation",
    category: "coffee",
    pricing: "hourly",
    starts_at: new Date(Date.now() + 48 * HOUR).toISOString(),
    ends_at: new Date(Date.now() + 50 * HOUR).toISOString(),
    duration_minutes: 120,
    timezone: "Asia/Kolkata",
    price_inr: 1600,
    commission_pct: 15,
    meeting_point: "Cafe Goodluck",
    note: "",
    status: "requested",
    cancellation_policy: "Free cancellation until 24 hours before the start.",
    late_cancellation: false,
    payment_status: "not_collected",
    created_at: new Date().toISOString(),
  };

  it("companion sees Accept/Decline; member does not", () => {
    const asCompanion = renderToStaticMarkup(
      createElement(BookingCard, {
        b: booking,
        me: "c",
        names: { m: "Ravi" },
        reviewed: false,
        reload: noop,
      }),
    );
    expect(asCompanion).toContain(">Accept<");
    expect(asCompanion).toContain(">Decline<");
    expect(asCompanion).toContain("Member: Ravi");
    const asMember = renderToStaticMarkup(
      createElement(BookingCard, {
        b: booking,
        me: "m",
        names: { c: "Asha" },
        reviewed: false,
        reload: noop,
      }),
    );
    expect(asMember).not.toContain(">Accept<");
    expect(asMember).toContain(">Cancel booking<");
    expect(asMember).toContain("payment not collected in the app");
  });

  it("only the booking member is offered a review, once", () => {
    const done = {
      ...booking,
      status: "completed",
      starts_at: booking.created_at,
      ends_at: booking.created_at,
    };
    const member = renderToStaticMarkup(
      createElement(BookingCard, { b: done, me: "m", names: {}, reviewed: false, reload: noop }),
    );
    expect(member).toContain(">Write a review<");
    const again = renderToStaticMarkup(
      createElement(BookingCard, { b: done, me: "m", names: {}, reviewed: true, reload: noop }),
    );
    expect(again).not.toContain(">Write a review<");
    const companion = renderToStaticMarkup(
      createElement(BookingCard, { b: done, me: "c", names: {}, reviewed: false, reload: noop }),
    );
    expect(companion).not.toContain(">Write a review<");
  });
});
