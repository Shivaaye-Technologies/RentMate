/**
 * Age-declaration error messages (P2-03), shared by the web and the Android app. Pure: no Supabase, browser or React
 * imports. The declaration is a self-declaration ("self_declared"), not age or identity verification.
 */
export type AttestationDbError = { code?: string; message?: string; status?: number } | null | undefined;

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
export function attestationErrorMessage(err: NonNullable<AttestationDbError>): string {
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
