/**
 * The safe Student summary an Admin may see.
 *
 * ── The one thing this file exists to get right ─────────────────────────────
 * An Admin legitimately needs to see who is in a Batch, and to find a Student in
 * the directory. That is a *product* need, and it does not extend to everything
 * the system knows about a person. So this is a hand-built allow-list over the
 * **profile**, and it deliberately never touches `_User` beyond the id.
 *
 * Never present, and asserted absent by test: the password hash, the session
 * token, `authData`, the Google subject, the Google avatar URL, anything from
 * `StudentAuthIdentity`, the internal generated username, ACL, or a raw Parse
 * object.
 *
 * The verified email **is** present. That is the deliberate line: it is the
 * address the product verified at sign-in and the only way an Admin can tell two
 * people with the same name apart, so it is included — while the phone number,
 * date of birth, and photo bytes, which serve no Admin purpose in a list, are
 * not.
 */

import {catchError} from '@90soft/parse-server-kit';

import {CatalogRefDto, toCatalogRefDto} from '../ProfileCatalog/dto';
import {BATCH_PAGE} from './constants';

export interface AdminStudentSummaryDto {
  /** The Student's `_User` objectId. The only identifier that travels. */
  id: string;
  fullName: string;
  /** Verified at Google. Present so an Admin can tell two people apart. */
  verifiedEmail: string;
  city?: CatalogRefDto;
  institution?: CatalogRefDto;
  major?: CatalogRefDto;
  targetRole?: CatalogRefDto;
  /** Whether the Student has finished their profile. */
  profileComplete: boolean;
  /** True when a photo exists. The bytes come from the owner-only route. */
  hasPhoto: boolean;
  /** How many Batches they belong to. Zero is a normal, visible answer. */
  batchCount?: number;
  /** When they joined the Batch being listed. Only on a Batch roster. */
  joinedAt?: string;
}

/** Keys that must never appear in a Student summary. Exported for the tests. */
export const FORBIDDEN_STUDENT_SUMMARY_KEYS: readonly string[] = [
  'password',
  'sessionToken',
  'authData',
  'username',
  'ACL',
  'acl',
  'className',
  'objectId',
  'attributes',
  'provider',
  'providerSubject',
  'providerPictureUrl',
  'sub',
  'photoData',
  'photoUpdatedAt',
  'phone',
  'dateOfBirth',
  'user',
  'masterKey',
];

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalCatalogRef(value: unknown): CatalogRefDto | undefined {
  const item = value as Parse.Object | undefined;
  if (!item || typeof item.get !== 'function') return undefined;
  if (item.get('type') === undefined) return undefined;
  return toCatalogRefDto(item);
}

function toDateOnly(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value.toISOString().slice(0, 10);
}

/**
 * Build the summary from a Student's profile.
 *
 * `studentId` is passed separately because the profile's `user` pointer is one
 * of the things that must not travel — the id is taken from it here, once, and
 * the pointer itself never reaches the DTO.
 */
export function toStudentSummary(
  studentId: string,
  profile: Parse.Object | undefined,
  extras: {batchCount?: number; joinedAt?: Date} = {}
): AdminStudentSummaryDto {
  const dto: AdminStudentSummaryDto = {
    id: studentId,
    fullName: String(profile?.get('fullName') ?? ''),
    verifiedEmail: String(profile?.get('verifiedEmail') ?? ''),
    profileComplete: profile?.get('isComplete') === true,
    hasPhoto: typeof profile?.get('photoData') === 'string',
  };

  const city = optionalCatalogRef(profile?.get('city'));
  if (city) dto.city = city;

  const institution = optionalCatalogRef(profile?.get('institution'));
  if (institution) dto.institution = institution;

  const major = optionalCatalogRef(profile?.get('major'));
  if (major) dto.major = major;

  const targetRole = optionalCatalogRef(profile?.get('targetRole'));
  if (targetRole) dto.targetRole = targetRole;

  if (typeof extras.batchCount === 'number') dto.batchCount = extras.batchCount;

  const joined = toDateOnly(extras.joinedAt);
  if (joined) dto.joinedAt = joined;

  return dto;
}

/** The four catalog pointers every Student summary resolves. */
const CATALOG_FIELDS = ['city', 'institution', 'major', 'targetRole'] as const;

/**
 * Load the profiles for a set of Students in one query.
 *
 * A list of thirty Students must not become thirty-one round trips, and the
 * four catalog pointers are included so their localised names come back with
 * them rather than in another thirty.
 */
export async function findProfilesForStudents(
  studentIds: readonly string[]
): Promise<Map<string, Parse.Object>> {
  const profiles = new Map<string, Parse.Object>();
  if (studentIds.length === 0) return profiles;

  const UserClass = Parse.Object.extend('_User');
  const pointers = studentIds.map(id => {
    const user = new UserClass() as Parse.Object;
    user.id = id;
    return user;
  });

  const query = new Parse.Query('StudentProfile');
  query.containedIn('user', pointers);
  for (const field of CATALOG_FIELDS) query.include(field);
  query.limit(BATCH_PAGE.maxLimit * 5);

  const [error, found] = await catchError(query.find({useMasterKey: true}));
  if (error) return profiles;

  for (const profile of (found ?? []) as Parse.Object[]) {
    const id = (profile.get('user') as Parse.Object | undefined)?.id;
    if (id) profiles.set(id, profile);
  }
  return profiles;
}

/**
 * Turn a page of enrollments into Student summaries.
 *
 * `search` filters the already-loaded page by name or verified email. It is
 * applied here rather than in the query because the searchable values live on
 * the profile while the page is drawn from enrollments — and a Batch roster is
 * small enough that this is the honest trade rather than a second index.
 */
export async function toBatchStudentDto(
  enrollments: readonly Parse.Object[],
  search = ''
): Promise<AdminStudentSummaryDto[]> {
  const studentIds: string[] = [];
  const joinedById = new Map<string, Date>();

  for (const enrollment of enrollments) {
    const student = enrollment.get('student') as Parse.Object | undefined;
    if (!student?.id) continue;
    studentIds.push(student.id);
    const joinedAt = enrollment.get('joinedAt');
    if (joinedAt instanceof Date) joinedById.set(student.id, joinedAt);
  }

  const profiles = await findProfilesForStudents(studentIds);
  const needle = search.trim().toLowerCase();

  return studentIds
    .map(id => toStudentSummary(id, profiles.get(id), {joinedAt: joinedById.get(id)}))
    .filter(summary => {
      if (needle.length === 0) return true;
      return (
        summary.fullName.toLowerCase().includes(needle) ||
        summary.verifiedEmail.toLowerCase().includes(needle)
      );
    });
}

export {optionalString};
