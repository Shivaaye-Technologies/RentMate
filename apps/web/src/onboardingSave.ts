/**
 * Creating a profile at the end of onboarding (P2-03). The member's date of birth and 18+ confirmation are recorded
 * with the attest_adult RPC first; only when that succeeds is the profile created. Fails closed: any RPC error
 * (missing function, permission, sign-in, network, database or anything unexpected) stops here, the profile is not
 * created and onboarding is not completed, and the member can try again.
 *
 * The sequence lives in the shared data layer (./shared/profileData.ts), which the Android app uses too; this binds it
 * to the web Supabase client. This records a self-declaration ("self_declared"), not age or identity verification.
 */
import {
  attestThenCreateProfile as attestThenCreate,
  supabaseProfileDb,
  type CreateProfileResult,
} from "./shared/profileData";
import { supabase } from "./supabase";

export {
  ATTESTATION_FAILED,
  ATTESTATION_SIGN_IN,
  ATTESTATION_UNAVAILABLE,
  attestationErrorMessage,
} from "./attestation";

export type OnboardingSaveResult = CreateProfileResult;

/**
 * Records the age declaration, then creates the profile. `onCreated` (which marks onboarding as saved) runs only
 * after both succeed.
 */
export function attestThenCreateProfile(
  input: {
    userId: string;
    birthDate: string;
    adultConfirmed: boolean;
    coreRow: object;
    detailsRow: object;
  },
  onCreated: (row: Record<string, unknown>, partial: boolean) => void,
): Promise<OnboardingSaveResult> {
  return attestThenCreate(supabaseProfileDb(supabase), input, onCreated);
}
