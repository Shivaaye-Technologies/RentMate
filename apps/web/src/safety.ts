/** Must match the check constraint on public.reports.reason. */
export const REPORT_REASONS = [
  { value: "fake", label: "Fake profile or catfishing" },
  { value: "inappropriate", label: "Inappropriate photos or messages" },
  { value: "harassment", label: "Harassment or threats" },
  { value: "underage", label: "Looks under 18" },
  { value: "scam", label: "Scam, spam or asking for money" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export const DELETE_CONFIRM_WORD = "DELETE";

/** The user must type the confirmation word exactly (ignoring surrounding spaces and case). */
export function isDeleteConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

/** Friendlier wording for database errors users can trigger. */
export function friendlyError(message: string): string {
  if (/row-level security/i.test(message)) return "That action isn't allowed.";
  if (/duplicate key/i.test(message)) return "Already done.";
  return message;
}
