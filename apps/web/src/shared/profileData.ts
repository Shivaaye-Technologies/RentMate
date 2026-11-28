/**
 * Profile data layer shared by the web and the Android app. The database is passed in (a small "port"), so this file
 * has no Supabase singleton, browser, Vite or React imports and both apps run exactly the same rules:
 *
 *   - the age declaration (attest_adult) fails closed on every error and on any answer that is not an adult age;
 *   - a profile is created only after a successful declaration;
 *   - save errors are turned into messages members can act on.
 *
 * The declaration is a self-declaration ("self_declared"), not age or identity verification.
 * Web wrappers: apps/web/src/onboardingSave.ts, apps/web/src/profileApi.ts. Android: apps/mobile/src/lib/data.ts.
 */
import { ADULT_AGE } from "../age";
import { ATTESTATION_FAILED, attestationErrorMessage, type AttestationDbError } from "../attestation";
import { POLICY_TEXT_BLOCKED } from "../safety";

export type DbError = AttestationDbError;
type Result<T = unknown> = { data: T; error: DbError };

/** What the profile data layer needs from the database. */
export interface ProfileDb {
  attestAdult(args: { p_birth_date: string; p_confirm: boolean }): PromiseLike<Result>;
  myAgeAttestation(): PromiseLike<Result>;
  upsertProfile(row: Record<string, unknown>): PromiseLike<{ error: DbError }>;
  updateProfile(userId: string, patch: Record<string, unknown>): PromiseLike<{ error: DbError }>;
}

/**
 * The subset of a supabase-js client used here. Structural on purpose: the web and the Android app each have their
 * own supabase-js install, and both clients fit this shape.
 */
export interface SupabaseLike {
  rpc(fn: string, args?: object): PromiseLike<{ data: unknown; error: DbError }>;
  from(table: string): {
    upsert(row: object): PromiseLike<{ error: DbError }>;
    update(patch: object): { eq(column: string, value: string): PromiseLike<{ error: DbError }> };
  };
}

export function supabaseProfileDb(client: SupabaseLike): ProfileDb {
  return {
    attestAdult: (args) => client.rpc("attest_adult", args),
    myAgeAttestation: () => client.rpc("my_age_attestation"),
    upsertProfile: (row) => client.from("profiles").upsert(row),
    updateProfile: (userId, patch) => client.from("profiles").update(patch).eq("id", userId),
  };
}

/** True when the database doesn't have a column yet (migration not applied). */
export function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST204" ||
    err.code === "42703" ||
    /could not find the '.*' column|column .* does not exist/i.test(err.message ?? "")
  );
}

/** Message for a failed profile save that people can act on. */
export function saveErrorMessage(err: { code?: string; message?: string }): string {
  if (isMissingColumn(err)) {
    return "This part of your profile can't be saved yet because a database update is still pending. Your other details are safe.";
  }
  if (/RentMate does not allow/i.test(err.message ?? "")) return POLICY_TEXT_BLOCKED;
  if (err.code === "23514")
    return "One of the values isn't allowed. Check the highlighted fields and try again.";
  if (/row-level security/i.test(err.message ?? "")) return "You can only change your own profile.";
  return `Could not save: ${err.message ?? "unknown error"}`;
}

export type AttestResult = { ok: true; age: number } | { ok: false; message: string };

/**
 * Records the date of birth and 18+ confirmation (attest_adult). Fails closed: a thrown error, any RPC error, or an
 * answer that is not an adult age is a failure with a safe message.
 */
export async function attestAdult(
  db: ProfileDb,
  birthDate: string,
  adultConfirmed: boolean,
): Promise<AttestResult> {
  let attested: Result;
  try {
    attested = await db.attestAdult({ p_birth_date: birthDate, p_confirm: adultConfirmed });
  } catch {
    return { ok: false, message: ATTESTATION_FAILED };
  }
  if (attested.error) return { ok: false, message: attestationErrorMessage(attested.error) };
  // attest_adult returns the member's age; anything else means it did not confirm an adult.
  if (typeof attested.data !== "number" || attested.data < ADULT_AGE) {
    return { ok: false, message: ATTESTATION_FAILED };
  }
  return { ok: true, age: attested.data };
}

export type DeclarationStatus = "declared" | "missing" | { error: string };

export const DECLARATION_CHECK_FAILED =
  "We couldn't check your account. Check your connection and try again.";

/**
 * Whether the signed-in member has recorded their declaration (my_age_attestation). A missing function counts as
 * "missing" so the member is sent to the declaration step, which then fails closed with its own message.
 */
export async function declarationStatus(db: ProfileDb): Promise<DeclarationStatus> {
  try {
    const { data, error } = await db.myAgeAttestation();
    if (error) return error.code === "PGRST202" ? "missing" : { error: DECLARATION_CHECK_FAILED };
    return Array.isArray(data) && data.length > 0 ? "declared" : "missing";
  } catch {
    return { error: DECLARATION_CHECK_FAILED };
  }
}

export type CreateProfileResult =
  | { ok: true; row: Record<string, unknown>; partial: boolean }
  | { ok: false; stage: "attestation" | "profile"; message: string };

/**
 * Records the age declaration, then creates the profile. `onCreated` (which marks onboarding as saved) runs only
 * after both succeed.
 */
export async function attestThenCreateProfile(
  db: ProfileDb,
  input: { userId: string; birthDate: string; adultConfirmed: boolean; coreRow: object; detailsRow: object },
  onCreated: (row: Record<string, unknown>, partial: boolean) => void,
): Promise<CreateProfileResult> {
  const attested = await attestAdult(db, input.birthDate, input.adultConfirmed);
  if (!attested.ok) return { ok: false, stage: "attestation", message: attested.message };

  const row: Record<string, unknown> = { id: input.userId, ...input.coreRow, ...input.detailsRow };
  let { error } = await db.upsertProfile(row);
  let partial = false;
  if (error && isMissingColumn(error)) {
    // The details columns aren't in the database yet: save the essentials so the member can start.
    ({ error } = await db.upsertProfile({ id: input.userId, ...input.coreRow }));
    partial = true;
  }
  if (error) return { ok: false, stage: "profile", message: saveErrorMessage(error) };
  const created: Record<string, unknown> = partial ? { id: input.userId, ...input.coreRow } : row;
  onCreated(created, partial);
  return { ok: true, row: created, partial };
}

/** Saves some of the member's own profile fields (RLS allows only their own row). Throws a readable message. */
export async function saveProfileFields(
  db: ProfileDb,
  userId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.updateProfile(userId, patch);
  if (error) throw new Error(saveErrorMessage(error));
}
