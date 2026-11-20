import { describe, expect, it, vi } from "vitest";
import { CONFIRM_REQUIRED, declareAdult, isoDate } from "../lib/declareAdult";
import { ATTESTATION_FAILED, ATTESTATION_SIGN_IN, ATTESTATION_UNAVAILABLE } from "../lib/shared";

const today = new Date(2026, 10, 20);
const adult = "1995-06-15";

describe("declareAdult (18+ declaration, fails closed)", () => {
  it("records the declaration and returns the age from the database", async () => {
    const attest = vi.fn(async () => ({ data: 31, error: null }));
    await expect(declareAdult(attest, adult, true, today)).resolves.toEqual({ ok: true, age: 31 });
    expect(attest).toHaveBeenCalledWith({ p_birth_date: adult, p_confirm: true });
  });

  it("requires the explicit 18+ confirmation before calling the database", async () => {
    const attest = vi.fn();
    await expect(declareAdult(attest, adult, false, today)).resolves.toEqual({
      ok: false,
      message: CONFIRM_REQUIRED,
      field: "confirm",
    });
    expect(attest).not.toHaveBeenCalled();
  });

  it("refuses an under-18 or invalid date before calling the database", async () => {
    const attest = vi.fn();
    for (const d of ["2010-01-01", "invalid", "2026-02-30"]) {
      const r = await declareAdult(attest, d, true, today);
      expect(r).toMatchObject({ ok: false, field: "date" });
    }
    expect(attest).not.toHaveBeenCalled();
  });

  it.each([
    ["missing function (PGRST202)", { code: "PGRST202", message: "not found" }, ATTESTATION_UNAVAILABLE],
    ["permission", { code: "42501", message: "permission denied" }, ATTESTATION_SIGN_IN],
    ["sign-in", { code: "PGRST301", message: "JWT expired" }, ATTESTATION_SIGN_IN],
    ["unexpected", { code: "XX000", message: "internal detail" }, ATTESTATION_FAILED],
  ])("a %s error stops with a safe message", async (_l, error, message) => {
    await expect(declareAdult(async () => ({ data: null, error }), adult, true, today)).resolves.toEqual({
      ok: false,
      message,
    });
  });

  it("the database's own refusal (under 18) is shown as written", async () => {
    const error = { code: "P0001", message: "RentMate is only for people aged 18 or over." };
    await expect(declareAdult(async () => ({ data: null, error }), adult, true, today)).resolves.toEqual({
      ok: false,
      message: error.message,
    });
  });

  it("a thrown network error or a non-adult answer still fails closed", async () => {
    const thrown = await declareAdult(
      async () => {
        throw new TypeError("Network request failed");
      },
      adult,
      true,
      today,
    );
    expect(thrown).toEqual({ ok: false, message: ATTESTATION_FAILED });
    for (const data of [null, "31", 17]) {
      expect(await declareAdult(async () => ({ data, error: null }), adult, true, today)).toEqual({
        ok: false,
        message: ATTESTATION_FAILED,
      });
    }
  });

  it("builds ISO dates from day/month/year fields", () => {
    expect(isoDate("5", "6", "1995")).toBe("1995-06-05");
    expect(isoDate("15", "06", "1995")).toBe("1995-06-15");
    expect(isoDate("", "6", "1995")).toBe("");
    expect(isoDate("5", "6", "95")).toBe("");
  });
});
