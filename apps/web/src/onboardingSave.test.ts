// Onboarding's save sequence (attestThenCreateProfile) with the Supabase client replaced by spies. Proves age
// attestation fails closed: after any attest_adult error, no profile is created and onboarding is not completed.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), upsert: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { rpc: spies.rpc, from: spies.from } }));

import { birthDateError } from "./age";
import {
  ATTESTATION_FAILED,
  ATTESTATION_SIGN_IN,
  ATTESTATION_UNAVAILABLE,
  attestThenCreateProfile,
} from "./onboardingSave";

const adultBirth = "1995-06-15";
const input = {
  userId: "user-1",
  birthDate: adultBirth,
  adultConfirmed: true,
  coreRow: { display_name: "Asha", age: 30, looking_for: "friendship", age_min: 21, age_max: 40 },
  detailsRow: { city: "Pune" },
};

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
  spies.from.mockReturnValue({ upsert: spies.upsert });
  spies.upsert.mockResolvedValue({ error: null });
});

function expectStopped(result: Awaited<ReturnType<typeof attestThenCreateProfile>>, onCreated: unknown) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.stage).toBe("attestation");
  expect(spies.from).not.toHaveBeenCalled(); // no profile creation
  expect(spies.upsert).not.toHaveBeenCalled();
  expect(onCreated).not.toHaveBeenCalled(); // onboarding not marked complete
}

describe("attestThenCreateProfile", () => {
  it("records the declaration, then creates the profile and completes onboarding", async () => {
    spies.rpc.mockResolvedValue({ data: 30, error: null });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile(input, onCreated);
    expect(result).toMatchObject({ ok: true, partial: false });
    expect(spies.rpc).toHaveBeenCalledWith("attest_adult", { p_birth_date: adultBirth, p_confirm: true });
    expect(spies.rpc.mock.invocationCallOrder[0]).toBeLessThan(spies.upsert.mock.invocationCallOrder[0]);
    expect(spies.from).toHaveBeenCalledWith("profiles");
    expect(spies.upsert).toHaveBeenCalledWith({ id: "user-1", ...input.coreRow, ...input.detailsRow });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("PGRST202 (function missing) stops onboarding with the temporarily-unavailable message", async () => {
    spies.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile(input, onCreated);
    expectStopped(result, onCreated);
    expect(result).toMatchObject({ message: ATTESTATION_UNAVAILABLE });
  });

  it("a permission error stops onboarding", async () => {
    spies.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for function attest_adult" },
    });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile(input, onCreated);
    expectStopped(result, onCreated);
    expect(result).toMatchObject({ message: ATTESTATION_SIGN_IN });
  });

  for (const error of [
    { code: "28000", message: "Please sign in." },
    { code: "PGRST301", message: "JWT expired" },
    { code: "", message: "Unauthorized", status: 401 },
  ]) {
    it(`an authentication error (${error.code || error.status}) stops onboarding`, async () => {
      spies.rpc.mockResolvedValue({ data: null, error });
      const onCreated = vi.fn();
      const result = await attestThenCreateProfile(input, onCreated);
      expectStopped(result, onCreated);
      expect(result).toMatchObject({ message: ATTESTATION_SIGN_IN });
    });
  }

  it("a network error stops onboarding, whether returned or thrown", async () => {
    spies.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "", message: "TypeError: Failed to fetch" },
    });
    const onCreated = vi.fn();
    expectStopped(await attestThenCreateProfile(input, onCreated), onCreated);
    spies.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const thrown = await attestThenCreateProfile(input, onCreated);
    expectStopped(thrown, onCreated);
    expect(thrown).toMatchObject({ message: ATTESTATION_FAILED });
  });

  it("an unexpected database error stops onboarding without showing the raw error", async () => {
    spies.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "internal: relation private.x" },
    });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile(input, onCreated);
    expectStopped(result, onCreated);
    expect(result).toMatchObject({ message: ATTESTATION_FAILED });
  });

  it("no error but no adult age returned still stops onboarding (fails closed)", async () => {
    const onCreated = vi.fn();
    for (const data of [null, undefined, "30", 17]) {
      spies.rpc.mockResolvedValueOnce({ data, error: null });
      expectStopped(await attestThenCreateProfile(input, onCreated), onCreated);
    }
  });

  it("a retry after a temporary failure can succeed", async () => {
    spies.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "missing" } })
      .mockResolvedValueOnce({ data: 30, error: null });
    const onCreated = vi.fn();
    expectStopped(await attestThenCreateProfile(input, onCreated), onCreated);
    const retry = await attestThenCreateProfile(input, onCreated);
    expect(retry.ok).toBe(true);
    expect(spies.upsert).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("the 18+ confirmation is still required: the server's refusal stops onboarding", async () => {
    spies.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Please confirm that you are 18 or older." },
    });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile({ ...input, adultConfirmed: false }, onCreated);
    expect(spies.rpc).toHaveBeenCalledWith("attest_adult", { p_birth_date: adultBirth, p_confirm: false });
    expectStopped(result, onCreated);
    expect(result).toMatchObject({ message: "Please confirm that you are 18 or older." });
  });

  it("an under-18 date of birth is still rejected, in the browser and by the server", async () => {
    const today = new Date();
    const seventeen = `${today.getFullYear() - 17}-01-01`;
    expect(birthDateError(seventeen)).toMatch(/18/);
    spies.rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "RentMate is only for people aged 18 or over." },
    });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile({ ...input, birthDate: seventeen }, onCreated);
    expectStopped(result, onCreated);
    expect(result).toMatchObject({ message: "RentMate is only for people aged 18 or over." });
  });

  it("a profile save error after a successful attestation does not complete onboarding", async () => {
    spies.rpc.mockResolvedValue({ data: 30, error: null });
    spies.upsert.mockResolvedValue({ error: { code: "23514", message: "check constraint" } });
    const onCreated = vi.fn();
    const result = await attestThenCreateProfile(input, onCreated);
    expect(result).toMatchObject({ ok: false, stage: "profile" });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("Onboarding has no fail-open exception and creates profiles only through this sequence", () => {
    const src = readFileSync(new URL("./components/Onboarding.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/PGRST202/);
    expect(src).not.toMatch(/from\("profiles"\)|\.rpc\(/);
    expect(src).toMatch(/attestThenCreateProfile\(/);
  });

  it("messages never present the declaration as verification", () => {
    for (const m of [ATTESTATION_FAILED, ATTESTATION_SIGN_IN, ATTESTATION_UNAVAILABLE]) {
      expect(m).not.toMatch(/verif/i);
    }
  });
});
