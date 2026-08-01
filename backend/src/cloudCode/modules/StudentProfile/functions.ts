/**
 * Student profile surface — three focused operations, no generic CRUD.
 *
 * All mounted under `/api/student-profile`:
 *
 *   getMyStudentProfile     read the caller's own profile
 *   saveMyStudentProfile    create or update it
 *   removeMyProfilePhoto    delete the photo
 *
 * The photo's **bytes** do not travel through a cloud function at all. Uploading
 * and reading an image are handled by a dedicated authenticated binary endpoint
 * (`modules/StudentProfile/photoRoute.ts`), because Parse Server logs every
 * cloud-function call with its serialised input and result — which put a whole
 * base64 image into the log the moment a Student picked one. Moving the bytes
 * off that path removes the cause rather than masking it, and lets the size
 * limit apply before anything is decoded. Redaction still covers the shape as a
 * second layer.
 *
 * Every operation here:
 *   - requires an authenticated session;
 *   - verifies **live** `Student` role membership, so a withdrawn role takes
 *     effect immediately and an Admin is refused;
 *   - resolves the profile from the session, never from a request id;
 *   - returns a hand-built DTO;
 *   - returns a stable error code and nothing else.
 *
 * There is deliberately no operation that reads another Student's profile, none
 * that lists profiles, and none that lets an Admin edit one.
 */

import {CloudFunction, Route, catchError} from '@90soft/parse-server-kit';

import {AppRole} from '../../utils/constants/roles';
import {getAppRoles, rejectPrivilegedParams, requireUser} from '../../utils/auth/authorize';
import {
  FieldErrors,
  ProfileError,
  isProfileErrorCode,
  profileError,
} from './errors';
import {resolveCatalogSelections} from './catalogRefs';
import {importGoogleAvatar, suggestedFullName} from './googleImport';
import {toEmptyProfileDto, toStudentProfileDto} from './dto';
import {profileLog} from './logging';
import {findProfileForUser, saveProfileForUser, setProfilePhoto} from './repository';
import {findPrivilegedFields, validateProfileInput} from './validation';

/**
 * The last gate before a message reaches the client. Anything unexpected — a
 * database failure, a sharp stack trace — collapses to a stable code.
 */
function toClientError(error: unknown): Parse.Error {
  const message = (error as {message?: unknown} | null)?.message;
  if (typeof message === 'string') {
    // A validation failure carries its field map appended to the code.
    const [code] = message.split(':');
    if (isProfileErrorCode(code)) return error as Parse.Error;
  }
  return profileError(ProfileError.PROFILE_SAVE_FAILED);
}

/**
 * Require a live Student.
 *
 * An Admin is refused rather than quietly given an empty profile: profiles are a
 * Student concept, and an Admin reaching this surface is a bug worth surfacing.
 */
async function requireStudentUser(
  req: Parse.Cloud.FunctionRequest,
  op: string
): Promise<Parse.User> {
  const user = requireUser(req);
  const roles = await getAppRoles(user);

  if (!roles.includes(AppRole.STUDENT)) {
    profileLog.warn('Profile operation refused for a non-Student', {
      op,
      stage: 'authorize',
      ok: false,
      userId: user.id,
      code: ProfileError.NOT_A_STUDENT,
    });
    throw profileError(ProfileError.NOT_A_STUDENT);
  }

  return user;
}

/**
 * The verified email for a Student.
 *
 * Taken from the `_User` record written at sign-in from the Google identity, so
 * it is verified by construction and cannot be influenced by the request.
 */
function verifiedEmailFor(user: Parse.User): string {
  return String(user.get('email') ?? '').trim().toLowerCase();
}

@Route('student-profile')
class StudentProfileFunctions {
  /**
   * The caller's own profile.
   *
   * A Student who has never saved gets the empty shape carrying their verified
   * email, so the form can render immediately with the one field they cannot
   * change already filled in.
   */
  @CloudFunction({
    methods: ['GET'],
    validation: {requireUser: true},
    swagger: {
      summary: 'Get my Student profile',
      description:
        "Return the authenticated Student's own profile as a safe DTO. Students only.",
      tags: ['Student profile'],
      responses: {
        '200': {description: 'Safe profile DTO'},
        '401': {description: 'Not authenticated'},
        '403': {description: 'Not a Student'},
      },
    },
  })
  async getMyStudentProfile(req: Parse.Cloud.FunctionRequest) {
    const user = await requireStudentUser(req, 'getMyStudentProfile');

    const [error, profile] = await catchError(findProfileForUser(user));
    if (error) throw toClientError(error);

    profileLog.info('Profile read', {
      op: 'getMyStudentProfile',
      stage: 'load',
      ok: true,
      userId: user.id,
      profileId: profile?.id,
      complete: profile?.get('isComplete') === true,
    });

    return profile
      ? toStudentProfileDto(profile)
      // A brand-new Student gets their verified email and their Google name
      // already filled in, so the form opens with what we legitimately know
      // rather than with two blanks they have to retype.
      : toEmptyProfileDto(verifiedEmailFor(user), suggestedFullName(user));
  }

  /**
   * Create or update the caller's profile.
   *
   * The request may carry only the writable fields. `verifiedEmail`, `user`,
   * `isComplete`, and `photo` are refused outright rather than ignored, so a
   * caller attempting one learns it did not take.
   */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true},
    swagger: {
      summary: 'Save my Student profile',
      description:
        'Validate and store the profile for the authenticated Student. The ' +
        'verified email and completion state are derived server-side.',
      tags: ['Student profile'],
      responses: {
        '200': {description: 'Saved; returns the safe profile DTO'},
        '400': {description: 'Validation failed'},
        '403': {description: 'Not a Student'},
      },
    },
  })
  async saveMyStudentProfile(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'saveMyStudentProfile');
    const user = await requireStudentUser(req, 'saveMyStudentProfile');

    const params = (req.params ?? {}) as Record<string, unknown>;

    const privileged = findPrivilegedFields(params);
    if (privileged.length > 0) {
      profileLog.warn('Rejected server-controlled fields in a profile save', {
        op: 'saveMyStudentProfile',
        stage: 'validate',
        ok: false,
        userId: user.id,
        fieldCount: privileged.length,
        code: ProfileError.VALIDATION_FAILED,
      });
      const fields: FieldErrors = {};
      for (const key of privileged) fields[key] = 'NOT_ALLOWED';
      throw profileError(ProfileError.VALIDATION_FAILED, fields);
    }

    // The catalog selections are resolved first, because two scalar rules
    // depend on the outcome: whether a typed institution name is required, and
    // whether the target-role reason has a role to belong to. The currently
    // stored profile goes in too, so an already-chosen item that an Admin has
    // since retired stays valid while a *new* retired choice is refused.
    const existing = await findProfileForUser(user);
    const [catalogError, catalog] = await catchError(
      resolveCatalogSelections(params, existing)
    );
    if (catalogError || !catalog) throw toClientError(catalogError);

    const {values, errors} = validateProfileInput(params, {
      institutionIsOther: catalog.institutionIsOther,
      hasTargetRole: Boolean(catalog.values.targetRole),
    });

    // One field map, whichever half rejected.
    Object.assign(errors, catalog.errors);

    if (Object.keys(errors).length > 0) {
      profileLog.warn('Profile validation failed', {
        op: 'saveMyStudentProfile',
        stage: 'validate',
        ok: false,
        userId: user.id,
        // A count, never the names: which answers a person got wrong is theirs.
        fieldCount: Object.keys(errors).length,
        code: ProfileError.VALIDATION_FAILED,
      });
      throw profileError(ProfileError.VALIDATION_FAILED, errors);
    }

    const [saveError, result] = await catchError(
      saveProfileForUser(user, verifiedEmailFor(user), values, catalog.values)
    );
    if (saveError || !result) throw toClientError(saveError);

    // Import the Google avatar on the save that **creates** the profile, and
    // only when nothing is attached — so it can never overwrite an image the
    // Student chose, and a later removal is permanent. Best effort throughout:
    // a missing or malformed avatar is a profile without a photo, never a
    // failed save.
    let profile = result.profile;
    if (result.created && !profile.get('photoData')) {
      const [importError, imported] = await catchError(importGoogleAvatar(user));
      if (!importError && imported) {
        const [attachError, updated] = await catchError(setProfilePhoto(profile, imported));
        if (!attachError && updated) profile = updated as Parse.Object;
      }
    }

    profileLog.info('Profile saved', {
      op: 'saveMyStudentProfile',
      stage: 'complete',
      ok: true,
      userId: user.id,
      profileId: profile.id,
      created: result.created,
      complete: profile.get('isComplete') === true,
    });

    return toStudentProfileDto(profile);
  }

  /** Remove the profile photo and the bytes behind it. */
  @CloudFunction({
    methods: ['POST'],
    validation: {requireUser: true},
    swagger: {
      summary: 'Remove my profile photo',
      description: 'Detach and delete the profile photo.',
      tags: ['Student profile'],
      responses: {
        '200': {description: 'Removed; returns the safe profile DTO'},
        '403': {description: 'Not a Student'},
      },
    },
  })
  async removeMyProfilePhoto(req: Parse.Cloud.FunctionRequest) {
    rejectPrivilegedParams(req, 'removeMyProfilePhoto');
    const user = await requireStudentUser(req, 'removeMyProfilePhoto');

    const profile = await findProfileForUser(user);
    if (!profile) throw profileError(ProfileError.PROFILE_UNAVAILABLE);

    const [error, updated] = await catchError(setProfilePhoto(profile, undefined));
    if (error || !updated) throw toClientError(error);

    profileLog.info('Profile photo removed', {
      op: 'removeMyProfilePhoto',
      stage: 'photo',
      ok: true,
      userId: user.id,
      profileId: updated.id,
    });

    return toStudentProfileDto(updated);
  }
}

export default StudentProfileFunctions;
export {requireStudentUser, toClientError, verifiedEmailFor};
