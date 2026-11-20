/**
 * Creating a profile at the end of onboarding (P2-03). The member's date of birth and 18+ confirmation are recorded
 * with the attest_adult RPC first; only when that succeeds is the profile created. Fails closed: any RPC error
 * (missing function, permission, sign-in, network, database or anything unexpected) stops here, the profile is not
 * created and onboarding is not completed, and the member can try again.
 *
 * This records a self-declaration ("self_declared"), not age or identity verification.
 */
import { isMissingColumn, saveErrorMessage } from "./profileApi";
import { supabase } from "./supabase";

type DbError = { code?: string; message?: string; status?: number } | null | undefined;

export const ATTESTATION_UNAVAILABLE =
  "Age confirmation is temporarily unavailable, so your profile wasn't created. Please try again later.";
export const ATTESTATION_SIGN_IN = "Your session has ended. Please sign in again, then continue.";
export const ATTESTATION_FAILED =
  "We couldn't confirm your age right now, so your profile wasn't created. Please check your connection and try again.";

const SIGN_IN_CODES = new Set(["28000", "42501", "PGRST301", "PGRST302", "PGRST303"]);
// Errors raised by attest_adult itself, with messages written for members (under 18, missing confirmation,
// invalid date, date already recorded).
const MEMBER_MESSAGE_CODES = new Set(["P0001", "22023"]);

/** A safe message for a failed attest_adult call. Raw database errors are never shown. */
export function attestationErrorMessage(err: NonNullable<DbError>): string {
  const code = err.code ?? "";
  if (code === "PGRST202") return ATTESTATION_UNAVAILABLE;
  if (
    SIGN_IN_CODES.has(code) ||
    err.status === 401 ||
    err.status === 403 ||
    /jwt|permission denied|not authenticated|please sign in/i.test(err.message ?? "")
  ) {
    return ATTESTATION_SIGN_IN;
  }
  if (MEMBER_MESSAGE_CODES.has(code) && err.message) return err.message;
  return ATTESTATION_FAILED;
}

export type OnboardingSaveResult =
  | { ok: true; row: Record<string, unknown>; partial: boolean }
  | { ok: false; stage: "attestation" | "profile"; message: string };

/**
 * Records the age declaration, then creates the profile. `onCreated` (which marks onboarding as saved) runs only
 * after both succeed.
 */
export async function attestThenCreateProfile(
  input: {
    userId: string;
    birthDate: string;
    adultConfirmed: boolean;
    coreRow: object;
    detailsRow: object;
  },
  onCreated: (row: Record<string, unknown>, partial: boolean) => void,
): Promise<OnboardingSaveResult> {
  let attested: { data: unknown; error: DbError };
  try {
    attested = await supabase.rpc("attest_adult", {
      p_birth_date: input.birthDate,
      p_confirm: input.adultConfirmed,
    });
  } catch {
    return { ok: false, stage: "attestation", message: ATTESTATION_FAILED };
  }
  if (attested.error) {
    return { ok: false, stage: "attestation", message: attestationErrorMessage(attested.error) };
  }
  // attest_adult returns the member's age; anything else means it did not confirm an adult.
  if (typeof attested.data !== "number" || attested.data < 18) {
    return { ok: false, stage: "attestation", message: ATTESTATION_FAILED };
  }

  const row: Record<string, unknown> = { id: input.userId, ...input.coreRow, ...input.detailsRow };
  let { error } = await supabase.from("profiles").upsert(row);
  let partial = false;
  if (error && isMissingColumn(error)) {
    // The details columns aren't in the database yet: save the essentials so the member can start.
    ({ error } = await supabase.from("profiles").upsert({ id: input.userId, ...input.coreRow }));
    partial = true;
  }
  if (error) return { ok: false, stage: "profile", message: saveErrorMessage(error) };
  const created: Record<string, unknown> = partial ? { id: input.userId, ...input.coreRow } : row;
  onCreated(created, partial);
  return { ok: true, row: created, partial };
}
