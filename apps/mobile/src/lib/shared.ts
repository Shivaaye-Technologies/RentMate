/**
 * Rules shared with the web app, imported in place from apps/web/src (pure modules: no browser, Vite or Supabase
 * imports). Keep business rules there, not here, so web and Android never disagree.
 */
export { ADULT_AGE, ageOn, birthDateError, latestAdultBirthDate } from "../../../web/src/age";
export {
  ATTESTATION_FAILED,
  ATTESTATION_SIGN_IN,
  ATTESTATION_UNAVAILABLE,
  attestationErrorMessage,
} from "../../../web/src/attestation";
export {
  AccountDeletionError,
  DELETION_RETRY_MESSAGE,
  deleteAccountViaServer,
} from "../../../web/src/accountDeletion";
export { DELETE_CONFIRM_WORD, isDeleteConfirmed } from "../../../web/src/safety";
export {
  classifyAuthError,
  emailProblem,
  looksLikeExistingAccount,
  passwordProblem,
} from "../../../web/src/auth";
export {
  attestAdult,
  attestThenCreateProfile,
  DECLARATION_CHECK_FAILED,
  declarationStatus,
  isMissingColumn,
  saveErrorMessage,
  saveProfileFields,
  supabaseProfileDb,
  type DeclarationStatus,
  type ProfileDb,
} from "../../../web/src/shared/profileData";
export { formatIndianNumber } from "../../../web/src/market/marketText";
export {
  CHILDREN_LABELS,
  detailsFromRow,
  EDUCATION_LABELS,
  EXERCISE_LABELS,
  GENDER_LABELS,
  heightLabel,
  MAX_NEIGHBOURHOODS,
  MAX_PLACES,
  MAX_PROMPTS,
  PLACE_CATEGORIES,
  PROMPT_ANSWER_MAX,
  PROMPT_CATEGORIES,
  searchCities,
  SHOW_ME_LABELS,
  SMOKING_LABELS,
  validateDetails,
  type DetailFields,
  type Prompt,
} from "../../../web/src/details";
export {
  allPhotos,
  isNew,
  LOOKING_FOR_LABELS,
  MAX_INTERESTS,
  profileStrength,
  type LookingFor,
  type PersonRow,
  type ProfileRow,
  type StrengthItem,
} from "../../../web/src/profile";
export { INTEREST_CATEGORIES, interestKey, STANDARD_INTERESTS } from "../../../web/src/interests";
