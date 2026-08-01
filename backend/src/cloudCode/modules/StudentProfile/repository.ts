/**
 * Profile persistence — the only place that reads or writes `StudentProfile`.
 *
 * Every operation uses the master key, because the class denies all client
 * access by design; authorisation happens above, in the cloud function, before
 * anything here is called.
 *
 * The rule this file exists to keep: **a profile is always looked up by the
 * authenticated user**, never by an id from a request. There is no
 * `findById(id)` here, so no future caller can accidentally hand one Student
 * another Student's record.
 */

import {catchError} from '@90soft/parse-server-kit';

import {CATALOG_REFERENCE_NAMES, CatalogReferenceField} from './constants';
import {ResolvedCatalogSelections} from './catalogRefs';
import {ProfileError, profileError} from './errors';
import {NormalisedProfile, calculateIsComplete} from './validation';

const CLASS_NAME = 'StudentProfile';

/** Parse's duplicate-value code, plus MongoDB's raw duplicate-key code. */
const PARSE_DUPLICATE_VALUE = 137;
const MONGO_DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as {code?: unknown} | null)?.code;
  if (code === PARSE_DUPLICATE_VALUE || code === MONGO_DUPLICATE_KEY) return true;
  const message = String((error as {message?: unknown} | null)?.message ?? '');
  return message.includes('E11000') || message.includes('duplicate key');
}

/**
 * The caller's own profile, or `undefined`. Always keyed by the user.
 *
 * The four catalog pointers are included, because every caller needs their
 * localised names to render the form — fetching them separately would be four
 * more round trips for data the profile already points at.
 */
export async function findProfileForUser(
  user: Parse.User
): Promise<Parse.Object | undefined> {
  const query = new Parse.Query(CLASS_NAME);
  query.equalTo('user', user);
  for (const field of CATALOG_REFERENCE_NAMES) query.include(field);

  const [error, profile] = await catchError(query.first({useMasterKey: true}));
  if (error) throw profileError(ProfileError.PROFILE_UNAVAILABLE);
  return (profile as Parse.Object | undefined) ?? undefined;
}

/**
 * Create or update the caller's profile.
 *
 * `verifiedEmail` and `user` are written here and only here, from the
 * authenticated session — never from the request. `isComplete` is calculated
 * from what is about to be stored, after the write is assembled, so it always
 * describes the row rather than the intent.
 *
 * Optional fields absent from the input are **unset**, not left behind: clearing
 * a career goal has to actually clear it.
 */
export async function saveProfileForUser(
  user: Parse.User,
  verifiedEmail: string,
  values: NormalisedProfile,
  selections: ResolvedCatalogSelections = {}
): Promise<{profile: Parse.Object; created: boolean}> {
  const existing = await findProfileForUser(user);
  const created = !existing;

  const ProfileClass = Parse.Object.extend(CLASS_NAME);
  const profile = (existing ?? new ProfileClass()) as Parse.Object;

  if (created) {
    profile.set('user', user);

    // Read for the owner only. No write: a Student changes their profile by
    // calling the operation, never by writing the record directly.
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    acl.setReadAccess(user.id as string, true);
    profile.setACL(acl);
  }

  // Derived server-side on every save, so a change of address at the identity
  // provider follows through.
  profile.set('verifiedEmail', verifiedEmail);

  const optional: (keyof NormalisedProfile)[] = [
    'dateOfBirth',
    'customInstitutionName',
    'expectedGraduationDate',
    'careerGoal',
    'targetRoleReason',
    'githubUrl',
    'linkedinUrl',
    'portfolioUrl',
  ];

  profile.set('fullName', values.fullName);
  profile.set('phone', values.phone);
  profile.set('educationStatus', values.educationStatus);

  // The catalog pointers. A selection absent from the resolution is **unset**,
  // not left behind: clearing a target role has to actually clear it, and a
  // stale pointer would keep answering a question the Student withdrew.
  for (const field of CATALOG_REFERENCE_NAMES) {
    const item = selections[field as CatalogReferenceField];
    if (item) profile.set(field, item);
    else profile.unset(field);
  }

  for (const field of optional) {
    const value = values[field];
    if (value === undefined) profile.unset(field);
    else profile.set(field, value);
  }

  profile.set(
    'isComplete',
    calculateIsComplete({
      fullName: values.fullName,
      verifiedEmail,
      phone: values.phone,
      hasCity: Boolean(selections.city),
      hasInstitution: Boolean(selections.institution),
      hasMajor: Boolean(selections.major),
      institutionIsOther: selections.institution?.get('isOther') === true,
      customInstitutionName: values.customInstitutionName,
      educationStatus: values.educationStatus,
      expectedGraduationDate: values.expectedGraduationDate,
    })
  );

  const [error, saved] = await catchError(profile.save(null, {useMasterKey: true}));

  if (error || !saved) {
    if (isDuplicateKeyError(error)) {
      // A concurrent first save won the unique index. Re-read and apply to the
      // winner rather than creating a second profile.
      const winner = await findProfileForUser(user);
      if (winner) return saveProfileForUser(user, verifiedEmail, values, selections);
    }
    throw profileError(ProfileError.PROFILE_SAVE_FAILED);
  }

  return {profile: saved as Parse.Object, created};
}

/**
 * Store or clear the profile photo.
 *
 * Passing `undefined` removes it outright — the column is unset rather than
 * blanked, so nothing of the previous image is left behind.
 */
export async function setProfilePhoto(
  profile: Parse.Object,
  photoData: string | undefined
): Promise<Parse.Object> {
  if (photoData) {
    profile.set('photoData', photoData);
    profile.set('photoUpdatedAt', new Date());
  } else {
    profile.unset('photoData');
    profile.unset('photoUpdatedAt');
  }

  const [error, saved] = await catchError(profile.save(null, {useMasterKey: true}));
  if (error || !saved) throw profileError(ProfileError.PROFILE_SAVE_FAILED);
  return saved as Parse.Object;
}
