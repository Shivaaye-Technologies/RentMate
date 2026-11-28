// The shared profile data layer, with an in-memory database port. The same code runs in the web app and the Android app.
import { describe, expect, it, vi } from "vitest";
import { ATTESTATION_FAILED, ATTESTATION_SIGN_IN, ATTESTATION_UNAVAILABLE } from "../attestation";
import {
  attestAdult,
  attestThenCreateProfile,
  DECLARATION_CHECK_FAILED,
  declarationStatus,
  saveProfileFields,
  supabaseProfileDb,
  type ProfileDb,
  type SupabaseLike,
} from "./profileData";

function fakeDb(over: Partial<{ [K in keyof ProfileDb]: ReturnType<typeof vi.fn> }> = {}) {
  const db = {
    attestAdult: vi.fn(async () => ({ data: 30, error: null })),
    myAgeAttestation: vi.fn(async () => ({ data: [], error: null })),
    upsertProfile: vi.fn(async () => ({ error: null })),
    updateProfile: vi.fn(async () => ({ error: null })),
    ...over,
  };
  return db as typeof db & ProfileDb;
}
const input = {
  userId: "u1",
  birthDate: "1995-06-15",
  adultConfirmed: true,
  coreRow: { display_name: "Asha" },
  detailsRow: { city: "Pune" },
};

describe("supabaseProfileDb (adapter)", () => {
  it("maps each operation to the existing RPC or table call", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const upsert = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const client: SupabaseLike = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn(() => ({ upsert, update })),
    };
    const db = supabaseProfileDb(client);
    await db.attestAdult({ p_birth_date: "1995-06-15", p_confirm: true });
    await db.myAgeAttestation();
    await db.upsertProfile({ id: "u1" });
    await db.updateProfile("u1", { bio: "hi" });
    expect(client.rpc).toHaveBeenNthCalledWith(1, "attest_adult", {
      p_birth_date: "1995-06-15",
      p_confirm: true,
    });
    expect(client.rpc).toHaveBeenNthCalledWith(2, "my_age_attestation");
    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(upsert).toHaveBeenCalledWith({ id: "u1" });
    expect(update).toHaveBeenCalledWith({ bio: "hi" });
    expect(eq).toHaveBeenCalledWith("id", "u1");
  });
});

describe("attestAdult (fails closed)", () => {
  it("returns the adult age from the database", async () => {
    await expect(attestAdult(fakeDb(), "1995-06-15", true)).resolves.toEqual({ ok: true, age: 30 });
  });
  it.each([
    [{ code: "PGRST202", message: "missing" }, ATTESTATION_UNAVAILABLE],
    [{ code: "42501", message: "permission denied" }, ATTESTATION_SIGN_IN],
    [{ code: "XX000", message: "internal" }, ATTESTATION_FAILED],
  ])("error %o stops with a safe message", async (error, message) => {
    const db = fakeDb({ attestAdult: vi.fn(async () => ({ data: null, error })) });
    await expect(attestAdult(db, "1995-06-15", true)).resolves.toEqual({ ok: false, message });
  });
  it("a thrown error or a non-adult answer fails closed", async () => {
    const thrown = fakeDb({
      attestAdult: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    expect(await attestAdult(thrown, "1995-06-15", true)).toEqual({ ok: false, message: ATTESTATION_FAILED });
    for (const data of [null, "30", 17]) {
      const db = fakeDb({ attestAdult: vi.fn(async () => ({ data, error: null })) });
      expect(await attestAdult(db, "1995-06-15", true)).toEqual({ ok: false, message: ATTESTATION_FAILED });
    }
  });
});

describe("declarationStatus", () => {
  it("declared when a record exists, missing when none", async () => {
    expect(
      await declarationStatus(
        fakeDb({
          myAgeAttestation: vi.fn(async () => ({ data: [{ method: "self_declared" }], error: null })),
        }),
      ),
    ).toBe("declared");
    expect(await declarationStatus(fakeDb())).toBe("missing");
  });
  it("a missing function sends the member to the declaration step (which fails closed)", async () => {
    const db = fakeDb({ myAgeAttestation: vi.fn(async () => ({ data: null, error: { code: "PGRST202" } })) });
    expect(await declarationStatus(db)).toBe("missing");
  });
  it("other errors and network failures ask to retry instead of letting the member in", async () => {
    const err = fakeDb({ myAgeAttestation: vi.fn(async () => ({ data: null, error: { code: "XX000" } })) });
    const thrown = fakeDb({
      myAgeAttestation: vi.fn(async () => {
        throw new TypeError("offline");
      }),
    });
    expect(await declarationStatus(err)).toEqual({ error: DECLARATION_CHECK_FAILED });
    expect(await declarationStatus(thrown)).toEqual({ error: DECLARATION_CHECK_FAILED });
  });
});

describe("attestThenCreateProfile", () => {
  it("creates the profile only after the declaration succeeds", async () => {
    const db = fakeDb();
    const onCreated = vi.fn();
    const r = await attestThenCreateProfile(db, input, onCreated);
    expect(r).toEqual({ ok: true, partial: false, row: { id: "u1", display_name: "Asha", city: "Pune" } });
    expect(db.attestAdult.mock.invocationCallOrder[0]).toBeLessThan(
      db.upsertProfile.mock.invocationCallOrder[0],
    );
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
  it("no profile and no completion after a failed declaration", async () => {
    const db = fakeDb({ attestAdult: vi.fn(async () => ({ data: null, error: { code: "PGRST202" } })) });
    const onCreated = vi.fn();
    expect(await attestThenCreateProfile(db, input, onCreated)).toMatchObject({
      ok: false,
      stage: "attestation",
    });
    expect(db.upsertProfile).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
  it("saves the essentials when detail columns are missing", async () => {
    const upsertProfile = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: "PGRST204", message: "Could not find the 'city' column" } })
      .mockResolvedValueOnce({ error: null });
    const r = await attestThenCreateProfile(fakeDb({ upsertProfile }), input, vi.fn());
    expect(r).toEqual({ ok: true, partial: true, row: { id: "u1", display_name: "Asha" } });
  });
  it("a profile error after the declaration does not complete onboarding", async () => {
    const db = fakeDb({ upsertProfile: vi.fn(async () => ({ error: { code: "23514", message: "check" } })) });
    const onCreated = vi.fn();
    expect(await attestThenCreateProfile(db, input, onCreated)).toMatchObject({
      ok: false,
      stage: "profile",
    });
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("saveProfileFields", () => {
  it("updates only the member's own row and turns errors into readable messages", async () => {
    const db = fakeDb();
    await saveProfileFields(db, "u1", { bio: "hello" });
    expect(db.updateProfile).toHaveBeenCalledWith("u1", { bio: "hello" });
    const denied = fakeDb({
      updateProfile: vi.fn(async () => ({
        error: { message: "new row violates row-level security policy" },
      })),
    });
    await expect(saveProfileFields(denied, "u2", { bio: "x" })).rejects.toThrow(
      "You can only change your own profile.",
    );
  });
});

describe("shared layer stays portable", () => {
  it("imports nothing app-specific (no Supabase singleton, browser, Vite or React)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./profileData.ts", import.meta.url), "utf8");
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["../age", "../attestation", "../safety"]);
    expect(src).not.toMatch(/import\.meta|window\.|document\.|localStorage/);
  });
});
