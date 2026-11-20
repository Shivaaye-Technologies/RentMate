/** Must match the check constraint on public.reports.reason. */
export const REPORT_REASONS = [
  { value: "fake", label: "Fake profile or catfishing" },
  { value: "inappropriate", label: "Inappropriate photos or messages" },
  { value: "harassment", label: "Harassment or threats" },
  { value: "underage", label: "Looks under 18" },
  { value: "scam", label: "Scam, spam or asking for money" },
  { value: "sexual_content", label: "Sexual or adult content" },
  { value: "sexual_solicitation", label: "Offering or asking for sexual services or escorting" }, // policy-guard: allow (report reason / refusal test)
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export const DELETE_CONFIRM_WORD = "DELETE";

/** The user must type the confirmation word exactly (ignoring surrounding spaces and case). */
export function isDeleteConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

/** Shown when the database refuses text with sexual/adult wording or solicitation. */
export const POLICY_TEXT_BLOCKED =
  "RentMate does not allow sexual or adult content, escorting or sexual solicitation. Please rephrase.";

/** Friendlier wording for database errors users can trigger. */
export function friendlyError(message: string): string {
  if (/row-level security/i.test(message)) return "That action isn't allowed.";
  if (/duplicate key/i.test(message)) return "Already done.";
  if (/RentMate does not allow/i.test(message)) return POLICY_TEXT_BLOCKED;
  return message;
}
