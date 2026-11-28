/**
 * The database refused to create a profile because the member has not recorded their date of birth and 18+
 * confirmation (attest_adult) while database-level age attestation is on (P2-03). A self-declaration, not
 * verification.
 */
export class AgeAttestationRequiredError extends Error {}

/** Recognises the database's refusal (raised by private.profile_age_attestation). */
export function isAgeAttestationRefusal(
  err: { code?: string; message?: string } | null | undefined,
): boolean {
  return err?.code === "P0001" && /confirm your date of birth/i.test(err.message ?? "");
}
