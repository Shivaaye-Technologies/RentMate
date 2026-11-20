/**
 * Date of birth and mandatory 18+ declaration (P2-03), recorded with the existing attest_adult RPC. Fails closed:
 * nothing continues unless the database confirms an adult age. Every error (function missing, permission, sign-in,
 * network, database, unexpected) stops here with a safe message. A self-declaration, not age or identity
 * verification.
 */
import { ADULT_AGE, ATTESTATION_FAILED, attestationErrorMessage, birthDateError } from "./shared";

type RpcError = { code?: string; message?: string; status?: number } | null;
export type AttestRpc = (args: {
  p_birth_date: string;
  p_confirm: boolean;
}) => PromiseLike<{ data: unknown; error: RpcError }>;

export type DeclareResult =
  { ok: true; age: number } | { ok: false; message: string; field?: "date" | "confirm" };

export const CONFIRM_REQUIRED = "Please confirm that you are 18 or older.";

/** `birthDate` is "YYYY-MM-DD". The browser-side checks only save a round trip; the database decides. */
export async function declareAdult(
  attest: AttestRpc,
  birthDate: string,
  confirmed: boolean,
  today: Date = new Date(),
): Promise<DeclareResult> {
  const dateProblem = birthDateError(birthDate, today);
  if (dateProblem) return { ok: false, message: dateProblem, field: "date" };
  if (!confirmed) return { ok: false, message: CONFIRM_REQUIRED, field: "confirm" };
  let result: { data: unknown; error: RpcError };
  try {
    result = await attest({ p_birth_date: birthDate, p_confirm: true });
  } catch {
    return { ok: false, message: ATTESTATION_FAILED };
  }
  if (result.error) return { ok: false, message: attestationErrorMessage(result.error) };
  if (typeof result.data !== "number" || result.data < ADULT_AGE)
    return { ok: false, message: ATTESTATION_FAILED };
  return { ok: true, age: result.data };
}

/** Builds "YYYY-MM-DD" from three text fields, or "" when they are not complete numbers. */
export function isoDate(day: string, month: string, year: string): string {
  const d = day.trim();
  const m = month.trim();
  const y = year.trim();
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
