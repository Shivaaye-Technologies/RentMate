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

import {
  ATTESTATION_FAILED,
  attestationErrorMessage,
  type AttestationDbError as DbError,
} from "./attestation";

export {
  ATTESTATION_FAILED,
  ATTESTATION_SIGN_IN,
  ATTESTATION_UNAVAILABLE,
  attestationErrorMessage,
} from "./attestation";

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
