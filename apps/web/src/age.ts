/**
 * Date-of-birth checks for the 18+ self-declaration (P2-03). A declaration, not verification: the server records it
 * as "self_declared" and applies the same rules (public.attest_adult).
 */
export const ADULT_AGE = 18;
const OLDEST = 100;

/** "YYYY-MM-DD" in local time, or null when it is not a real calendar date. */
function parseDay(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return { y, m: mo, d };
}

/** Whole years old on `today`, or null for an invalid date. */
export function ageOn(birth: string, today: Date = new Date()): number | null {
  const b = parseDay(birth);
  if (!b) return null;
  let years = today.getFullYear() - b.y;
  const beforeBirthday =
    today.getMonth() + 1 < b.m || (today.getMonth() + 1 === b.m && today.getDate() < b.d);
  if (beforeBirthday) years--;
  return years;
}

/** A message for the member, or null when the date is acceptable. */
export function birthDateError(birth: string, today: Date = new Date()): string | null {
  if (!birth.trim()) return "Enter your date of birth.";
  const years = ageOn(birth, today);
  if (years === null || years < 0) return "Enter a valid date of birth.";
  if (years > OLDEST) return "Enter a valid date of birth.";
  if (years < ADULT_AGE) return "RentMate is only for people aged 18 or over.";
  return null;
}

/** Latest date of birth that is 18 today, for the date input's `max`. */
export function latestAdultBirthDate(today: Date = new Date()): string {
  const d = new Date(today.getFullYear() - ADULT_AGE, today.getMonth(), today.getDate());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
