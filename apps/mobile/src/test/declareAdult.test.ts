import { describe, expect, it, vi } from "vitest";
import { CONFIRM_REQUIRED, declareAdult, isoDate } from "../lib/declareAdult";
import {
  ATTESTATION_FAILED,
  ATTESTATION_SIGN_IN,
  ATTESTATION_UNAVAILABLE,
  supabaseProfileDb,
  type ProfileDb,
} from "../lib/shared";

const today = new Date(2026, 10, 20);
const adult = "1995-06-15";

/** The shared data layer bound to a fake Supabase client: the same adapter the app uses. */
function dbWith(rpc: (fn: string, args?: object) => Promise<{ data: unknown; error: unknown }>) {
  const spy = vi.fn(rpc);
  const db: ProfileDb = supabaseProfileDb({
    rpc: spy as never,
    from: () => {
      throw new Error("no table access expected");
    },
  });
  return { db, rpc: spy };
}

describe("declareAdult (18+ declaration, fails closed)", () => {
  it("records the declaration through attest_adult and returns the age from the database", async () => {
    const { db, rpc } = dbWith(async () => ({ data: 31, error: null }));
    await expect(declareAdult(db, adult, true, today)).resolves.toEqual({ ok: true, age: 31 });
    expect(rpc).toHaveBeenCalledWith("attest_adult", { p_birth_date: adult, p_confirm: true });
  });

  it("requires the explicit 18+ confirmation before calling the database", async () => {
    const { db, rpc } = dbWith(async () => ({ data: 31, error: null }));
    await expect(declareAdult(db, adult, false, today)).resolves.toEqual({
      ok: false,
      message: CONFIRM_REQUIRED,
      field: "confirm",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an under-18 or invalid date before calling the database", async () => {
    const { db, rpc } = dbWith(async () => ({ data: 31, error: null }));
    for (const d of ["2010-01-01", "invalid", "2026-02-30"]) {
      expect(await declareAdult(db, d, true, today)).toMatchObject({ ok: false, field: "date" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["missing function (PGRST202)", { code: "PGRST202", message: "not found" }, ATTESTATION_UNAVAILABLE],
    ["permission", { code: "42501", message: "permission denied" }, ATTESTATION_SIGN_IN],
    ["sign-in", { code: "PGRST301", message: "JWT expired" }, ATTESTATION_SIGN_IN],
    ["unexpected", { code: "XX000", message: "internal detail" }, ATTESTATION_FAILED],
  ])("a %s error stops with a safe message", async (_l, error, message) => {
    const { db } = dbWith(async () => ({ data: null, error }));
    await expect(declareAdult(db, adult, true, today)).resolves.toEqual({ ok: false, message });
  });

  it("the database's own refusal (under 18) is shown as written", async () => {
    const error = { code: "P0001", message: "RentMate is only for people aged 18 or over." };
    const { db } = dbWith(async () => ({ data: null, error }));
    await expect(declareAdult(db, adult, true, today)).resolves.toEqual({
      ok: false,
      message: error.message,
    });
  });

  it("a thrown network error or a non-adult answer still fails closed", async () => {
    const { db: offline } = dbWith(async () => {
      throw new TypeError("Network request failed");
    });
    expect(await declareAdult(offline, adult, true, today)).toEqual({
      ok: false,
      message: ATTESTATION_FAILED,
    });
    for (const data of [null, "31", 17]) {
      const { db } = dbWith(async () => ({ data, error: null }));
      expect(await declareAdult(db, adult, true, today)).toEqual({ ok: false, message: ATTESTATION_FAILED });
    }
  });

  it("builds ISO dates from day/month/year fields", () => {
    expect(isoDate("5", "6", "1995")).toBe("1995-06-05");
    expect(isoDate("15", "06", "1995")).toBe("1995-06-15");
    expect(isoDate("", "6", "1995")).toBe("");
    expect(isoDate("5", "6", "95")).toBe("");
  });
});
