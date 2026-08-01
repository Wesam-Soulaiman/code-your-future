/**
 * The safe profile DTO.
 *
 * A hand-built allow-list, like every other DTO in this repository. A raw
 * `Parse.Object` is never returned, so ACL, the internal pointer, the storage
 * handle behind the photo, and any column added later cannot leak by default.
 *
 * This is the **owner's own** profile, so it legitimately carries personal data
 * the Student typed: their phone, city, and date of birth. That is exactly why
 * the operations returning it require a live Student session and match the
 * profile to the caller — the DTO is safe *because* of who it is sent to.
 *
 * What it never carries: the `user` pointer, the photo's storage handle or any
 * public URL, `isComplete` as anything but a calculated boolean, the Google
 * subject, provider data of any kind, or anything from `StudentAuthIdentity`.
 */

import {CatalogRefDto, toCatalogRefDto} from '../ProfileCatalog/dto';
import {toGraduationMonth} from './validation';

export interface StudentProfileDto {
  id: string;
  fullName: string;
  /** Verified, read-only. Shown so the Student can see which account this is. */
  verifiedEmail: string;
  phone?: string;
  /**
   * The four catalog selections, resolved ⟨CP3A catalog⟩.
   *
   * Each is the localised item itself — id, code, both names, and whether it is
   * still active — never a raw Parse pointer and never a bare id the browser
   * would have to look up. `active: false` is how the form shows that a stored
   * answer has since been retired.
   */
  city?: CatalogRefDto;
  /** `YYYY-MM-DD`, or absent. */
  dateOfBirth?: string;
  institution?: CatalogRefDto;
  customInstitutionName?: string;
  major?: CatalogRefDto;
  educationStatus?: string;
  /** `YYYY-MM`, or absent — the UI works in months, not days. */
  expectedGraduationMonth?: string;
  careerGoal?: string;
  /** Optional. Never affects completion. */
  targetRole?: CatalogRefDto;
  /** Optional, ≤ 500 characters. Only present alongside a target role. */
  targetRoleReason?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  /** True when a photo exists. The bytes come from a separate authorised call. */
  hasPhoto: boolean;
  /** Changes whenever the photo does, so a cached image is not shown after a replace. */
  photoVersion?: string;
  /**
   * True only on the empty shape, when `fullName` was prefilled from the
   * verified Google claims. Lets the form say where the name came from and that
   * it can be changed. Never present once a profile exists.
   */
  nameFromProvider?: boolean;
  /** Calculated server-side. */
  isComplete: boolean;
}

/** Keys that must never appear in the DTO. Exported for the tests. */
export const FORBIDDEN_PROFILE_DTO_KEYS: readonly string[] = [
  'user',
  'userId',
  'ACL',
  'acl',
  'photo',
  'photoData',
  'photoUpdatedAt',
  'photoFile',
  'file',
  'url',
  'className',
  'objectId',
  'password',
  'sessionToken',
  'authData',
  'provider',
  'providerSubject',
  'sub',
  'credential',
  'masterKey',
];

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * A catalog pointer, rendered as the safe reference DTO.
 *
 * Returns `undefined` for an unfetched pointer rather than guessing: a pointer
 * whose target was not included has no name to show, and inventing a placeholder
 * would put a wrong label in front of the Student. Every read path includes the
 * four pointers, so this is a guard rather than a normal case.
 */
function optionalCatalogRef(value: unknown): CatalogRefDto | undefined {
  const item = value as Parse.Object | undefined;
  if (!item || typeof item.get !== 'function') return undefined;
  if (item.get('type') === undefined) return undefined;
  return toCatalogRefDto(item);
}

/** `YYYY-MM-DD` from a stored UTC date. */
function toDateOnly(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString().slice(0, 10);
}

/**
 * Build the DTO from a stored profile.
 *
 * `photoVersion` is derived from the photo record's own id and update time. It
 * is an opaque cache key — it reveals nothing about where the bytes live and
 * cannot be turned into a URL.
 */
export function toStudentProfileDto(profile: Parse.Object): StudentProfileDto {
  const photoData = profile.get('photoData');
  const hasPhoto = typeof photoData === 'string' && photoData.length > 0;

  const dto: StudentProfileDto = {
    id: profile.id as string,
    fullName: String(profile.get('fullName') ?? ''),
    verifiedEmail: String(profile.get('verifiedEmail') ?? ''),
    // Whether a photo exists — never the bytes themselves.
    hasPhoto,
    isComplete: profile.get('isComplete') === true,
  };

  const phone = optionalString(profile.get('phone'));
  if (phone) dto.phone = phone;

  const city = optionalCatalogRef(profile.get('city'));
  if (city) dto.city = city;

  const dateOfBirth = toDateOnly(profile.get('dateOfBirth'));
  if (dateOfBirth) dto.dateOfBirth = dateOfBirth;

  const institution = optionalCatalogRef(profile.get('institution'));
  if (institution) dto.institution = institution;

  const customInstitutionName = optionalString(profile.get('customInstitutionName'));
  if (customInstitutionName) dto.customInstitutionName = customInstitutionName;

  const major = optionalCatalogRef(profile.get('major'));
  if (major) dto.major = major;

  const educationStatus = optionalString(profile.get('educationStatus'));
  if (educationStatus) dto.educationStatus = educationStatus;

  const graduation = toGraduationMonth(profile.get('expectedGraduationDate') as Date | undefined);
  if (graduation) dto.expectedGraduationMonth = graduation;

  const careerGoal = optionalString(profile.get('careerGoal'));
  if (careerGoal) dto.careerGoal = careerGoal;

  const targetRole = optionalCatalogRef(profile.get('targetRole'));
  if (targetRole) dto.targetRole = targetRole;

  // Only ever alongside the role it explains; the repository unsets it with the
  // role, so this reads what is actually stored rather than re-deciding.
  const targetRoleReason = optionalString(profile.get('targetRoleReason'));
  if (targetRole && targetRoleReason) dto.targetRoleReason = targetRoleReason;

  const githubUrl = optionalString(profile.get('githubUrl'));
  if (githubUrl) dto.githubUrl = githubUrl;

  const linkedinUrl = optionalString(profile.get('linkedinUrl'));
  if (linkedinUrl) dto.linkedinUrl = linkedinUrl;

  const portfolioUrl = optionalString(profile.get('portfolioUrl'));
  if (portfolioUrl) dto.portfolioUrl = portfolioUrl;

  if (hasPhoto) {
    // An opaque cache key so a replaced photo is not served from cache. It
    // reveals nothing and cannot be turned into a URL.
    const updated = profile.get('photoUpdatedAt');
    const stamp = updated instanceof Date ? updated.getTime() : 0;
    dto.photoVersion = `${profile.id}-${stamp}`;
  }

  return dto;
}

/**
 * The shape returned when a Student has no profile yet.
 *
 * The verified email is already known from the session, so the form can show it
 * immediately rather than waiting for a first save. `suggestedFullName` is the
 * name from the verified Google claims ⟨CP3A catalog⟩ — prefilled into the field
 * so it is not blank, and **nothing more than a suggestion**: it is never stored
 * by itself, and whatever the Student submits is what gets saved.
 *
 * `nameFromProvider` tells the form to say where the name came from. It is a
 * boolean about the *shape* of the response, not data about the person, and it
 * disappears the moment a profile exists.
 */
export function toEmptyProfileDto(
  verifiedEmail: string,
  suggestedFullName = ''
): StudentProfileDto {
  const dto: StudentProfileDto = {
    id: '',
    fullName: suggestedFullName,
    verifiedEmail,
    hasPhoto: false,
    isComplete: false,
  };
  if (suggestedFullName.length > 0) dto.nameFromProvider = true;
  return dto;
}
