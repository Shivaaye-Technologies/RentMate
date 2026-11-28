/**
 * Date of birth and mandatory 18+ declaration (P2-03) for the Android app. The quick checks below only save a round
 * trip; the declaration itself is recorded by the shared data layer (attestAdult → attest_adult), which fails closed
 * on every error. A self-declaration, not age or identity verification.
 */
import { attestAdult, birthDateError, type ProfileDb } from "./shared";

export type DeclareResult =
  { ok: true; age: number } | { ok: false; message: string; field?: "date" | "confirm" };

export const CONFIRM_REQUIRED = "Please confirm that you are 18 or older.";

/** `birthDate` is "YYYY-MM-DD". */
export async function declareAdult(
  db: ProfileDb,
  birthDate: string,
  confirmed: boolean,
  today: Date = new Date(),
): Promise<DeclareResult> {
  const dateProblem = birthDateError(birthDate, today);
  if (dateProblem) return { ok: false, message: dateProblem, field: "date" };
  if (!confirmed) return { ok: false, message: CONFIRM_REQUIRED, field: "confirm" };
  return attestAdult(db, birthDate, true);
}

/** Builds "YYYY-MM-DD" from three text fields, or "" when they are not complete numbers. */
export function isoDate(day: string, month: string, year: string): string {
  const d = day.trim();
  const m = month.trim();
  const y = year.trim();
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return "";
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
